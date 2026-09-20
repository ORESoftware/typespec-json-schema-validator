import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  EXPIRY_TRACKER_LABEL,
  EXPIRY_TRACKER_MARKER,
  EXPIRY_TRACKER_PLAN_SCHEMA,
  planExpiryTrackerReconciliation,
  selectExpiryTrackers,
} from '../../src/npm-audit-expiry-tracker.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const TITLE = 'TJSV npm advisory exception expiring soon: production audit gate will fail closed';
const ALERT_BODY = '## Advisory exceptions expiring soon\n\n- `pkg` `npm:1` — expires soon\n';
const RUN_URL = 'https://github.example/o/r/actions/runs/42';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

function tracker(number, state, overrides = {}) {
  return {
    number,
    state,
    title: 'a title that lookup must never depend on',
    body: `${EXPIRY_TRACKER_MARKER}\nold alert body\n`,
    labels: [{ name: EXPIRY_TRACKER_LABEL }],
    ...overrides,
  };
}

function plan(overrides) {
  return planExpiryTrackerReconciliation({
    alert: true,
    gatePassed: true,
    title: TITLE,
    alertBody: ALERT_BODY,
    issues: [],
    labelExists: true,
    runUrl: RUN_URL,
    commitSha: COMMIT,
    ...overrides,
  });
}

// A minimal in-memory GitHub that applies planned operations, so a lifecycle
// can be replayed across several scheduled runs without any network access.
function fakeRepository(initialIssues = []) {
  const state = { issues: structuredClone(initialIssues), labels: [], comments: [] };
  function apply(operation) {
    const { method, path, body } = operation;
    if (method === 'POST' && path === 'labels') {
      assert.ok(!state.labels.includes(body.name), 'label created twice (GitHub answers 422)');
      state.labels.push(body.name);
    } else if (method === 'POST' && path === 'issues') {
      const number = state.issues.reduce((max, issue) => Math.max(max, issue.number), 0) + 1;
      for (const label of body.labels) assert.ok(state.labels.includes(label), `label ${label} does not exist yet`);
      state.issues.push({ number, state: 'open', title: body.title, body: body.body, labels: body.labels.map((name) => ({ name })) });
    } else if (method === 'POST' && /^issues\/\d+\/comments$/.test(path)) {
      state.comments.push({ number: Number(path.split('/')[1]), body: body.body });
    } else if (method === 'PATCH' && /^issues\/\d+$/.test(path)) {
      const issue = state.issues.find((candidate) => candidate.number === Number(path.split('/')[1]));
      assert.ok(issue, `PATCH of unknown issue ${path}`);
      Object.assign(issue, body);
    } else {
      assert.fail(`unexpected operation ${method} ${path}`);
    }
  }
  return {
    state,
    run(overrides) {
      const result = plan({ issues: state.issues, labelExists: state.labels.includes(EXPIRY_TRACKER_LABEL), ...overrides });
      result.operations.forEach(apply);
      return result;
    },
    open() {
      return state.issues.filter((issue) => issue.state === 'open');
    },
  };
}

test('alert with no tracker issue creates one labeled, marked issue and the label itself', () => {
  const result = plan({ labelExists: false });
  assert.equal(result.schema, EXPIRY_TRACKER_PLAN_SCHEMA);
  assert.equal(result.action, 'create');
  assert.deepEqual(result.operations.map((operation) => `${operation.method} ${operation.path}`), ['POST labels', 'POST issues']);
  assert.equal(result.operations[0].body.name, EXPIRY_TRACKER_LABEL);
  const issue = result.operations[1].body;
  assert.equal(issue.title, TITLE);
  assert.deepEqual(issue.labels, [EXPIRY_TRACKER_LABEL]);
  assert.ok(issue.body.startsWith(`${EXPIRY_TRACKER_MARKER}\n`));
  assert.ok(issue.body.includes(ALERT_BODY));
  assert.ok(issue.body.includes(RUN_URL));
  assert.ok(issue.body.includes(COMMIT));
});

test('alert with an existing label does not try to create the label again', () => {
  const result = plan({ labelExists: true });
  assert.deepEqual(result.operations.map((operation) => operation.path), ['issues']);
  const labeled = plan({ labelExists: false, issues: [tracker(7, 'open')] });
  assert.ok(!labeled.operations.some((operation) => operation.path === 'labels'), 'a labeled tracker proves the label exists');
});

test('alert with an open tracker updates it and never creates a duplicate', () => {
  const result = plan({ issues: [tracker(7, 'open')] });
  assert.equal(result.action, 'update');
  assert.equal(result.trackerNumber, 7);
  assert.deepEqual(result.operations.map((operation) => `${operation.method} ${operation.path}`), ['PATCH issues/7', 'POST issues/7/comments']);
  assert.equal(result.operations[0].body.title, TITLE);
  assert.ok(result.operations[0].body.body.startsWith(EXPIRY_TRACKER_MARKER), 'the refreshed body must keep the marker');
  assert.equal(result.operations[0].body.state, undefined);
  assert.ok(!result.operations.some((operation) => operation.path === 'issues' && operation.method === 'POST'));
});

test('no alert with an open tracker closes it with a resolution comment naming the run and commit', () => {
  const result = plan({ alert: false, title: null, alertBody: null, issues: [tracker(7, 'open')] });
  assert.equal(result.action, 'close');
  assert.equal(result.trackerNumber, 7);
  assert.deepEqual(result.operations.map((operation) => `${operation.method} ${operation.path}`), ['POST issues/7/comments', 'PATCH issues/7']);
  const [comment, patch] = result.operations;
  assert.match(comment.body.body, /^Resolved:/);
  assert.ok(comment.body.body.includes(RUN_URL));
  assert.ok(comment.body.body.includes(COMMIT));
  assert.deepEqual(patch.body, { state: 'closed', state_reason: 'completed' });
});

test('no alert with no tracker is a noop with zero operations', () => {
  for (const issues of [[], [tracker(3, 'closed')]]) {
    const result = plan({ alert: false, title: null, alertBody: null, issues });
    assert.equal(result.action, 'noop');
    assert.deepEqual(result.operations, []);
  }
});

test('alert with only closed trackers reopens the most recent one instead of creating a new issue', () => {
  const result = plan({ issues: [tracker(3, 'closed'), tracker(9, 'closed')] });
  assert.equal(result.action, 'reopen');
  assert.equal(result.trackerNumber, 9);
  assert.deepEqual(result.operations.map((operation) => `${operation.method} ${operation.path}`), ['PATCH issues/9', 'POST issues/9/comments']);
  assert.equal(result.operations[0].body.state, 'open');
  assert.equal(result.operations[0].body.title, TITLE);
  assert.match(result.operations[1].body.body, /^Reopened:/);
});

test('an open tracker wins over closed ones', () => {
  const result = plan({ issues: [tracker(3, 'closed'), tracker(5, 'open'), tracker(9, 'closed')] });
  assert.equal(result.action, 'update');
  assert.equal(result.trackerNumber, 5);
});

test('duplicate open trackers converge on the oldest; the rest are closed as duplicates', () => {
  const result = plan({ issues: [tracker(12, 'open'), tracker(8, 'open')] });
  assert.equal(result.action, 'update');
  assert.equal(result.trackerNumber, 8);
  assert.deepEqual(
    result.operations.map((operation) => `${operation.method} ${operation.path}`),
    ['PATCH issues/8', 'POST issues/8/comments', 'POST issues/12/comments', 'PATCH issues/12'],
  );
  assert.ok(result.operations[2].body.body.includes('#8'));
  assert.deepEqual(result.operations[3].body, { state: 'closed', state_reason: 'not_planned' });
});

test('the clean path closes every open tracker', () => {
  const result = plan({ alert: false, issues: [tracker(8, 'open'), tracker(12, 'open')] });
  assert.equal(result.action, 'close');
  assert.deepEqual(
    result.operations.filter((operation) => operation.method === 'PATCH').map((operation) => operation.path),
    ['issues/8', 'issues/12'],
  );
});

test('a clean alert verdict while the audit gate is red holds the tracker open', () => {
  const result = plan({ alert: false, gatePassed: false, issues: [tracker(7, 'open')] });
  assert.equal(result.action, 'noop');
  assert.equal(result.trackerNumber, 7);
  assert.deepEqual(result.operations, []);
});

test('a failing gate does not suppress the alert path', () => {
  assert.equal(plan({ gatePassed: false }).action, 'create');
  assert.equal(plan({ gatePassed: false, issues: [tracker(7, 'open')] }).action, 'update');
});

test('identity is label plus marker, never title, list position, or pull requests', () => {
  const lookalikeTitle = { number: 1, state: 'open', title: TITLE, body: 'human issue', labels: [] };
  const labelOnly = tracker(2, 'open', { body: 'maintainer reused the label' });
  const markerOnly = tracker(3, 'open', { labels: [{ name: 'bug' }] });
  const pullRequest = tracker(4, 'open', { pull_request: { url: 'https://example.invalid' } });
  const nullBody = tracker(5, 'open', { body: null });
  const real = tracker(6, 'open', { title: 'renamed by a human', labels: ['bug', EXPIRY_TRACKER_LABEL] });
  const issues = [lookalikeTitle, labelOnly, markerOnly, pullRequest, nullBody, real];
  assert.deepEqual(selectExpiryTrackers(issues), [{ number: 6, state: 'open' }]);
  assert.deepEqual(selectExpiryTrackers([...issues].reverse()), [{ number: 6, state: 'open' }]);

  const closing = plan({ alert: false, issues });
  assert.deepEqual(new Set(closing.operations.map((operation) => operation.path)), new Set(['issues/6', 'issues/6/comments']));
  assert.equal(plan({ alert: false, issues: issues.slice(0, 5) }).action, 'noop');
  assert.equal(plan({ issues: issues.slice(0, 5) }).action, 'create');
});

test('an unknown verdict or malformed listing throws instead of being read as clean', () => {
  const open = [tracker(7, 'open')];
  for (const alert of [undefined, null, '', 'false', 'true', 0]) {
    assert.throws(() => plan({ alert, issues: open }), /alert must be a boolean/);
  }
  assert.throws(() => plan({ alert: false, gatePassed: 'success', issues: open }), /gatePassed must be a boolean/);
  assert.throws(() => plan({ labelExists: undefined }), /labelExists must be a boolean/);
  assert.throws(() => plan({ issues: { message: 'Not Found' } }), /issues must be an array/);
  assert.throws(() => plan({ issues: [null] }), /non-object/);
  assert.throws(() => plan({ issues: [tracker('7', 'open')] }), /invalid number/);
  assert.throws(() => plan({ issues: [tracker(7, 'merged')] }), /unknown state/);
  assert.throws(() => plan({ title: '' }), /title must be a non-empty string/);
  assert.throws(() => plan({ alertBody: null }), /alertBody must be a non-empty string/);
  assert.throws(() => plan({ runUrl: '' }), /runUrl/);
  assert.throws(() => plan({ commitSha: undefined }), /commitSha/);
});

test('full lifecycle replay: create, update, close, noop, reopen — always at most one open tracker', () => {
  const repository = fakeRepository();
  const clean = { alert: false, title: null, alertBody: null };

  assert.equal(repository.run(clean).action, 'noop');
  assert.equal(repository.state.issues.length, 0);

  assert.equal(repository.run({}).action, 'create');
  assert.equal(repository.run({}).action, 'update');
  assert.equal(repository.run({ title: 'TJSV npm advisory exception expired: production audit gate is failing closed' }).action, 'update');
  assert.equal(repository.state.issues.length, 1, 'repeated alerts must not create duplicates');
  assert.equal(repository.open()[0].title, 'TJSV npm advisory exception expired: production audit gate is failing closed');

  assert.equal(repository.run({ ...clean, gatePassed: false }).action, 'noop');
  assert.equal(repository.open().length, 1);

  assert.equal(repository.run(clean).action, 'close');
  assert.equal(repository.open().length, 0);
  assert.equal(repository.state.issues[0].state_reason, 'completed');
  assert.equal(repository.run(clean).action, 'noop');

  const reopened = repository.run({});
  assert.equal(reopened.action, 'reopen');
  assert.equal(repository.state.issues.length, 1);
  assert.equal(repository.open().length, 1);
  assert.equal(repository.open()[0].title, TITLE);

  assert.equal(repository.run(clean).action, 'close');
  assert.equal(repository.open().length, 0);
  assert.equal(repository.state.labels.length, 1);
});

function runCli(env, files = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'tjsv-expiry-tracker-'));
  const issuesPath = join(directory, 'issues.json');
  const labelsPath = join(directory, 'labels.json');
  const bodyPath = join(directory, 'body.md');
  const planPath = join(directory, 'out', 'plan.json');
  const outputPath = join(directory, 'github-output');
  writeFileSync(issuesPath, files.issues ?? '[]');
  writeFileSync(labelsPath, files.labels ?? '[]');
  writeFileSync(bodyPath, ALERT_BODY);
  writeFileSync(outputPath, '');
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'npm-audit-expiry-tracker.mjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      TSJSV_EXPIRY_TRACKER_GATE_OUTCOME: 'success',
      TSJSV_EXPIRY_TRACKER_TITLE: TITLE,
      TSJSV_NPM_AUDIT_ALERT_BODY: bodyPath,
      TSJSV_EXPIRY_TRACKER_ISSUES: issuesPath,
      TSJSV_EXPIRY_TRACKER_LABELS: labelsPath,
      TSJSV_EXPIRY_TRACKER_PLAN: planPath,
      TSJSV_EXPIRY_TRACKER_RUN_URL: RUN_URL,
      TSJSV_EXPIRY_TRACKER_COMMIT: COMMIT,
      ...env,
    },
  });
  let written = null;
  try {
    written = JSON.parse(readFileSync(planPath, 'utf8'));
  } catch {
    written = null;
  }
  return { ...result, plan: written, outputs: readFileSync(outputPath, 'utf8') };
}

test('planner CLI: clean run with no tracker succeeds with a noop (a missing tracker never fails the schedule)', () => {
  const result = runCli({ TSJSV_EXPIRY_TRACKER_ALERT: 'false', TSJSV_EXPIRY_TRACKER_TITLE: '', TSJSV_NPM_AUDIT_ALERT_BODY: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.plan.action, 'noop');
  assert.match(result.outputs, /^action=noop\noperation_count=0\n/);
});

test('planner CLI: clean run closes the open tracker; alert run creates label and issue', () => {
  const closing = runCli(
    { TSJSV_EXPIRY_TRACKER_ALERT: 'false' },
    { issues: JSON.stringify([tracker(7, 'open')]), labels: JSON.stringify([EXPIRY_TRACKER_LABEL]) },
  );
  assert.equal(closing.status, 0, closing.stderr);
  assert.equal(closing.plan.action, 'close');
  assert.match(closing.stdout, /expiry tracker: close #7/);

  const creating = runCli({ TSJSV_EXPIRY_TRACKER_ALERT: 'true' });
  assert.equal(creating.status, 0, creating.stderr);
  assert.deepEqual(creating.plan.operations.map((operation) => operation.path), ['labels', 'issues']);
});

test('planner CLI: a red gate outcome holds the tracker open', () => {
  for (const outcome of ['failure', 'cancelled', 'skipped']) {
    const result = runCli(
      { TSJSV_EXPIRY_TRACKER_ALERT: 'false', TSJSV_EXPIRY_TRACKER_GATE_OUTCOME: outcome },
      { issues: JSON.stringify([tracker(7, 'open')]) },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.plan.action, 'noop');
  }
});

test('planner CLI: an unknown verdict or unreadable listing exits 2 and writes no plan', () => {
  const open = { issues: JSON.stringify([tracker(7, 'open')]) };
  for (const alert of ['', 'TRUE', 'no', '0']) {
    const result = runCli({ TSJSV_EXPIRY_TRACKER_ALERT: alert }, open);
    assert.equal(result.status, 2, `alert=${JSON.stringify(alert)}`);
    assert.equal(result.plan, null);
  }
  assert.equal(runCli({ TSJSV_EXPIRY_TRACKER_ALERT: 'false' }, { issues: '{"message":"Not Found"}' }).status, 2);
  assert.equal(runCli({ TSJSV_EXPIRY_TRACKER_ALERT: 'false' }, { issues: '[][]' }).status, 2);
  assert.equal(runCli({ TSJSV_EXPIRY_TRACKER_ALERT: 'false' }, { labels: '[{"name":"x"}]' }).status, 2);
  assert.equal(runCli({ TSJSV_EXPIRY_TRACKER_ALERT: 'false', TSJSV_EXPIRY_TRACKER_GATE_OUTCOME: '' }, open).status, 2);
});

test('scheduled workflow wires the planner on both verdicts and keeps the fail-closed gate', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'npm-audit-exception-expiry.yml'), 'utf8');
  assert.ok(workflow.includes(`TRACKER_LABEL: ${EXPIRY_TRACKER_LABEL}\n`), 'workflow label must match the planner constant');
  assert.ok(workflow.includes('node ./scripts/npm-audit-expiry-tracker.mjs'));
  assert.ok(!workflow.includes('startswith('), 'tracker lookup must not depend on title text');
  assert.ok(!/\|\s*first\b/.test(workflow), 'tracker lookup must not depend on list position');
  const reconcile = workflow.slice(workflow.indexOf('- name: Reconcile the expiry tracking issue'), workflow.indexOf('- name: Fail when'));
  assert.ok(reconcile.length > 0);
  assert.ok(!/^\s+if:/m.test(reconcile), 'reconciliation must run on the clean path too, not only when alert == true');
  assert.ok(!reconcile.includes('continue-on-error'));
  assert.match(workflow, /- name: Fail when the production audit gate did not pass\n\s+if: \$\{\{ steps\.audit\.outcome != 'success' \}\}\n\s+run: \|\n[^\n]*\n\s+exit 1\n/);
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  assert.equal(workflow.match(/issues: write/g).length, 1, 'issues: write is granted to the watch job only');
});
