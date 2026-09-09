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

function propagatedAudit() {
  const audit = auditWith({ packageName: '@typespec/compiler', isDirect: true, source: 1193788 });
  audit.vulnerabilities['@typespec/json-schema'] = {
    name: '@typespec/json-schema', severity: 'high', isDirect: true,
    via: ['@typespec/compiler'], effects: [], range: '*',
    nodes: ['node_modules/@typespec/json-schema'], fixAvailable: false,
  };
  audit.vulnerabilities['@typespec/asset-emitter'] = {
    name: '@typespec/asset-emitter', severity: 'high', isDirect: false,
    via: ['@typespec/compiler'], effects: ['@typespec/json-schema'], range: '*',
    nodes: ['node_modules/@typespec/asset-emitter'], fixAvailable: false,
  };
  return audit;
}

function ledger(exceptions = []) {
  return { schema: EXCEPTION_SCHEMA, exceptions };
}

function exceptionFor(packageName, advisoryId = 'npm:1234') {
  return {
    advisoryId,
    package: packageName,
    owner: 'security@example.invalid',
    rationale: 'temporary upstream compatibility hold',
    reachabilityEvidence: 'reviewed dependency path and compensating control',
    expiresAt: '2026-09-10T04:00:00.000Z',
  };
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

test('propagated npm package entries inherit the exact root advisory identity', () => {
  const findings = collectAuditFindings(propagatedAudit());
  assert.equal(findings.length, 3);
  assert.deepEqual(new Set(findings.map((finding) => finding.advisoryId)), new Set(['npm:1193788']));
  assert.deepEqual(new Set(findings.map((finding) => finding.advisoryPackage)), new Set(['@typespec/compiler']));
  assert.equal(findings.find((finding) => finding.package === '@typespec/json-schema').propagated, true);
});

test('propagated finding records package path evidence', () => {
  const finding = collectAuditFindings(propagatedAudit())
    .find((entry) => entry.package === '@typespec/asset-emitter');
  assert.deepEqual(finding.viaPackages, ['@typespec/compiler']);
  assert.deepEqual(finding.nodes, ['node_modules/@typespec/asset-emitter']);
  assert.deepEqual(finding.effects, ['@typespec/json-schema']);
});

test('exact nonexpired exception waives only its advisory and package', () => {
  const receipt = evaluate(auditWith(), ledger([exceptionFor('transitive-pkg')]));
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.exceptionsApplied.length, 1);
});

test('one root-advisory exception cannot blanket-waive propagated packages', () => {
  const receipt = evaluate(
    propagatedAudit(),
    ledger([exceptionFor('@typespec/compiler', 'npm:1193788')]),
  );
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.unwaivedHighOrCritical.length, 2);
});

test('exact exceptions can waive each propagated package path independently', () => {
  const receipt = evaluate(
    propagatedAudit(),
    ledger([
      exceptionFor('@typespec/compiler', 'npm:1193788'),
      exceptionFor('@typespec/json-schema', 'npm:1193788'),
      exceptionFor('@typespec/asset-emitter', 'npm:1193788'),
    ]),
  );
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.exceptionsApplied.length, 3);
});

test('package mismatch cannot blanket-waive an advisory', () => {
  const receipt = evaluate(auditWith(), ledger([exceptionFor('other-package')]));
  assert.equal(receipt.status, 'stopped_for_evaluation');
});

test('expired exception fails closed', () => {
  const exception = exceptionFor('transitive-pkg');
  exception.expiresAt = '2026-09-09T03:59:59.000Z';
  const receipt = evaluate(auditWith(), ledger([exception]));
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.unwaivedHighOrCritical[0].reason, 'exception-expired');
});

test('exception requires reachability evidence', () => {
  const exception = exceptionFor('transitive-pkg');
  exception.reachabilityEvidence = '';
  assert.throws(() => parseExceptionLedger(ledger([exception])), /reachabilityEvidence/);
});

test('exception expiry must be canonical UTC', () => {
  const exception = exceptionFor('transitive-pkg');
  exception.expiresAt = '2026-09-10';
  assert.throws(() => parseExceptionLedger(ledger([exception])), /canonical RFC3339 UTC/);
});

test('duplicate exact exceptions are refused', () => {
  const exception = exceptionFor('transitive-pkg');
  assert.throws(() => parseExceptionLedger(ledger([exception, exception])), /duplicate exception/);
});

test('aggregate vulnerability without a resolvable advisory remains fail-closed', () => {
  const audit = auditWith();
  audit.vulnerabilities['transitive-pkg'].via = ['nested-package'];
  const receipt = evaluate(audit);
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.match(receipt.unwaivedHighOrCritical[0].advisoryId, /^aggregate:/);
});

test('cyclic propagated vulnerability references do not recurse forever', () => {
  const audit = propagatedAudit();
  audit.vulnerabilities['@typespec/compiler'].via = ['@typespec/json-schema'];
  const findings = collectAuditFindings(audit);
  assert.ok(findings.some((finding) => finding.advisoryId.startsWith('aggregate:')));
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
