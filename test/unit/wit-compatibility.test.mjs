import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WIT_PROJECTION_SCHEMA,
  compareWitCompatibility,
  createWitCompatibilityReceipt,
  normalizeWitProjection,
} from '../../src/wit-compatibility.mjs';

function projection() {
  return {
    schema: WIT_PROJECTION_SCHEMA,
    package: 'ores:example@1.0.0',
    interfaces: [{
      name: 'client',
      types: [{ name: 'status', kind: 'enum', shape: 'enum{ok,error}' }],
      functions: [{
        name: 'send',
        params: [{ name: 'payload', type: 'list<u8>' }],
        results: [{ name: null, type: 'result<u64,string>' }],
      }],
    }],
    worlds: [{
      name: 'sdk',
      imports: [],
      exports: [{ name: 'client', kind: 'interface', target: 'client' }],
    }],
  };
}

test('consumer mode allows additive interface functions', () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  current.interfaces[0].functions.push({ name: 'ping', params: [], results: [] });
  assert.equal(compareWitCompatibility(baseline, current, { mode: 'consumer' }).status, 'passed');
  assert.equal(compareWitCompatibility(baseline, current, { mode: 'strict' }).status, 'stopped_for_evaluation');
});

test('type shape changes and new host imports stop admission', () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  current.interfaces[0].types[0].shape = 'enum{ok,error,retry}';
  current.worlds[0].imports.push({ name: 'clock', kind: 'interface', target: 'wasi:clocks/monotonic-clock' });
  const result = compareWitCompatibility(baseline, current);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((item) => item.ruleId === 'wit-type-changed'));
  assert.ok(result.findings.some((item) => item.ruleId === 'wit-world-import-added'));
});

test('receipt is deterministic and self-digesting', () => {
  const baseline = projection();
  const current = projection();
  const a = createWitCompatibilityReceipt({ baseline, current });
  const b = createWitCompatibilityReceipt({ baseline, current });
  assert.deepEqual(a, b);
  assert.equal(a.status, 'passed');
  assert.match(a.verificationId, /^[0-9a-f]{64}$/u);
});


test('default mode is strict and rejects additive interface functions', () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  current.interfaces[0].functions.push({ name: 'ping', params: [], results: [] });
  const result = compareWitCompatibility(baseline, current);
  assert.equal(result.mode, 'strict');
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((item) => item.ruleId === 'wit-function-added'));
});

test('package semver changes do not create false breaking findings', () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  current.package = 'ores:example@1.1.0';
  assert.equal(compareWitCompatibility(baseline, current).status, 'passed');
  current.package = 'ores:renamed@1.1.0';
  const changed = compareWitCompatibility(baseline, current);
  assert.equal(changed.status, 'stopped_for_evaluation');
  assert.ok(changed.findings.some((item) => item.ruleId === 'wit-package-identity-changed'));
});

test('WIT names are rejected when they collide case-insensitively', () => {
  const value = projection();
  value.interfaces.push({ name: 'CLIENT', types: [], functions: [] });
  assert.throws(
    () => normalizeWitProjection(value),
    /case-insensitive uniqueness/u,
  );
});

test('receipt counts all breaking changes even when findings are truncated', () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  current.interfaces[0].functions = [];
  current.worlds[0].exports = [];
  const receipt = createWitCompatibilityReceipt({ baseline, current, maxFindings: 1 });
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.truncated, true);
  assert.equal(receipt.breakingChanges.length, 1);
  assert.equal(receipt.breakingChangeCount, 2);
});
