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

test('strict mode rejects additive world exports for implementers', () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  current.worlds[0].exports.push({ name: 'health', kind: 'function', target: 'health' });
  assert.equal(compareWitCompatibility(baseline, current, { mode: 'consumer' }).status, 'passed');
  const strict = compareWitCompatibility(baseline, current, { mode: 'strict' });
  assert.equal(strict.status, 'stopped_for_evaluation');
  assert.ok(strict.findings.some((item) => item.ruleId === 'wit-world-export-added'));
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

test('package version bumps do not masquerade as package identity changes', () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  current.package = 'ores:example@1.1.0';
  assert.equal(compareWitCompatibility(baseline, current).status, 'passed');

  current.package = 'ores:different@1.1.0';
  const changed = compareWitCompatibility(baseline, current);
  assert.equal(changed.status, 'stopped_for_evaluation');
  assert.ok(changed.findings.some((item) => item.ruleId === 'wit-package-changed'));
});

test('normalizer accepts component-model resource handle future and stream kinds', () => {
  const value = projection();
  value.interfaces[0].types.push(
    { name: 'connection', kind: 'resource', shape: 'resource' },
    { name: 'borrowed', kind: 'handle', shape: 'borrow<connection>' },
    { name: 'pending', kind: 'future', shape: 'future<status>' },
    { name: 'events', kind: 'stream', shape: 'stream<status>' },
  );
  const normalized = normalizeWitProjection(value);
  assert.deepEqual(
    normalized.interfaces[0].types.map((item) => item.kind).sort(),
    ['enum', 'future', 'handle', 'resource', 'stream'],
  );
});

test('normalizer fails closed on duplicate names and malformed package IDs', () => {
  const duplicate = projection();
  duplicate.interfaces.push(structuredClone(duplicate.interfaces[0]));
  assert.throws(() => normalizeWitProjection(duplicate), /duplicate names/u);

  const malformed = projection();
  malformed.package = 'not a wit package';
  assert.throws(() => normalizeWitProjection(malformed), /package identifier/u);
});

test('finding truncation retains the total breaking-change count', () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  baseline.interfaces[0].functions = Array.from({ length: 5 }, (_, index) => ({
    name: `f${index}`,
    params: [],
    results: [],
  }));
  current.interfaces[0].functions = [];

  const result = compareWitCompatibility(baseline, current, { maxFindings: 2 });
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.breakingChangeCount, 5);
  assert.equal(result.findings.length, 2);
  assert.equal(result.truncated, true);

  const receipt = createWitCompatibilityReceipt({ baseline, current, maxFindings: 2 });
  assert.equal(receipt.breakingChangeCount, 5);
  assert.equal(receipt.breakingChanges.length, 2);
  assert.equal(receipt.truncated, true);
});

test('normalization order is deterministic by code point rather than host locale', () => {
  const value = projection();
  value.interfaces.push({ name: 'Alpha', types: [], functions: [] });
  value.interfaces.push({ name: 'zeta', types: [], functions: [] });
  const normalized = normalizeWitProjection(value);
  assert.deepEqual(normalized.interfaces.map((item) => item.name), ['Alpha', 'client', 'zeta']);
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
