import assert from 'node:assert/strict';
import test from 'node:test';
import { deepDiff } from '../../src/canonical.mjs';

const invalidLimits = [
  ['zero', 0], ['negative zero', -0], ['negative integer', -1],
  ['fraction below one', 0.5], ['fraction above one', 1.5],
  ['NaN', NaN], ['positive infinity', Infinity], ['negative infinity', -Infinity],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 1], ['above CLI ceiling', 10_001],
  ['false', false], ['true', true], ['numeric string', '1'], ['zero string', '0'],
  ['empty string', ''], ['array', []], ['object', {}], ['boxed number', new Number(1)],
  ['bigint', 1n], ['symbol', Symbol('limit')],
];

for (const [name, maxFindings] of invalidLimits) {
  test(`deepDiff rejects ${name} rather than returning misleading evidence`, () => {
    assert.throws(
      () => deepDiff({ type: 'string' }, { type: 'integer' }, { maxFindings }),
      { name: 'RangeError', message: 'maxFindings must be an integer between 1 and 10000' },
    );
  });
}

test('default and nullish legacy deepDiff limits retain real differences', () => {
  const left = { type: 'string' };
  const right = { type: 'integer' };
  const expected = deepDiff(left, right);
  assert.equal(expected.differences.length, 1);
  assert.deepEqual(deepDiff(left, right, { maxFindings: undefined }), expected);
  assert.deepEqual(deepDiff(left, right, { maxFindings: null }), expected);
});

for (const maxFindings of [1, 250, 10_000]) {
  test(`deepDiff accepts the valid budget ${maxFindings}`, () => {
    const left = { a: 1, b: 2 };
    const right = { a: 3, b: 4 };
    const result = deepDiff(left, right, { maxFindings });
    assert.equal(result.differences.length, Math.min(2, maxFindings));
    assert.deepEqual(left, { a: 1, b: 2 });
    assert.deepEqual(right, { a: 3, b: 4 });
    assert.deepEqual(result, deepDiff(left, right, { maxFindings }));
  });
}

test('invalid budgets are rejected even for identical input', () => {
  const schema = Object.freeze({ type: 'string' });
  assert.throws(() => deepDiff(schema, schema, { maxFindings: 0 }), RangeError);
});

test('valid budgets do not manufacture findings for equal inputs', () => {
  assert.deepEqual(deepDiff({ a: [1, 2] }, { a: [1, 2] }, { maxFindings: 1 }), {
    differences: [], truncated: false,
  });
});
