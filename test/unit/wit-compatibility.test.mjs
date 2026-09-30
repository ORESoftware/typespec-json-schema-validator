import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WIT_PROJECTION_SCHEMA,
  compareWitCompatibility,
  createWitCompatibilityReceipt,
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


test('provider mode protects implementers while consumer mode protects callers', () => {
  const baseline = projection();
  const added = structuredClone(baseline);
  added.interfaces[0].functions.push({ name: 'ping', params: [], results: [] });
  added.worlds[0].exports.push({ name: 'health', kind: 'function', target: 'ping' });

  assert.equal(compareWitCompatibility(baseline, added, { mode: 'consumer' }).status, 'passed');
  const providerAdded = compareWitCompatibility(baseline, added, { mode: 'provider' });
  assert.equal(providerAdded.status, 'stopped_for_evaluation');
  assert.ok(providerAdded.findings.some((item) => item.ruleId === 'wit-function-added'));
  assert.ok(providerAdded.findings.some((item) => item.ruleId === 'wit-world-export-added'));

  const removed = structuredClone(baseline);
  removed.interfaces[0].functions = [];
  removed.worlds[0].exports = [];
  assert.equal(compareWitCompatibility(baseline, removed, { mode: 'provider' }).status, 'passed');
  assert.equal(compareWitCompatibility(baseline, removed, { mode: 'consumer' }).status, 'stopped_for_evaluation');
});

test('world imports are directional across consumer and provider modes', () => {
  const baseline = projection();
  baseline.worlds[0].imports.push({ name: 'clock', kind: 'interface', target: 'wasi:clocks/monotonic-clock' });

  const removed = structuredClone(baseline);
  removed.worlds[0].imports = [];
  assert.equal(compareWitCompatibility(baseline, removed, { mode: 'consumer' }).status, 'passed');
  assert.equal(compareWitCompatibility(baseline, removed, { mode: 'provider' }).status, 'stopped_for_evaluation');

  const added = projection();
  added.worlds[0].imports.push({ name: 'clock', kind: 'interface', target: 'wasi:clocks/monotonic-clock' });
  assert.equal(compareWitCompatibility(projection(), added, { mode: 'provider' }).status, 'passed');
  assert.equal(compareWitCompatibility(projection(), added, { mode: 'consumer' }).status, 'stopped_for_evaluation');
});

test('package version changes do not masquerade as package identity breaks', () => {
  const baseline = projection();
  const current = projection();
  current.package = 'ores:example@1.1.0';
  assert.equal(compareWitCompatibility(baseline, current).status, 'passed');

  current.package = 'ores:other@1.1.0';
  const changed = compareWitCompatibility(baseline, current);
  assert.equal(changed.status, 'stopped_for_evaluation');
  assert.ok(changed.findings.some((item) => item.ruleId === 'wit-package-identity-changed'));
});

test('strict mode rejects newly added types, interfaces, and worlds', () => {
  const baseline = projection();
  const current = projection();
  current.interfaces[0].types.push({ name: 'code', kind: 'alias', shape: 'u32' });
  current.interfaces.push({ name: 'admin', types: [], functions: [] });
  current.worlds.push({ name: 'admin-world', imports: [], exports: [] });
  const result = compareWitCompatibility(baseline, current, { mode: 'strict' });
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((item) => item.ruleId === 'wit-type-added'));
  assert.ok(result.findings.some((item) => item.ruleId === 'wit-interface-added'));
  assert.ok(result.findings.some((item) => item.ruleId === 'wit-world-added'));
});
