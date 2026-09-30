import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  WIT_PROJECTION_SCHEMA,
  compareWitCompatibility,
  createWitCompatibilityReceipt,
  normalizeWitProjection,
  writeWitCompatibilityReceipt,
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
  current.package = 'ores:example@2.0.0';
  let changed = compareWitCompatibility(baseline, current);
  assert.equal(changed.status, 'stopped_for_evaluation');
  assert.ok(changed.findings.some((item) => item.ruleId === 'wit-package-identity-changed'));

  current.package = 'ores:renamed@1.1.0';
  changed = compareWitCompatibility(baseline, current);
  assert.equal(changed.status, 'stopped_for_evaluation');
  assert.ok(changed.findings.some((item) => item.ruleId === 'wit-package-identity-changed'));

  const preOne = projection();
  preOne.package = 'ores:example@0.2.6';
  const preTwo = structuredClone(preOne);
  preTwo.package = 'ores:example@0.2.7';
  assert.equal(compareWitCompatibility(preOne, preTwo).status, 'passed');
  preTwo.package = 'ores:example@0.3.0';
  assert.equal(compareWitCompatibility(preOne, preTwo).status, 'stopped_for_evaluation');
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


test('receipt writer rejects tampered finding fingerprints', async () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  current.interfaces[0].functions = [];
  const receipt = structuredClone(createWitCompatibilityReceipt({ baseline, current }));
  receipt.breakingChanges[0].message = 'tampered';
  const root = await mkdtemp(resolve(tmpdir(), 'tsjsv-wit-receipt-'));
  await assert.rejects(
    writeWitCompatibilityReceipt(resolve(root, 'receipt.json'), receipt),
    /malformed WIT compatibility evidence/u,
  );
});


test('malformed normalized WIT package versions fail closed', () => {
  const value = projection();
  value.package = 'ores:example@1.2';
  assert.throws(() => normalizeWitProjection(value), /valid full semver/u);
});
