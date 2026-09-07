import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import { createContractIr, verifyContractIrEvidence } from '../../src/contract-ir.mjs';

const hex = (character) => character.repeat(64);
const digest = (value) => sha256(canonicalStringify(value));

// Loaded-evidence unit fixtures, not compiler attestations. The real compiler
// and checked-out input closure remain covered by the integration suite.
function evidence(generatedSchema, authoredSchema = generatedSchema) {
  const typespecInventory = {
    input: '/repo/contracts/main.tsp', projectRoot: '/repo/contracts', digest: hex('a'),
    files: [{ path: 'main.tsp', sha256: hex('1') }],
    declarations: [{ kind: 'model', name: 'User', qualifiedName: 'Example.User',
      namespace: 'Example', file: '/repo/contracts/main.tsp', line: 2, column: 1 }],
    outOfScopeDeclarations: [], errors: [], ambiguities: [],
  };
  const collection = (input, character, schema) => ({
    input, digest: hex(character), findings: [],
    documents: [{ path: input, relativePath: 'schema.json', sha256: hex(character), document: {} }],
    declarations: [{ name: 'User', kind: 'model', schema: structuredClone(schema),
      source: input, pointer: '#/$defs/User' }],
  });
  const generatedCollection = collection('/repo/generated/schema.json', 'b', generatedSchema);
  const authoredCollection = collection('/repo/authored/schema.json', 'c', authoredSchema);
  const report = {
    schema: 'ores.typespec-json-schema-validator.report/v1', runId: hex('d'),
    status: 'passed', zeroUnexplainedFindings: true, findings: [],
    coverage: { directDeclarationInventory: true, typespecGeneratedJsonSchemaComparison: true,
      differentialInstanceValidation: true },
    inputs: {
      typespec: { input: typespecInventory.input, digest: typespecInventory.digest, files: typespecInventory.files },
      generatedJsonSchema: { input: generatedCollection.input, digest: generatedCollection.digest, files: generatedCollection.documents },
      authoredJsonSchema: { input: authoredCollection.input, digest: authoredCollection.digest, files: authoredCollection.documents },
    },
    declarationMap: [{ typespec: 'Example.User', kind: 'model', generated: 'User', authored: 'User' }],
    toolchain: { validator: { version: 'unit-fixture' } }, configuration: { mode: 'check' },
  };
  return { report, typespecInventory, generatedCollection, authoredCollection };
}

for (const name of ['title', 'description', 'default', '$id', 'definitions', '__proto__']) {
  test(`Contract IR retains a property named ${name} and refuses its constraint drift`, () => {
    const schema = { type: 'object', properties: Object.fromEntries([[name, { type: 'string', minLength: 2 }]]) };
    const values = evidence(schema);
    const ir = createContractIr(values);
    assert.deepEqual(ir.declarations[0].assertionSchema.properties[name], { type: 'string', minLength: 2 });
    values.authoredCollection.declarations[0].schema.properties[name].minLength = 3;
    assert.throws(() => createContractIr(values), /assertion schemas no longer converge/);
    assert.equal(verifyContractIrEvidence({ contractIr: ir, ...values }).admissible, false);
  });
}

for (const key of ['enum', 'required', 'type', 'allOf', 'anyOf', 'oneOf']) {
  test(`Contract IR refuses reordered literal ${key} arrays in const`, () => {
    const generated = { type: 'object', const: { [key]: [2, 1] } };
    const authored = { type: 'object', const: { [key]: [1, 2] } };
    assert.throws(() => createContractIr(evidence(generated, authored)), /assertion schemas no longer converge/);
  });
}

test('Contract IR refuses duplicate-exclusive branches versus a weakened single branch', () => {
  const duplicate = { oneOf: [{ type: 'string' }, { type: 'string' }] };
  const weakened = { type: ['string'] };
  assert.throws(() => createContractIr(evidence(duplicate, weakened)), /assertion schemas no longer converge/);
});

test('Contract IR refuses overlapping number/integer oneOf versus an inclusive union', () => {
  const exclusive = { oneOf: [{ type: 'number' }, { type: 'integer' }] };
  const inclusive = { type: ['integer', 'number'] };
  assert.throws(() => createContractIr(evidence(exclusive, inclusive)), /assertion schemas no longer converge/);
});

test('literal-array tampering changes the IR self digest and cannot pass with a rehashed envelope', () => {
  const values = evidence({ type: 'object', const: { enum: [2, 1] } });
  const ir = createContractIr(values);
  const changed = structuredClone(ir);
  changed.declarations[0].assertionSchema.const.enum.reverse();
  assert.equal(verifyContractIrEvidence({ contractIr: changed, ...values }).admissible, false);
  const body = { ...changed }; delete body.irId;
  assert.notEqual(digest(body), ir.irId);
  changed.irId = digest(body);
  assert.equal(verifyContractIrEvidence({ contractIr: changed, ...values }).admissible, false);
});

test('receipt binding retains ordered configuration arrays even when named like keywords', () => {
  const values = evidence({ type: 'object' });
  values.report.configuration = { enum: ['first', 'second'] };
  const ir = createContractIr(values);
  values.report.configuration.enum.reverse();
  const replacement = createContractIr(values);
  assert.notEqual(replacement.admission.receipt.digest, ir.admission.receipt.digest);
  assert.notEqual(replacement.irId, ir.irId);
  assert.equal(verifyContractIrEvidence({ contractIr: ir, ...values }).admissible, false);
});

test('both lanes still converge across genuine annotation and unordered schema-keyword differences', () => {
  const values = evidence(
    { title: 'generated', type: 'object', properties: { title: { type: 'string' }, id: { type: 'string' } }, required: ['title', 'id'] },
    { description: 'authored', type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'] },
  );
  const ir = createContractIr(values);
  assert.equal(verifyContractIrEvidence({ contractIr: ir, ...values }).admissible, true);
  assert.equal(ir.authorities.precedence, 'none');
});
