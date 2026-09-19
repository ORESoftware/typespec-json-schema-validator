// Lifecycle of the single GitHub issue that tracks npm advisory exception expiry.
//
// Pure and offline: given the alert verdict and the tracker issues that already
// exist, decide what to do and spell out the exact REST operations. The
// scheduled workflow only executes the returned operations, so every lifecycle
// transition is unit-testable without touching a real repository.
//
// Identity. A tracker is an issue (never a pull request) that carries BOTH the
// stable label and the hidden body marker. Titles change with the alert state
// and list positions are meaningless, so neither is ever used for lookup. The
// label needs triage permission to apply, so an outside reporter who pastes the
// marker into their own issue cannot get it adopted or closed; the marker keeps
// a maintainer who reuses the label on an unrelated issue from losing it.

export const EXPIRY_TRACKER_LABEL = 'tjsv-npm-advisory-exception-expiry';
export const EXPIRY_TRACKER_MARKER = '<!-- tjsv:npm-advisory-exception-expiry-tracker -->';
export const EXPIRY_TRACKER_PLAN_SCHEMA = 'ores.tjsv-npm-advisory-expiry-tracker-plan/v1';

const LABEL_COLOR = 'b60205';
const LABEL_DESCRIPTION = 'Automation-owned tracker: npm advisory exception expired or expiring';

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean, received ${JSON.stringify(value)}`);
  return value;
}

function requireNonemptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function labelNames(issue) {
  if (!Array.isArray(issue.labels)) return [];
  return issue.labels.map((label) => (typeof label === 'string' ? label : label?.name)).filter((name) => typeof name === 'string');
}

// Select the tracker issues out of an arbitrary issue listing, oldest first.
export function selectExpiryTrackers(issues) {
  if (!Array.isArray(issues)) throw new TypeError('issues must be an array of GitHub issue objects');
  const trackers = [];
  for (const issue of issues) {
    if (issue === null || typeof issue !== 'object') throw new TypeError('issue listing contains a non-object entry');
    if (issue.pull_request !== undefined && issue.pull_request !== null) continue;
    if (!labelNames(issue).includes(EXPIRY_TRACKER_LABEL)) continue;
    if (typeof issue.body !== 'string' || !issue.body.includes(EXPIRY_TRACKER_MARKER)) continue;
    if (!Number.isSafeInteger(issue.number) || issue.number <= 0) {
      throw new TypeError(`tracker issue has an invalid number: ${JSON.stringify(issue.number)}`);
    }
    if (issue.state !== 'open' && issue.state !== 'closed') {
      throw new TypeError(`tracker issue #${issue.number} has an unknown state: ${JSON.stringify(issue.state)}`);
    }
    trackers.push({ number: issue.number, state: issue.state });
  }
  return trackers.sort((left, right) => left.number - right.number);
}

function provenance({ runUrl, commitSha }) {
  return `Scheduled run: ${runUrl}\nCommit: \`${commitSha}\`\n`;
}

function closeOperations(number, comment, stateReason) {
  return [
    { method: 'POST', path: `issues/${number}/comments`, body: { body: comment } },
    { method: 'PATCH', path: `issues/${number}`, body: { state: 'closed', state_reason: stateReason } },
  ];
}

// Decide the tracker lifecycle transition.
//
//   alert  open tracker  closed tracker  ->  action
//   true   no            no                  create
//   true   yes           (any)               update   (oldest open one; extra open ones are closed as duplicates)
//   true   no            yes                 reopen   (most recent closed one, so one issue keeps the whole history)
//   false  yes           (any)               close    (every open one, with a resolution comment) -- only if the gate passed
//   false  no            (any)               noop
//
// `alert` and `gatePassed` must be real booleans: an unknown verdict throws
// instead of being read as "clean", so a broken upstream step can never close
// the tracker. A clean alert verdict while the audit gate itself is red is held
// (noop): the tracker is only declared resolved by a fully passing run.
export function planExpiryTrackerReconciliation({
  alert,
  gatePassed,
  title = null,
  alertBody = null,
  issues,
  labelExists,
  runUrl,
  commitSha,
}) {
  requireBoolean(alert, 'alert');
  requireBoolean(gatePassed, 'gatePassed');
  requireBoolean(labelExists, 'labelExists');
  requireNonemptyString(runUrl, 'runUrl');
  requireNonemptyString(commitSha, 'commitSha');
  const trackers = selectExpiryTrackers(issues);
  const open = trackers.filter((tracker) => tracker.state === 'open');
  const closed = trackers.filter((tracker) => tracker.state === 'closed');
  const context = { runUrl, commitSha };
  const plan = (action, trackerNumber, reason, operations) => ({
    schema: EXPIRY_TRACKER_PLAN_SCHEMA,
    action,
    trackerNumber,
    reason,
    operations,
  });

  if (!alert) {
    if (open.length === 0) {
      return plan('noop', null, 'no advisory exception is expired or expiring, and no tracker issue is open', []);
    }
    if (!gatePassed) {
      return plan(
        'noop',
        open[0].number,
        'no advisory exception is expired or expiring, but the production audit gate did not pass; the tracker stays open until a fully passing run',
        [],
      );
    }
    const comment = 'Resolved: no npm advisory exception is expired or inside the early-warning window any more, '
      + `and the production audit gate passed.\n\n${provenance(context)}\n`
      + 'Closing automatically. This issue is reopened if an exception expires or enters the warning window again.\n';
    return plan(
      'close',
      open[0].number,
      'no advisory exception is expired or expiring and the production audit gate passed',
      open.flatMap((tracker) => closeOperations(tracker.number, comment, 'completed')),
    );
  }

  requireNonemptyString(title, 'title');
  requireNonemptyString(alertBody, 'alertBody');
  const issueBody = `${EXPIRY_TRACKER_MARKER}\n${alertBody}\n${provenance(context)}`;
  const commentBody = `${alertBody}\n${provenance(context)}`;
  const operations = [];
  // An issue that already carries the label proves the label exists, whatever the listing said.
  if (!labelExists && trackers.length === 0) {
    operations.push({
      method: 'POST',
      path: 'labels',
      body: { name: EXPIRY_TRACKER_LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION },
    });
  }

  if (open.length > 0) {
    const [canonical, ...duplicates] = open;
    operations.push(
      { method: 'PATCH', path: `issues/${canonical.number}`, body: { title, body: issueBody } },
      { method: 'POST', path: `issues/${canonical.number}/comments`, body: { body: commentBody } },
    );
    for (const duplicate of duplicates) {
      operations.push(...closeOperations(
        duplicate.number,
        `Duplicate expiry tracker; #${canonical.number} is the single tracking issue.\n\n${provenance(context)}`,
        'not_planned',
      ));
    }
    return plan('update', canonical.number, 'an open tracker issue already exists; updating it instead of creating a duplicate', operations);
  }

  if (closed.length > 0) {
    const latest = closed[closed.length - 1];
    operations.push(
      { method: 'PATCH', path: `issues/${latest.number}`, body: { state: 'open', title, body: issueBody } },
      { method: 'POST', path: `issues/${latest.number}/comments`, body: { body: `Reopened: a new alert arose after this tracker was closed.\n\n${commentBody}` } },
    );
    return plan('reopen', latest.number, 'a new alert arose after the tracker was closed; reopening the most recent tracker', operations);
  }

  operations.push({ method: 'POST', path: 'issues', body: { title, body: issueBody, labels: [EXPIRY_TRACKER_LABEL] } });
  return plan('create', null, 'no tracker issue exists yet', operations);
}
