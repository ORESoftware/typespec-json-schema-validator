import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const EXCEPTION = Object.freeze({
  advisory: 'GHSA-2q42-4q24-7rgv',
  url: 'https://github.com/advisories/GHSA-2q42-4q24-7rgv',
  package: '@typespec/compiler',
  version: '1.15.0',
  expires: '2026-10-09T00:00:00Z',
  allowedAffectedEntries: new Set([
    '@typespec/compiler',
    '@typespec/asset-emitter',
    '@typespec/json-schema',
  ]),
});

const highOrCritical = new Set(['high', 'critical']);

function fail(reason) {
  throw new Error(`production dependency audit policy failed: ${reason}`);
}

function advisoryId(via) {
  if (!via || typeof via !== 'object') return null;
  const url = String(via.url ?? '');
  const match = url.match(/GHSA-[0-9a-z-]+/iu);
  return match?.[0]?.toUpperCase() ?? null;
}

export function evaluateProductionAudit({ audit, lock, now = new Date() }) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) fail('invalid policy clock');
  if (now >= new Date(EXCEPTION.expires)) fail(`temporary exception expired at ${EXCEPTION.expires}`);
  if (audit?.auditReportVersion !== 2 || typeof audit?.vulnerabilities !== 'object') {
    fail('unsupported or malformed npm audit report');
  }
  if (lock?.lockfileVersion !== 3 || typeof lock?.packages !== 'object') {
    fail('unsupported or malformed package-lock.json');
  }

  const compiler = lock.packages['node_modules/@typespec/compiler'];
  if (compiler?.version !== EXCEPTION.version) {
    fail(`expected ${EXCEPTION.package} exactly ${EXCEPTION.version}`);
  }
  if (lock.packages['node_modules/@typespec/openapi3']) {
    fail('@typespec/openapi3 entered the production lock graph');
  }

  const serious = Object.entries(audit.vulnerabilities)
    .filter(([, finding]) => highOrCritical.has(String(finding?.severity).toLowerCase()));
  if (serious.length === 0) fail('known advisory disappeared; remove or re-review the exception instead of silently carrying it');

  let sawKnownRoot = false;
  for (const [name, finding] of serious) {
    if (!EXCEPTION.allowedAffectedEntries.has(name)) fail(`unexpected high/critical package: ${name}`);
    if (!Array.isArray(finding.via)) fail(`malformed advisory path for ${name}`);
    for (const via of finding.via) {
      if (typeof via === 'string') {
        if (!EXCEPTION.allowedAffectedEntries.has(via)) fail(`unexpected transitive advisory source: ${via}`);
        continue;
      }
      if (!highOrCritical.has(String(via?.severity).toLowerCase())) continue;
      const id = advisoryId(via);
      if (id !== EXCEPTION.advisory || via.url !== EXCEPTION.url || via.name !== EXCEPTION.package) {
        fail(`unexpected high/critical advisory on ${name}`);
      }
      sawKnownRoot = true;
    }
  }
  if (!sawKnownRoot) fail(`expected exact advisory ${EXCEPTION.advisory} was not present`);

  const counts = audit.metadata?.vulnerabilities ?? {};
  if (Number(counts.critical ?? 0) !== 0) fail('critical vulnerabilities are never excepted');
  if (Number(counts.high ?? 0) !== serious.length) fail('npm high-severity count does not match parsed entries');

  return {
    status: 'passed_with_temporary_exception',
    advisory: EXCEPTION.advisory,
    package: EXCEPTION.package,
    version: EXCEPTION.version,
    expires: EXCEPTION.expires,
    affectedEntries: serious.map(([name]) => name).sort(),
  };
}

export function main() {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: process.cwd(), encoding: 'utf8', shell: false, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) fail('npm audit could not execute');
  let audit;
  try { audit = JSON.parse(result.stdout); } catch { fail('npm audit did not return valid JSON'); }
  const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'));
  const verdict = evaluateProductionAudit({ audit, lock });
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
