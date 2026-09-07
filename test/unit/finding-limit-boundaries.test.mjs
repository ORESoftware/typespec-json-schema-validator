import assert from 'node:assert/strict';
import test from 'node:test';
import { compareParity } from '../../src/parity.mjs';
import { crossValidate } from '../../src/differential.mjs';

const invalidLimits = [
  ['zero', 0], ['negative', -1], ['fraction', 0.5], ['NaN', NaN],
  ['infinity', Infinity], ['above maximum', 10_001], ['null', null],
  ['false', false], ['true', true], ['string', '1'], ['object', {}],
  ['array', []], ['bigint', 1n], ['symbol', Symbol('limit')],
];

function parityInput(authoredType = 'integer') {
  const declaration = (type) => ({
    name: 'Item', kind: 'model', pointer: '#/$defs/Item',
    schema: { type: 'object', properties: { value: { type } } },
  });
  return {
    typespecInventory: {
      declarations: [{ kind: 'model', name: 'Item', qualifiedName: 'Example.Item' }],
      errors: [], ambiguities: [],
    },
    generatedCollection: { findings: [], declarations: [declaration('string')] },
    authoredCollection: { findings: [], declarations: [declaration(authoredType)] },
    mapping: { declarations: [], ignore: { typespec: [], generated: [], authored: [] } },
  };
}

function differentialInput(authoredType = 'integer') {
  const collection = (type, lane) => {
    const path = `${lane}.json`;
    const schema = { type, examples: type === 'string' ? ['sample'] : [7] };
    return {
      documents: [{ path, relativePath: path, document: { $id: path, $defs: { Item: schema } } }],
      declarations: [{ name: 'Item', schema, source: path, pointer: '#/$defs/Item' }],
    };
  };
  return {
    generatedCollection: collection('string', 'generated'),
    authoredCollection: collection(authoredType, 'authored'),
    declarationMap: [{ typespec: 'Example.Item', generated: 'Item', authored: 'Item' }],
  };
}

for (const [name, maxFindings] of invalidLimits) {
  for (const [label, compare, makeInput] of [
    ['parity', compareParity, parityInput],
    ['differential', crossValidate, differentialInput],
  ]) {
    test(`${label} rejects ${name} instead of suppressing mismatch evidence`, () => {
      assert.throws(() => compare({ ...makeInput(), maxFindings }), {
        name: 'RangeError', message: 'maxFindings must be an integer between 1 and 10000',
      });
    });
  }
}

for (const maxFindings of [1, 250, 10_000]) {
  test(`parity preserves actual drift with budget ${maxFindings}`, () => {
    const input = parityInput();
    const before = structuredClone(input);
    const result = compareParity({ ...input, maxFindings });
    assert.ok(result.findings.some((finding) => finding.ruleId === 'generated-authored-semantic-mismatch'));
    assert.ok(result.findings.length <= maxFindings);
    assert.deepEqual(input, before);
  });

  test(`differential preserves actual divergences with budget ${maxFindings}`, () => {
    const input = differentialInput();
    const before = structuredClone(input);
    const result = crossValidate({ ...input, maxFindings });
    assert.ok(result.findings.length > 0);
    assert.ok(result.findings.length <= maxFindings);
    assert.ok(result.summary.divergences > 0);
    assert.deepEqual(input, before);
  });
}

test('omitted budgets still permit equivalent authorities without fabricated findings', () => {
  assert.deepEqual(compareParity(parityInput('string')).findings, []);
  assert.deepEqual(crossValidate(differentialInput('string')).findings, []);
});

test('invalid budgets cannot hide corpus-only expectation failures', () => {
  const input = differentialInput('string');
  input.corpus = [{
    declaration: 'Item', expectation: 'rejected', path: 'Item/invalid/string.json',
    relativePath: 'Item/invalid/string.json', instance: 'sample',
  }];
  assert.throws(() => crossValidate({ ...input, maxFindings: 0 }), RangeError);
  const result = crossValidate({ ...input, maxFindings: 1 });
  assert.ok(result.findings.some((finding) => finding.ruleId === 'corpus-instance-accepted'));
});

test('caller coercion hooks are not executed while rejecting an invalid budget', () => {
  let called = false;
  const maxFindings = { [Symbol.toPrimitive]() { called = true; return 0; } };
  assert.throws(() => compareParity({ ...parityInput(), maxFindings }), RangeError);
  assert.throws(() => crossValidate({ ...differentialInput(), maxFindings }), RangeError);
  assert.equal(called, false);
});
