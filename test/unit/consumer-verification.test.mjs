import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyConsumerContract } from '../../src/consumer-verification.mjs';
const hex = (value) => value.repeat(64);
function fixture() {
  return {
    contractIr: {
      schema: 'ores.typespec-json-schema-validator.contract-ir/v1',
      status: 'passed', admissible: true, irId: hex('a'),
      admission: { scope: { complete: true, admittedDeclarations: 2, excludedDeclarations: 0, outOfScopeDeclarations: 0 } },
      declarations: [{ id: 'Example.User' }, { id: 'Example.Role' }],
      excludedDeclarations: [], outOfScopeDeclarations: [],
    },
    report: { runId: hex('b') }, typespec: '/repo/main.tsp',
    generatedSchema: '/repo/witness', authoredSchema: '/repo/authored.json',
    expectedDeclarations: ['Example.Role', 'Example.User'],
  };
}
function passed({ contractIr, report }) {
  return { schema: 'ores.typespec-json-schema-validator.contract-ir-verification/v1',
    status: 'passed', admissible: true, suppliedIrId: contractIr.irId,
    computedIrId: contractIr.irId, expectedIrId: contractIr.irId, receiptRunId: report.runId };
}
test('invokes the canonical verifier with explicit caller paths and preserves inputs', async () => {
  const options = fixture(); const original = structuredClone(options); let calls = 0;
  const result = await verifyConsumerContract(options, async (actual) => {
    calls++;
    assert.deepEqual(actual, { contractIr: options.contractIr, report: options.report,
      typespec: options.typespec, generatedSchema: options.generatedSchema, authoredSchema: options.authoredSchema });
    return passed(actual);
  });
  assert.equal(calls, 1); assert.deepEqual(options, original);
  assert.deepEqual(result.declarationIds, ['Example.Role', 'Example.User']);
  assert.deepEqual(result.excludedDeclarationIds, []);
  assert.deepEqual(result.outOfScopeDeclarationIds, []);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.declarationIds), true);
  assert.equal(Object.isFrozen(result.excludedDeclarationIds), true);
  assert.equal(Object.isFrozen(result.outOfScopeDeclarationIds), true);
});

test('admits only explicitly reviewed compiler helpers and non-schema declarations', async () => {
  const options = fixture();
  options.contractIr.admission.scope = {
    complete: false,
    admittedDeclarations: 2,
    excludedDeclarations: 1,
    outOfScopeDeclarations: 2,
  };
  options.contractIr.excludedDeclarations = [
    { authority: 'typespec-generated-json-schema', id: 'RecordUnknown', kind: 'model' },
  ];
  options.contractIr.outOfScopeDeclarations = [
    { authority: 'typespec', id: 'Ores.table', kind: 'dec', reason: 'not representable as a JSON Schema declaration' },
    { authority: 'typespec', id: '$decorators', kind: 'const', reason: 'not representable as a JSON Schema declaration' },
  ];
  options.expectedExcludedDeclarations = ['typespec-generated-json-schema:RecordUnknown'];
  options.expectedOutOfScopeDeclarations = ['typespec:Ores.table', 'typespec:$decorators'];

  const result = await verifyConsumerContract(options, passed);
  assert.deepEqual(result.excludedDeclarationIds, ['typespec-generated-json-schema:RecordUnknown']);
  assert.deepEqual(result.outOfScopeDeclarationIds, ['typespec:$decorators', 'typespec:Ores.table']);
});

for (const [label, mutate] of [
  ['missing TypeSpec path', (x) => { delete x.typespec; }],
  ['missing authored path', (x) => { x.authoredSchema = ''; }],
  ['missing witness path', (x) => { x.generatedSchema = ' '; }],
  ['empty expected inventory', (x) => { x.expectedDeclarations = []; }],
  ['duplicate expected inventory', (x) => { x.expectedDeclarations.push('Example.User'); }],
  ['invalid expected identity', (x) => { x.expectedDeclarations[0] = null; }],
  ['duplicate reviewed exclusion', (x) => { x.expectedExcludedDeclarations = ['typespec:X', 'typespec:X']; }],
  ['invalid reviewed out-of-scope identity', (x) => { x.expectedOutOfScopeDeclarations = ['']; }],
  ['unknown IR version', (x) => { x.contractIr.schema += '/unknown'; }],
  ['tombstone', (x) => { x.contractIr.admissible = false; }],
  ['copied string true', (x) => { x.contractIr.admissible = 'true'; }],
  ['stopped IR', (x) => { x.contractIr.status = 'stopped_for_evaluation'; }],
  ['incomplete scope', (x) => { x.contractIr.admission.scope.complete = false; }],
  ['excluded declarations', (x) => { x.contractIr.excludedDeclarations.push({ authority: 'typespec', id: 'Hidden' }); }],
  ['out-of-scope operations', (x) => { x.contractIr.outOfScopeDeclarations.push({ authority: 'typespec', id: 'read' }); }],
  ['missing inventory', (x) => { delete x.contractIr.declarations; }],
  ['partial inventory', (x) => { x.contractIr.declarations.pop(); }],
  ['duplicate actual identity', (x) => { x.contractIr.declarations[0].id = 'Example.Role'; }],
  ['inconsistent count', (x) => { x.contractIr.admission.scope.admittedDeclarations = 3; }],
]) test(`rejects ${label} before attempting evidence verification`, async () => {
  const options = fixture(); mutate(options);
  await assert.rejects(verifyConsumerContract(options, () => { assert.fail('must fail before verifier'); }), /STOPPED_FOR_EVALUATION/);
});

test('rejects reviewed exclusion inventories that omit or invent declarations', async () => {
  const options = fixture();
  options.contractIr.admission.scope = {
    complete: false,
    admittedDeclarations: 2,
    excludedDeclarations: 1,
    outOfScopeDeclarations: 0,
  };
  options.contractIr.excludedDeclarations = [
    { authority: 'typespec-generated-json-schema', id: 'RecordUnknown' },
  ];
  options.expectedExcludedDeclarations = ['typespec-generated-json-schema:DifferentHelper'];
  await assert.rejects(
    verifyConsumerContract(options, () => { assert.fail('must fail before verifier'); }),
    /excluded declaration inventory does not match/,
  );
});

for (const [label, mutate] of [
  ['failed verification', (x) => { x.status = 'failed'; }],
  ['non-admissible verification', (x) => { x.admissible = false; }],
  ['unknown verifier schema', (x) => { x.schema = 'other'; }],
  ['tampered self digest', (x) => { x.computedIrId = hex('c'); }],
  ['stale expected digest', (x) => { x.expectedIrId = hex('c'); }],
  ['wrong supplied artifact', (x) => { x.suppliedIrId = hex('c'); }],
  ['different receipt', (x) => { x.receiptRunId = hex('c'); }],
]) test(`rejects ${label} despite copied green fields`, async () => {
  await assert.rejects(verifyConsumerContract(fixture(), (args) => {
    const result = passed(args); mutate(result); return result;
  }), /STOPPED_FOR_EVALUATION/);
});
test('verifier exceptions are failures, never a status-only fallback', async () => {
  await assert.rejects(verifyConsumerContract(fixture(), () => { throw new Error('unresolved reference'); }), /unresolved reference/);
});
test('missing verification result is not success', async () => {
  await assert.rejects(verifyConsumerContract(fixture(), () => undefined), /canonical evidence verification failed/);
});
