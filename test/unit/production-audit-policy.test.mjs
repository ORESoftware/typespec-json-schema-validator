import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateProductionAudit, EXCEPTION } from '../../scripts/check-production-audit.mjs';

function lock(version = EXCEPTION.version, openapi = false) {
  return {
    lockfileVersion: 3,
    packages: {
      'node_modules/@typespec/compiler': { version },
      ...(openapi ? { 'node_modules/@typespec/openapi3': { version: '1.15.0' } } : {}),
    },
  };
}

function rootVia(url = EXCEPTION.url) {
  return {
    source: 123,
    name: '@typespec/compiler',
    dependency: '@typespec/compiler',
    title: 'bounded test advisory',
    url,
    severity: 'high',
    range: '<=1.15.0',
  };
}

function audit(extra = {}) {
  const vulnerabilities = {
    '@typespec/compiler': { name: '@typespec/compiler', severity: 'high', via: [rootVia()], effects: ['@typespec/asset-emitter', '@typespec/json-schema'] },
    '@typespec/asset-emitter': { name: '@typespec/asset-emitter', severity: 'high', via: ['@typespec/compiler'], effects: ['@typespec/json-schema'] },
    '@typespec/json-schema': { name: '@typespec/json-schema', severity: 'high', via: ['@typespec/compiler', '@typespec/asset-emitter'], effects: [] },
    ...(extra.vulnerabilities ?? {}),
  };
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: Object.keys(vulnerabilities).length, critical: 0, total: Object.keys(vulnerabilities).length } },
  };
}

const beforeExpiry = new Date('2026-09-09T04:00:00Z');

test('allows only the exact known TypeSpec advisory before expiry', () => {
  const result = evaluateProductionAudit({ audit: audit(), lock: lock(), now: beforeExpiry });
  assert.equal(result.status, 'passed_with_temporary_exception');
  assert.equal(result.advisory, EXCEPTION.advisory);
  assert.deepEqual(result.affectedEntries, ['@typespec/asset-emitter', '@typespec/compiler', '@typespec/json-schema']);
});

test('rejects any additional high or critical advisory', () => {
  const report = audit({ vulnerabilities: { 'other-package': { name: 'other-package', severity: 'high', via: [{ ...rootVia('https://github.com/advisories/GHSA-aaaa-bbbb-cccc'), name: 'other-package' }], effects: [] } } });
  assert.throws(() => evaluateProductionAudit({ audit: report, lock: lock(), now: beforeExpiry }), /unexpected high\/critical package/);
});

test('rejects compiler drift and OpenAPI3 entering the production graph', () => {
  assert.throws(() => evaluateProductionAudit({ audit: audit(), lock: lock('1.15.1'), now: beforeExpiry }), /exactly 1\.15\.0/);
  assert.throws(() => evaluateProductionAudit({ audit: audit(), lock: lock(EXCEPTION.version, true), now: beforeExpiry }), /openapi3 entered/);
});

test('expires automatically and refuses a silently disappeared advisory', () => {
  assert.throws(() => evaluateProductionAudit({ audit: audit(), lock: lock(), now: new Date(EXCEPTION.expires) }), /exception expired/);
  const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { high: 0, critical: 0 } } };
  assert.throws(() => evaluateProductionAudit({ audit: clean, lock: lock(), now: beforeExpiry }), /advisory disappeared/);
});

test('rejects malformed audit data and a changed advisory URL', () => {
  assert.throws(() => evaluateProductionAudit({ audit: {}, lock: lock(), now: beforeExpiry }), /malformed npm audit/);
  const changed = audit();
  changed.vulnerabilities['@typespec/compiler'].via = [rootVia('https://github.com/advisories/GHSA-zzzz-yyyy-xxxx')];
  assert.throws(() => evaluateProductionAudit({ audit: changed, lock: lock(), now: beforeExpiry }), /unexpected high\/critical advisory/);
});
