import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { BEHAVIOR_AUTHORITY, BEHAVIOR_CONTRACT_SCHEMA } from '../../src/behavior-contract.mjs';
import { inspectTypeSpecBehaviorBindings } from '../../src/formal-verification.mjs';

const packageRoot = resolve(import.meta.dirname, '../..');

function contract(overrides = {}) {
  return {
    schema: BEHAVIOR_CONTRACT_SCHEMA,
    authority: BEHAVIOR_AUTHORITY,
    operations: [
      {
        operationId: 'locks.check_ttl',
        kind: 'algorithm',
        language: 'dafny',
        executable: true,
        inputs: [{ name: 'ttl_ms', type: 'uint64', required: true }],
        output: { type: 'boolean', nullable: false },
        requires: ['ttl_ms > 0'],
        ensures: [],
        invariants: [],
        expression: null,
        algorithm: 'return ttl_ms > 0',
        effects: [],
        errors: [],
        deterministic: true,
        idempotent: true,
        pure: true,
        ...overrides,
      },
    ],
  };
}

async function source(t, text) {
  const directory = await mkdtemp(join(packageRoot, 'test', 'tmp-formal-binding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'main.tsp');
  await writeFile(entry, text);
  return entry;
}

test('formal binding resolves one TypeSpec operation and checks its signature', async (t) => {
  const entry = await source(t, `
import "@oresoftware/typespec-json-schema-validator";
using Ores.Behavior;

@behaviorRef("locks.check_ttl")
op check_ttl(ttl_ms: uint64): boolean;
`);
  const result = await inspectTypeSpecBehaviorBindings(entry, contract());
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.bindings, [
    { operationId: 'locks.check_ttl', qualifiedName: 'check_ttl' },
  ]);
});

test('formal binding fails closed on a TypeSpec parameter drift', async (t) => {
  const entry = await source(t, `
import "@oresoftware/typespec-json-schema-validator";
using Ores.Behavior;

@behaviorRef("locks.check_ttl")
op check_ttl(ttl_seconds: uint64): boolean;
`);
  const result = await inspectTypeSpecBehaviorBindings(entry, contract());
  assert.ok(result.findings.some((finding) => finding.ruleId === 'formal-typespec-parameter-mismatch'));
});
