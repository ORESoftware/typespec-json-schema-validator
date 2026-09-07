import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  CONTRACT_IR_SCHEMA,
  buildContractIrTombstone,
  createContractIr,
  verifyContractIrEvidence,
  writeContractIr,
} from '../../src/contract-ir.mjs';

const hex = (character) => character.repeat(64);

function fixtures() {
  const model = {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  };
  const generatedModel = { ...structuredClone(model), title: 'Generated User', 'x-typespec-name': 'Example.User' };
  const authoredModel = { ...structuredClone(model), description: 'Authored User', 'x-typespec-name': 'Example.User' };
  const typespecInventory = {
    input: '/repo/contracts/main.tsp',
    projectRoot: '/repo/contracts',
    digest: hex('a'),
    files: [{ path: 'main.tsp', sha256: hex('1') }],
    declarations: [{
      kind: 'model', name: 'User', qualifiedName: 'Example.User', namespace: 'Example',
      file: '/repo/contracts/main.tsp', line: 2, column: 1,
    }],
    outOfScopeDeclarations: [], errors: [], ambiguities: [],
  };
  const generatedCollection = {
    input: '/repo/generated/schema.json', digest: hex('b'), findings: [],
    documents: [{ path: '/repo/generated/schema.json', relativePath: 'schema.json', sha256: hex('2'), document: {} }],
    declarations: [{ name: 'User', kind: 'model', schema: generatedModel, source: '/repo/generated/schema.json', pointer: '#/$defs/User' }],
  };
  const authoredCollection = {
    input: '/repo/contracts/authored.schema.json', digest: hex('c'), findings: [],
    documents: [{ path: '/repo/contracts/authored.schema.json', relativePath: 'authored.schema.json', sha256: hex('3'), document: {} }],
    declarations: [{ name: 'User', kind: 'model', schema: authoredModel, source: '/repo/contracts/authored.schema.json', pointer: '#/$defs/User' }],
  };
  const report = {
    schema: 'ores.typespec-json-schema-validator.report/v1',
    runId: hex('d'), status: 'passed', zeroUnexplainedFindings: true, findings: [],
    coverage: {
      directDeclarationInventory: true,
      typespecGeneratedJsonSchemaComparison: true,
      differentialInstanceValidation: true,
    },
    inputs: {
      typespec: { input: 'contracts/main.tsp', digest: hex('a'), files: typespecInventory.files },
      generatedJsonSchema: { input: 'generated/schema.json', digest: hex('b'), files: generatedCollection.documents },
      authoredJsonSchema: { input: 'contracts/authored.schema.json', digest: hex('c'), files: authoredCollection.documents },
    },
    declarationMap: [{ typespec: 'Example.User', kind: 'model', generated: 'User', authored: 'User' }],
    toolchain: { validator: { version: '0.1.0' } },
    configuration: { mode: 'check' },
    differential: { summary: { agreements: 4, divergences: 0 } },
  };
  return { report, typespecInventory, generatedCollection, authoredCollection };
}

function build(overrides = {}) {
  const values = fixtures();
  return createContractIr({ ...values, ...overrides });
}

test('builds a deterministic admissible Contract IR', () => {
  const first = build();
  const second = build();
  assert.equal(first.schema, CONTRACT_IR_SCHEMA);
  assert.equal(first.status, 'passed');
  assert.equal(first.admissible, true);
  assert.equal(first.editableAuthority, false);
  assert.equal(canonicalStringify(first), canonicalStringify(second));
  const body = { ...first }; delete body.irId;
  assert.equal(first.irId, sha256(canonicalStringify(body)));
});

test('retains both peer lanes without selecting precedence', () => {
  const ir = build();
  assert.equal(ir.authorities.typespec, 'independently-authored');
  assert.equal(ir.authorities.jsonSchema, 'independently-authored');
  assert.equal(ir.authorities.generatedJsonSchema, 'comparison-evidence-only');
  assert.equal(ir.authorities.precedence, 'none');
  assert.equal(ir.declarations[0].lanes.authoredJsonSchema.normalizedSchema.description, 'Authored User');
  assert.equal(ir.declarations[0].lanes.typespecGeneratedJsonSchema.normalizedSchema.title, 'Generated User');
});

test('binds the exact receipt and all three input digests', () => {
  const { report } = fixtures();
  const ir = build();
  assert.equal(ir.admission.receipt.runId, report.runId);
  assert.equal(ir.admission.receipt.digest, sha256(canonicalStringify(report)));
  assert.equal(ir.provenance.typespec.digest, report.inputs.typespec.digest);
  assert.equal(ir.provenance.generatedJsonSchema.digest, report.inputs.generatedJsonSchema.digest);
  assert.equal(ir.provenance.authoredJsonSchema.digest, report.inputs.authoredJsonSchema.digest);
});

test('exports only a common assertion schema while retaining lane schemas', () => {
  const ir = build();
  const declaration = ir.declarations[0];
  assert.deepEqual(declaration.assertionSchema, {
    additionalProperties: false,
    properties: { id: { type: 'string' } },
    required: ['id'],
    type: 'object',
    'x-typespec-name': 'Example.User',
  });
  assert.equal(declaration.assertionDigest, sha256(canonicalStringify(declaration.assertionSchema)));
});

test('rejects a non-passed receipt', () => {
  const values = fixtures(); values.report.status = 'stopped_for_evaluation';
  assert.throws(() => createContractIr(values), /receipt status must be passed/);
});

test('rejects a nominal pass that still contains findings', () => {
  const values = fixtures(); values.report.findings.push({ ruleId: 'x' });
  assert.throws(() => createContractIr(values), /receipt findings must be empty/);
});

test('rejects a pass without differential validation', () => {
  const values = fixtures(); values.report.coverage.differentialInstanceValidation = false;
  assert.throws(() => createContractIr(values), /differential instance validation was not executed/);
});

for (const [label, target, digest, pattern] of [
  ['TypeSpec', 'typespecInventory', hex('e'), /TypeSpec input digest/],
  ['generated', 'generatedCollection', hex('e'), /generated JSON Schema digest/],
  ['authored', 'authoredCollection', hex('e'), /authored JSON Schema digest/],
]) {
  test(`rejects stale ${label} evidence`, () => {
    const values = fixtures(); values[target].digest = digest;
    assert.throws(() => createContractIr(values), pattern);
  });
}

test('rejects semantic drift after the receipt', () => {
  const values = fixtures();
  values.authoredCollection.declarations[0].schema.properties.id.type = 'number';
  assert.throws(() => createContractIr(values), /assertion schemas no longer converge/);
});

test('rejects a missing mapped declaration', () => {
  const values = fixtures(); values.generatedCollection.declarations = [];
  assert.throws(() => createContractIr(values), /mapped generated declaration is missing/);
});

test('records explicit excluded and out-of-scope declarations', () => {
  const values = fixtures();
  values.typespecInventory.declarations.push({
    kind: 'model', name: 'Ignored', qualifiedName: 'Example.Ignored', namespace: 'Example',
    file: '/repo/contracts/main.tsp', line: 5, column: 1,
  });
  values.generatedCollection.declarations.push({ name: 'Ignored', kind: 'model', schema: {}, source: '/repo/generated/schema.json', pointer: '#/$defs/Ignored' });
  values.authoredCollection.declarations.push({ name: 'Ignored', kind: 'model', schema: {}, source: '/repo/contracts/authored.schema.json', pointer: '#/$defs/Ignored' });
  values.typespecInventory.outOfScopeDeclarations.push({
    kind: 'op', qualifiedName: 'Example.read', file: '/repo/contracts/main.tsp', line: 8, column: 1,
    reason: 'not representable as a JSON Schema declaration',
  });
  const ir = createContractIr(values);
  assert.equal(ir.excludedDeclarations.length, 3);
  assert.equal(ir.outOfScopeDeclarations.length, 1);
  assert.equal(ir.admission.scope.complete, false);
});

test('published Contract IR schema declares the versioned closed envelope', async () => {
  const schema = JSON.parse(await readFile(new URL('../../schema/contract-ir.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schema.const, CONTRACT_IR_SCHEMA);
  assert.equal(schema.additionalProperties, false);
});

test('verification accepts the exact artifact and exact evidence', () => {
  const values = fixtures();
  const contractIr = createContractIr(values);
  const result = verifyContractIrEvidence({ contractIr, ...values });
  assert.equal(result.status, 'passed');
  assert.equal(result.admissible, true);
  assert.equal(result.expectedIrId, contractIr.irId);
});

test('rejects duplicate declaration identities in a receipt', () => {
  const values = fixtures();
  values.report.declarationMap.push({ ...values.report.declarationMap[0] });
  assert.throws(() => createContractIr(values), /declarationMap repeats typespec identity/);
});

test('verification fails closed when the artifact is tampered', () => {
  const values = fixtures();
  const ir = createContractIr(values);
  const tampered = structuredClone(ir);
  tampered.declarations[0].assertionSchema.type = 'string';
  const result = verifyContractIrEvidence({ contractIr: tampered, ...values });
  assert.equal(result.status, 'failed');
  assert.equal(result.admissible, false);
});

test('tombstones are deterministic, bound, and never admissible', () => {
  const { report } = fixtures(); report.status = 'failed'; report.zeroUnexplainedFindings = false;
  const first = buildContractIrTombstone(report, 'contract-ir-export-failed');
  const second = buildContractIrTombstone(report, 'contract-ir-export-failed');
  assert.equal(first.admissible, false);
  assert.equal(first.status, 'failed');
  assert.equal(first.admission.receipt.runId, report.runId);
  assert.equal(canonicalStringify(first), canonicalStringify(second));
});

test('safe writer replaces its own IR but refuses unrelated files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tsjsv-ir-'));
  const path = join(dir, 'contract-ir.json');
  const ir = build();
  await writeContractIr(path, ir);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).irId, ir.irId);
  const tombstone = buildContractIrTombstone({ ...fixtures().report, status: 'failed', zeroUnexplainedFindings: false });
  await writeContractIr(path, tombstone);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).admissible, false);

  const unrelated = join(dir, 'source.tsp');
  await writeFile(unrelated, 'model User {}');
  await assert.rejects(writeContractIr(unrelated, ir), /not validator-owned Contract IR/);
  assert.equal(await readFile(unrelated, 'utf8'), 'model User {}');
});

test('safe writer refuses symbolic-link destinations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tsjsv-ir-link-'));
  const target = join(dir, 'target.json');
  const link = join(dir, 'contract-ir.json');
  await writeFile(target, '{}');
  await symlink(target, link);
  await assert.rejects(writeContractIr(link, build()), /non-symlink/);
});
