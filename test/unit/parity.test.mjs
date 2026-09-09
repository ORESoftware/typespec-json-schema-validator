import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { canonicalStringify } from '../../src/canonical.mjs';
import { loadSchemaCollection } from '../../src/json-schema.mjs';
import { compareParity, loadMapping } from '../../src/parity.mjs';
import { runCompare } from '../../src/run.mjs';
import { inventoryTypeSpec } from '../../src/typespec-inventory.mjs';

const root = resolve(import.meta.dirname, '../fixtures');

async function compareFixture(name) {
  const fixture = resolve(root, name);
  const [typespecInventory, generatedCollection, authoredCollection, mapping] = await Promise.all([
    inventoryTypeSpec(resolve(fixture, 'main.tsp')),
    loadSchemaCollection(resolve(fixture, 'generated.schema.json')),
    loadSchemaCollection(resolve(fixture, 'authored.schema.json')),
    loadMapping(),
  ]);
  return compareParity({
    typespecInventory,
    generatedCollection,
    authoredCollection,
    mapping,
    maxFindings: 250,
  });
}

function mappedPairInput(generatedUser, authoredUser) {
  const role = { type: 'string', enum: ['admin', 'user'] };
  return {
    typespecInventory: {
      declarations: [
        { kind: 'model', name: 'User', qualifiedName: 'Example.User' },
        { kind: 'enum', name: 'Role', qualifiedName: 'Example.Role' },
      ],
      errors: [],
      ambiguities: [],
    },
    generatedCollection: {
      findings: [],
      declarations: [
        { name: 'User', kind: 'model', schema: generatedUser, pointer: '#/$defs/User' },
        { name: 'Role', kind: 'enum', schema: role, pointer: '#/$defs/Role' },
      ],
    },
    authoredCollection: {
      findings: [],
      declarations: [
        { name: 'AccountUser', kind: 'model', schema: authoredUser, pointer: '#/$defs/AccountUser' },
        { name: 'accountRole', kind: 'enum', schema: role, pointer: '#/$defs/accountRole' },
      ],
    },
    mapping: {
      declarations: [
        { typespec: 'Example.User', generated: 'User', authored: 'AccountUser' },
        { typespec: 'Example.Role', generated: 'Role', authored: 'accountRole' },
      ],
      ignore: { typespec: [], generated: [], authored: [] },
    },
  };
}

test('equivalent generated and authored schemas pass despite ordering and false-schema spelling', async () => {
  const result = await compareFixture('pass');
  assert.equal(result.findingCount, 0);
  assert.deepEqual(result.findings, []);
});

test('requiredness, type, enum, nullability, constraint, and unknown-field drift are reported', async () => {
  const result = await compareFixture('drift');
  assert.ok(result.findingCount >= 6);
  const text = canonicalStringify(result.findings);
  for (const fragment of ['required', '/type', '/enum', 'minLength', 'additionalProperties', 'unevaluatedProperties']) {
    assert.match(text, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('repeated parity comparisons emit byte-stable finding fingerprints and order', async () => {
  const first = await compareFixture('drift');
  const second = await compareFixture('drift');
  assert.equal(canonicalStringify(first), canonicalStringify(second));
});

test('explicit mappings pair differently named generated and authored declarations', () => {
  const schema = {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    unevaluatedProperties: false,
  };
  const result = compareParity({
    typespecInventory: {
      declarations: [{ kind: 'model', name: 'User', qualifiedName: 'Example.User' }],
      errors: [],
      ambiguities: [],
    },
    generatedCollection: {
      findings: [],
      declarations: [{ name: 'User', kind: 'model', schema, pointer: '#/$defs/User' }],
    },
    authoredCollection: {
      findings: [],
      declarations: [{ name: 'AccountUser', kind: 'model', schema, pointer: '#/$defs/AccountUser' }],
    },
    mapping: {
      declarations: [{ typespec: 'Example.User', generated: 'User', authored: 'AccountUser' }],
      ignore: { typespec: [], generated: [], authored: [] },
    },
  });
  assert.equal(result.findingCount, 0);
});

test('declaration mappings also pair internal top-level declaration references', () => {
  const generatedUser = {
    type: 'object',
    properties: { role: { $ref: '#/$defs/Role' } },
    required: ['role'],
  };
  const authoredUser = {
    type: 'object',
    properties: { role: { $ref: '#/$defs/accountRole' } },
    required: ['role'],
  };
  const input = mappedPairInput(generatedUser, authoredUser);
  const generatedSnapshot = structuredClone(input.generatedCollection);
  const authoredSnapshot = structuredClone(input.authoredCollection);
  const result = compareParity(input);
  assert.equal(result.findingCount, 0, canonicalStringify(result.findings));
  assert.deepEqual(input.generatedCollection, generatedSnapshot, 'generated authority must remain untouched');
  assert.deepEqual(input.authoredCollection, authoredSnapshot, 'authored authority must remain untouched');
});

test('mapping does not rewrite $ref-looking literal JSON data', () => {
  const generatedUser = {
    type: 'object',
    properties: { marker: { const: { $ref: '#/$defs/Role' } } },
  };
  const authoredUser = {
    type: 'object',
    properties: { marker: { const: { $ref: '#/$defs/accountRole' } } },
  };
  const result = compareParity(mappedPairInput(generatedUser, authoredUser));
  assert(result.findings.some(({ ruleId, pointer }) =>
    ruleId === 'generated-authored-semantic-mismatch' && pointer.endsWith('/properties/marker/const/$ref')),
  canonicalStringify(result.findings));
});

test('mapping does not guess equivalence for nested or non-top-level references', () => {
  const generatedUser = {
    type: 'object',
    properties: { role: { $ref: '#/properties/Role' } },
  };
  const authoredUser = {
    type: 'object',
    properties: { role: { $ref: '#/properties/accountRole' } },
  };
  const result = compareParity(mappedPairInput(generatedUser, authoredUser));
  assert(result.findings.some(({ ruleId, pointer }) =>
    ruleId === 'generated-authored-semantic-mismatch' && pointer.endsWith('/properties/role/$ref')),
  canonicalStringify(result.findings));
});

test('runCompare emits a passed deterministic receipt with peer-authority policy', async () => {
  const fixture = resolve(root, 'pass');
  const options = {
    typespec: resolve(fixture, 'main.tsp'),
    generatedSchema: resolve(fixture, 'generated.schema.json'),
    authoredSchema: resolve(fixture, 'authored.schema.json'),
    maxFindings: 250,
  };
  const first = await runCompare(options);
  const second = await runCompare(options);
  assert.equal(first.status, 'passed');
  assert.equal(first.authorities.precedence, 'none');
  assert.equal(first.authorities.onUnexplainedMismatch, 'STOPPED_FOR_EVALUATION');
  assert.equal(first.runId, second.runId);
});

test('runCheck generates comparison evidence without mutating either authored authority', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runCheck } = await import('../../src/run.mjs');
  const fixture = resolve(root, 'pass');
  const outputDir = await mkdtemp(join(tmpdir(), 'tsjsv-generated-'));
  const authoredPath = resolve(fixture, 'authored.schema.json');
  const typespecPath = resolve(fixture, 'main.tsp');
  const beforeAuthored = await readFile(authoredPath, 'utf8');
  const beforeTypespec = await readFile(typespecPath, 'utf8');
  const report = await runCheck({
    typespec: typespecPath,
    authoredSchema: authoredPath,
    outputDir,
    bundleId: 'typespec.generated.schema.json',
    maxFindings: 250,
    tspBin: resolve(import.meta.dirname, '../helpers/fake-tsp.mjs'),
    int64Strategy: 'string',
    sealObjectSchemas: true,
    polymorphicModelsStrategy: 'oneOf',
  });
  assert.equal(report.status, 'passed');
  assert.equal(await readFile(authoredPath, 'utf8'), beforeAuthored);
  assert.equal(await readFile(typespecPath, 'utf8'), beforeTypespec);
});
