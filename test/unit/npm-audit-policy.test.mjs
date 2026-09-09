import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectAuditFindings,
  evaluateAudit,
  EXCEPTION_SCHEMA,
  parseExceptionLedger,
  validateAuditEnvironment,
} from '../../src/npm-audit-policy.mjs';

const NOW = '2026-09-09T04:00:00.000Z';
const baseMetadata = {
  vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
  dependencies: { prod: 10, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 10 },
};

function auditWith({ severity = 'high', isDirect = false, source = 1234, packageName = 'transitive-pkg', via = null } = {}) {
  const advisory = via ?? {
    source,
    name: packageName,
    dependency: packageName,
    title: 'example advisory',
    url: `https://github.com/advisories/GHSA-example-${source}`,
    severity,
    range: '<2.0.0',
  };
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      [packageName]: {
        name: packageName,
        severity,
        isDirect,
        via: [advisory],
        effects: [],
        range: '<2.0.0',
        nodes: [`node_modules/${packageName}`],
        fixAvailable: { name: packageName, version: '2.0.0', isSemVerMajor: false },
      },
    },
    metadata: baseMetadata,
  };
}

function ledger(exceptions = []) {
  return { schema: EXCEPTION_SCHEMA, exceptions };
}

function evaluate(auditDocument, exceptionLedger = ledger(), auditExitCode = 1) {
  return evaluateAudit({
    auditDocument,
    exceptionLedger,
    now: NOW,
    auditExitCode,
    npmVersion: '11.6.0',
    registry: 'https://registry.npmjs.org/',
    packageLockDigest: 'a'.repeat(64),
    packageJsonDigest: 'b'.repeat(64),
    auditDocumentDigest: 'c'.repeat(64),
  });
}

test('high production advisory stops evaluation', () => {
  const receipt = evaluate(auditWith());
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.zeroUnwaivedHighOrCritical, false);
  assert.equal(receipt.unwaivedHighOrCritical.length, 1);
});

test('critical production advisory stops evaluation', () => {
  const receipt = evaluate(auditWith({ severity: 'critical' }));
  assert.equal(receipt.status, 'stopped_for_evaluation');
});

test('moderate advisory is recorded but does not fail the high threshold', () => {
  const receipt = evaluate(auditWith({ severity: 'moderate' }), ledger(), 0);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.findings.length, 1);
});

test('direct dependency classification is retained', () => {
  const [finding] = collectAuditFindings(auditWith({ isDirect: true }));
  assert.equal(finding.directDependency, true);
});

test('transitive dependency classification is retained', () => {
  const [finding] = collectAuditFindings(auditWith({ isDirect: false }));
  assert.equal(finding.directDependency, false);
});

test('production audit paths are conservatively action-reachable', () => {
  const [finding] = collectAuditFindings(auditWith());
  assert.equal(finding.productionScope, true);
  assert.equal(finding.actionReachability, 'conservatively-reachable');
});

test('exact nonexpired exception waives only its advisory and package', () => {
  const receipt = evaluate(auditWith(), ledger([{
    advisoryId: 'npm:1234',
    package: 'transitive-pkg',
    owner: 'security@example.invalid',
    rationale: 'temporary upstream compatibility hold',
    reachabilityEvidence: 'reviewed dependency path and compensating control',
    expiresAt: '2026-09-10T04:00:00.000Z',
  }]));
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.exceptionsApplied.length, 1);
});

test('package mismatch cannot blanket-waive an advisory', () => {
  const receipt = evaluate(auditWith(), ledger([{
    advisoryId: 'npm:1234',
    package: 'other-package',
    owner: 'security@example.invalid',
    rationale: 'wrong package on purpose',
    reachabilityEvidence: 'not applicable to the actual path',
    expiresAt: '2026-09-10T04:00:00.000Z',
  }]));
  assert.equal(receipt.status, 'stopped_for_evaluation');
});

test('expired exception fails closed', () => {
  const receipt = evaluate(auditWith(), ledger([{
    advisoryId: 'npm:1234',
    package: 'transitive-pkg',
    owner: 'security@example.invalid',
    rationale: 'expired',
    reachabilityEvidence: 'expired evidence',
    expiresAt: '2026-09-09T03:59:59.000Z',
  }]));
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.unwaivedHighOrCritical[0].reason, 'exception-expired');
});

test('exception requires reachability evidence', () => {
  assert.throws(() => parseExceptionLedger(ledger([{
    advisoryId: 'npm:1234',
    package: 'transitive-pkg',
    owner: 'security@example.invalid',
    rationale: 'missing evidence',
    reachabilityEvidence: '',
    expiresAt: '2026-09-10T04:00:00.000Z',
  }])), /reachabilityEvidence/);
});

test('exception expiry must be canonical UTC', () => {
  assert.throws(() => parseExceptionLedger(ledger([{
    advisoryId: 'npm:1234',
    package: 'transitive-pkg',
    owner: 'security@example.invalid',
    rationale: 'bad timestamp',
    reachabilityEvidence: 'evidence',
    expiresAt: '2026-09-10',
  }])), /canonical RFC3339 UTC/);
});

test('duplicate exact exceptions are refused', () => {
  const exception = {
    advisoryId: 'npm:1234',
    package: 'transitive-pkg',
    owner: 'security@example.invalid',
    rationale: 'duplicate',
    reachabilityEvidence: 'evidence',
    expiresAt: '2026-09-10T04:00:00.000Z',
  };
  assert.throws(() => parseExceptionLedger(ledger([exception, exception])), /duplicate exception/);
});

test('aggregate vulnerability without advisory object remains fail-closed', () => {
  const audit = auditWith();
  audit.vulnerabilities['transitive-pkg'].via = ['nested-package'];
  const receipt = evaluate(audit);
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.match(receipt.unwaivedHighOrCritical[0].advisoryId, /^aggregate:/);
});

test('duplicate advisory entries are deterministically deduplicated', () => {
  const audit = auditWith();
  audit.vulnerabilities['transitive-pkg'].via.push(structuredClone(audit.vulnerabilities['transitive-pkg'].via[0]));
  assert.equal(collectAuditFindings(audit).length, 1);
});

test('npm audit exit 1 with valid advisory JSON is semantic evidence, not infrastructure failure', () => {
  const receipt = evaluate(auditWith(), ledger(), 1);
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.failure, null);
});

test('unexpected npm audit exit fails independently of advisory semantics', () => {
  const receipt = evaluate(auditWith(), ledger(), 2);
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.failure, /infrastructure exit 2/);
});

test('missing npm audit metadata is refused', () => {
  const audit = auditWith();
  delete audit.metadata;
  assert.throws(() => collectAuditFindings(audit), /metadata/);
});

test('missing npm audit vulnerability inventory is refused', () => {
  const audit = auditWith();
  delete audit.vulnerabilities;
  assert.throws(() => collectAuditFindings(audit), /vulnerabilities/);
});

test('audit environment accepts an available npm version and HTTPS registry', () => {
  assert.deepEqual(validateAuditEnvironment({
    npmVersion: '11.6.0',
    registry: 'https://registry.npmjs.org',
  }), {
    npmVersion: '11.6.0',
    registry: 'https://registry.npmjs.org/',
  });
});

for (const [name, value, pattern] of [
  ['unavailable npm version', { npmVersion: 'unavailable', registry: 'https://registry.npmjs.org/' }, /npm version/],
  ['malformed npm version', { npmVersion: 'latest', registry: 'https://registry.npmjs.org/' }, /npm version/],
  ['unavailable registry', { npmVersion: '11.6.0', registry: 'unavailable' }, /registry/],
  ['insecure registry', { npmVersion: '11.6.0', registry: 'http://registry.npmjs.org/' }, /HTTPS/],
  ['credential-bearing registry', { npmVersion: '11.6.0', registry: 'https://user:secret@registry.npmjs.org/' }, /credentials/],
  ['query-bearing registry', { npmVersion: '11.6.0', registry: 'https://registry.npmjs.org/?mirror=1' }, /query parameters/],
]) {
  test(`audit environment fails closed: ${name}`, () => {
    assert.throws(() => validateAuditEnvironment(value), pattern);
  });
}
