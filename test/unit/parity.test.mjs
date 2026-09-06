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
