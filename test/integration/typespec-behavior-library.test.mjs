import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import test from 'node:test';

import { compile, NodeHost } from '@typespec/compiler';
import {
  getTypeSpecBehavior,
  getTypeSpecBehaviorRef,
} from '../../src/typespec-behavior.mjs';

const packageRoot = resolve(import.meta.dirname, '../..');

async function compileSource(t, source) {
  const directory = await mkdtemp(join(packageRoot, 'test', 'tmp-typespec-behavior-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'main.tsp');
  await writeFile(entry, source);
  return compile(NodeHost, entry, { noEmit: true, warningAsError: true });
}

const payload = `#{
  kind: "predicate",
  language: "cel",
  executable: true,
  inputs: #[#{ name: "age", type: "int32", required: true }],
  output: #{ type: "boolean", nullable: false },
  requires: #["age >= 0"],
  ensures: #[],
  invariants: #[],
  expression: "age >= 65",
  algorithm: null,
  effects: #[],
  errors: #[],
  deterministic: true,
  idempotent: true,
  pure: true
}`;

test('package TypeSpec entrypoint exposes typed behavior decorators and accessors', async (t) => {
  const program = await compileSource(t, `
import "@oresoftware/typespec-json-schema-validator";
using Ores.Behavior;

@behavior(${payload})
@behaviorRef("eligible_for_discount")
op eligible_for_discount(age: int32): boolean;
`);

  assert.deepEqual(program.diagnostics, []);
  const operation = program.getGlobalNamespaceType().operations.get('eligible_for_discount');
  assert.ok(operation, 'compiled operation must be discoverable');

  const behavior = getTypeSpecBehavior(program, operation);
  assert.ok(behavior, 'decorator metadata must be stored on the operation');
  assert.equal(behavior.kind, 'predicate');
  assert.equal(behavior.language, 'cel');
  assert.equal(behavior.expression, 'age >= 65');
  assert.deepEqual(behavior.inputs, [{ name: 'age', type: 'int32', required: true }]);
  assert.equal(getTypeSpecBehaviorRef(program, operation), 'eligible_for_discount');
});

test('TypeSpec rejects invalid behavior metadata before an emitter sees it', async (t) => {
  const program = await compileSource(t, `
import "@oresoftware/typespec-json-schema-validator";
using Ores.Behavior;

@behavior(#{
  kind: "not_a_behavior_kind",
  language: "cel",
  executable: true,
  inputs: #[],
  output: null,
  requires: #[],
  ensures: #[],
  invariants: #[],
  expression: "true",
  algorithm: null,
  effects: #[],
  errors: #[],
  deterministic: true,
  idempotent: true,
  pure: true
})
op invalid(): boolean;
`);

  assert.ok(program.diagnostics.length > 0, 'invalid literal must produce a compiler diagnostic');
  assert.ok(program.diagnostics.some((diagnostic) => String(diagnostic.message).includes('not_a_behavior_kind')));
});
