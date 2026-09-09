import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyConsumerContract } from '../../src/consumer-verification.mjs';

const seed = () => ({
  contractIr: {
    schema: 'ores.typespec-json-schema-validator.contract-ir/v1',
    status: 'passed', admissible: true, irId: 'a'.repeat(64),
    admission: { scope: { complete: true, admittedDeclarations: 1 } },
    excludedDeclarations: [], outOfScopeDeclarations: [],
    declarations: [{ id: 'Domain.Item' }],
  },
  report: { runId: 'b'.repeat(64) },
  expectedDeclarations: ['Domain.Item'],
  typespec: 'main.tsp', generatedSchema: 'generated.json', authoredSchema: 'authored.json',
});
const canonicalResult = () => ({
  schema: 'ores.typespec-json-schema-validator.contract-ir-verification/v1',
  status: 'passed', admissible: true,
  suppliedIrId: 'a'.repeat(64), computedIrId: 'a'.repeat(64), expectedIrId: 'a'.repeat(64),
  receiptRunId: 'b'.repeat(64),
});
function inherited(value) {
  const values = new Array(1);
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, '0', { value, configurable: true });
  Object.setPrototypeOf(values, prototype);
  return values;
}
for (const [name, change] of [
  ['matching sparse inventories', (o) => {
    o.expectedDeclarations = new Array(1); o.contractIr.declarations = new Array(1);
  }],
  ['inherited expected identity', (o) => { o.expectedDeclarations = inherited('Domain.Item'); }],
  ['inherited admitted declaration', (o) => { o.contractIr.declarations = inherited({ id: 'Domain.Item' }); }],
  ['own undefined expected identity', (o) => { o.expectedDeclarations = [undefined]; }],
  ['own undefined admitted declaration', (o) => { o.contractIr.declarations = [undefined]; }],
  ['empty admitted inventory', (o) => { o.contractIr.declarations = []; }],
]) {
  test(`${name} is refused before canonical evidence verification`, async () => {
    const options = seed(); change(options);
    const expected = options.expectedDeclarations;
    const declarations = options.contractIr.declarations;
    let calls = 0;
    await assert.rejects(verifyConsumerContract(options, () => {
      calls++; return canonicalResult();
    }), /^Error: STOPPED_FOR_EVALUATION:/);
    assert.equal(calls, 0, 'malformed scope must not reach the canonical verifier');
    assert.equal(options.expectedDeclarations, expected);
    assert.equal(options.contractIr.declarations, declarations);
    if (name.includes('sparse')) {
      assert.equal(Object.hasOwn(expected, 0), false);
      assert.equal(Object.hasOwn(declarations, 0), false);
    }
  });
}
test('dense explicit inventories preserve admission and frozen normalized results', async () => {
  const options = seed();
  const before = structuredClone(options);
  let calls = 0;
  const result = await verifyConsumerContract(options, () => { calls++; return canonicalResult(); });
  assert.equal(calls, 1);
  assert.equal(result.admissible, true);
  assert.deepEqual(result.declarationIds, ['Domain.Item']);
  assert.deepEqual(options, before);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.declarationIds));
});
