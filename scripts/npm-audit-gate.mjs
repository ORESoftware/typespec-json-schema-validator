import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  EXCEPTION_REMEDIATION,
  evaluateAudit,
  failedAuditReceipt,
  normalizeExpiryWarningDays,
  sha256Utf8,
  validateAuditEnvironment,
} from '../src/npm-audit-policy.mjs';
import { resolveNpmLaunch } from '../src/npm-command.mjs';

const root = resolve(import.meta.dirname, '..');
const packageJsonPath = resolve(root, 'package.json');
const packageLockPath = resolve(root, 'package-lock.json');
const exceptionPath = resolve(root, 'security/npm-audit-exceptions.json');
const receiptPath = resolve(
  process.env.TSJSV_NPM_AUDIT_RECEIPT || '.typespec-json-schema-validator/npm-audit-receipt.json',
);

function commandText(command, args) {
  let executable = command;
  let argv = args;

  if (command === 'npm') {
    try {
      const launch = resolveNpmLaunch(args);
      executable = launch.command;
      argv = launch.args;
    } catch (error) {
      return {
        status: null,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  return spawnSync(executable, argv, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
    shell: false,
  });
}

function cleanOutput(result) {
  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

const [packageJsonText, packageLockText, exceptionText] = await Promise.all([
  readFile(packageJsonPath, 'utf8'),
  readFile(packageLockPath, 'utf8'),
  readFile(exceptionPath, 'utf8'),
]);
const packageJsonDigest = sha256Utf8(packageJsonText);
const packageLockDigest = sha256Utf8(packageLockText);

const npmVersionResult = commandText('npm', ['--version']);
const registryResult = commandText('npm', ['config', 'get', 'registry']);
const rawNpmVersion = npmVersionResult.status === 0 ? cleanOutput(npmVersionResult) : 'unavailable';
const rawRegistry = registryResult.status === 0 ? cleanOutput(registryResult) : 'unavailable';
let npmVersion = 'unavailable';
let registry = 'unavailable';
let environmentFailure = null;
try {
  const identity = validateAuditEnvironment({ npmVersion: rawNpmVersion, registry: rawRegistry });
  npmVersion = identity.npmVersion;
  registry = identity.registry;
} catch (error) {
  environmentFailure = `npm audit environment collection failed: ${error.message}`;
}

const audit = commandText('npm', ['audit', '--omit=dev', '--json', '--audit-level=high']);
let receipt;
let auditDocument = null;
let parseFailure = environmentFailure;

if (!parseFailure && audit.error) {
  parseFailure = `npm audit could not start: ${audit.error.message}`;
} else if (!parseFailure && audit.status !== 0 && audit.status !== 1) {
  parseFailure = `npm audit infrastructure exit ${String(audit.status)}`;
} else if (!parseFailure) {
  try {
    auditDocument = JSON.parse(cleanOutput(audit));
  } catch (error) {
    parseFailure = `npm audit did not return valid JSON: ${error.message}`;
  }
}

if (parseFailure) {
  receipt = failedAuditReceipt({
    reason: parseFailure,
    npmVersion,
    registry,
    packageLockDigest,
    packageJsonDigest,
    auditExitCode: audit.status,
  });
} else {
  let exceptionLedger;
  try {
    exceptionLedger = JSON.parse(exceptionText);
    receipt = evaluateAudit({
      auditDocument,
      exceptionLedger,
      now: new Date().toISOString(),
      auditExitCode: audit.status,
      npmVersion,
      registry,
      packageLockDigest,
      packageJsonDigest,
      auditDocumentDigest: sha256Utf8(JSON.stringify(auditDocument)),
      expiryWarningDays: normalizeExpiryWarningDays(
        process.env.TSJSV_NPM_AUDIT_EXPIRY_WARNING_DAYS ?? undefined,
      ),
    });
  } catch (error) {
    receipt = failedAuditReceipt({
      reason: `audit policy evaluation failed: ${error.message}`,
      npmVersion,
      registry,
      packageLockDigest,
      packageJsonDigest,
      auditExitCode: audit.status,
    });
  }
}

await mkdir(dirname(receiptPath), { recursive: true });
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

const inGitHubActions = process.env.GITHUB_ACTIONS === 'true';

function warn(message) {
  process.stderr.write(`${inGitHubActions ? '::warning::' : 'warning: '}${message}\n`);
}

function writeRemediation(write) {
  write('what to do, in order:\n');
  for (const [index, step] of EXCEPTION_REMEDIATION.entries()) {
    write(`  ${index + 1}. ${step}\n`);
  }
}

// Report upcoming expiries even on a passing run: this gate fails closed on a
// calendar date, so an unannounced expiry reds every repository pinning this action.
for (const entry of receipt.exceptionsExpiringSoon ?? []) {
  warn(
    `TJSV npm advisory exception for ${entry.package} (${entry.advisoryId}) expires at ${entry.expiresAt}`
    + ` in ${entry.daysRemaining} day(s); after that this gate fails closed in every consumer repository.`
    + ` Owner: ${entry.owner}. Upgrade past the advisory if a patched release exists, otherwise renew the exception`
    + ' in security/npm-audit-exceptions.json before the expiry date.',
  );
}

if (receipt.status === 'passed') {
  process.stdout.write(`production dependency audit passed: ${receipt.findings.length} advisory path(s), 0 unwaived high/critical\n`);
  if ((receipt.exceptionsExpiringSoon ?? []).length > 0) {
    writeRemediation((text) => process.stdout.write(text));
  }
  process.exit(0);
}

if (receipt.status === 'stopped_for_evaluation') {
  process.stderr.write(`production dependency audit stopped: ${receipt.unwaivedHighOrCritical.length} unwaived high/critical advisory path(s)\n`);
  for (const finding of receipt.unwaivedHighOrCritical) {
    const expiry = finding.reason === 'exception-expired'
      ? `, exception expired ${finding.exceptionExpiresAt}`
      : '';
    process.stderr.write(`- ${finding.package}: ${finding.severity} ${finding.advisoryId} (${finding.reason}${expiry})\n`);
  }
  writeRemediation((text) => process.stderr.write(text));
  process.stderr.write(`receipt: ${receiptPath}\n`);
  process.exit(1);
}

process.stderr.write(`production dependency audit failed: ${receipt.failure}\n`);
process.exit(2);
