// Plan the expiry tracking issue lifecycle. Deterministic and offline: it reads
// the alert verdict plus issue/label listings the workflow already fetched, and
// writes a plan of REST operations. The scheduled workflow owns every GitHub
// interaction and only executes that plan.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { EXPIRY_TRACKER_LABEL, planExpiryTrackerReconciliation } from '../src/npm-audit-expiry-tracker.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value === '') fail(`${name} is required`);
  return value;
}

// An unknown verdict must never be read as "clean": only the literal strings count.
function strictBoolean(name) {
  const value = requiredEnv(name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fail(`${name} must be exactly "true" or "false", received ${JSON.stringify(value)}`);
}

async function readJson(path, description) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    return fail(`${description} unreadable at ${path}: ${error.message}`);
  }
}

const alert = strictBoolean('TSJSV_EXPIRY_TRACKER_ALERT');
const gatePassed = requiredEnv('TSJSV_EXPIRY_TRACKER_GATE_OUTCOME') === 'success';
const issues = await readJson(resolve(requiredEnv('TSJSV_EXPIRY_TRACKER_ISSUES')), 'tracker issue listing');
const labels = await readJson(resolve(requiredEnv('TSJSV_EXPIRY_TRACKER_LABELS')), 'repository label listing');
if (!Array.isArray(labels) || labels.some((name) => typeof name !== 'string')) {
  fail('repository label listing must be a JSON array of label names');
}
const planPath = resolve(requiredEnv('TSJSV_EXPIRY_TRACKER_PLAN'));

let title = null;
let alertBody = null;
if (alert) {
  title = requiredEnv('TSJSV_EXPIRY_TRACKER_TITLE');
  const bodyPath = resolve(requiredEnv('TSJSV_NPM_AUDIT_ALERT_BODY'));
  try {
    alertBody = await readFile(bodyPath, 'utf8');
  } catch (error) {
    fail(`alert body unreadable at ${bodyPath}: ${error.message}`);
  }
}

let plan;
try {
  plan = planExpiryTrackerReconciliation({
    alert,
    gatePassed,
    title,
    alertBody,
    issues,
    labelExists: labels.includes(EXPIRY_TRACKER_LABEL),
    runUrl: requiredEnv('TSJSV_EXPIRY_TRACKER_RUN_URL'),
    commitSha: requiredEnv('TSJSV_EXPIRY_TRACKER_COMMIT'),
  });
} catch (error) {
  fail(`expiry tracker plan refused: ${error.message}`);
}

await mkdir(dirname(planPath), { recursive: true });
await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `action=${plan.action}\noperation_count=${plan.operations.length}\nplan_path=${planPath}\n`,
    'utf8',
  );
}
process.stdout.write(`expiry tracker: ${plan.action}${plan.trackerNumber ? ` #${plan.trackerNumber}` : ''} — ${plan.reason} (${plan.operations.length} operation(s))\n`);
