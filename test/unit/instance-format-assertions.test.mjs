import assert from 'node:assert/strict';
import test from 'node:test';
import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import { FORMAT_CASES } from '../fixtures/format-cases.mjs';

function validate(schema, instance, options = {}) {
  const resolver = new SchemaResolver();
  const { base } = resolver.addDocument(schema, 'format-contract.json');
  return validateInstance({ schema, instance, resolver, base, ...options });
}

for (const [format, expected, values] of FORMAT_CASES) {
  for (const value of values) {
    test(`instance ${format}: ${JSON.stringify(value)}`, () => {
      const schema = Object.freeze({ type: 'string', format });
      const enabled = validate(schema, value, { formatAssertion: true });
      assert.equal(enabled.valid, expected);
      if (expected) assert.deepEqual(enabled.errors, []);
      else assert.deepEqual(enabled.errors.map(({ keyword, instancePath, schemaPointer }) => (
        { keyword, instancePath, schemaPointer }
      )), [{ keyword: 'format', instancePath: '', schemaPointer: '#/format' }]);
      assert.equal(validate(schema, value).valid, true, 'format assertion stays opt-in');
      assert.equal(validate(schema, value, { formatAssertion: false }).valid, true);
    });
  }
}

for (const format of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'unrecognized-format']) {
  test(`unknown format ${format} remains an annotation without throwing`, () => {
    assert.deepEqual(validate({ type: 'string', format }, 'anything', { formatAssertion: true }), {
      valid: true, errors: [],
    });
  });
}

test('format checks do not impose string type or mutate either schema lane', () => {
  const schema = Object.freeze({ format: 'date' });
  for (const value of [null, 42, false, [], {}]) {
    assert.equal(validate(schema, value, { formatAssertion: true }).valid, true);
  }
  assert.deepEqual(schema, { format: 'date' });
});

test('format errors keep nested instance and schema paths', () => {
  const schema = { type: 'object', properties: { addresses: { type: 'array', items: { type: 'string', format: 'ipv6' } } } };
  const result = validate(schema, { addresses: ['::1', 'deadbeef'] }, { formatAssertion: true });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(({ keyword, instancePath, schemaPointer }) => ({ keyword, instancePath, schemaPointer })), [
    { keyword: 'format', instancePath: '/addresses/1', schemaPointer: '#/properties/addresses/items/format' },
  ]);
});

test('format assertions propagate through resolved refs and probe contexts', () => {
  const format = { type: 'string', format: 'date' };
  for (const schema of [
    { $defs: { Date: format }, $ref: '#/$defs/Date' },
    { allOf: [format] },
    { anyOf: [format, { const: 'sentinel' }] },
    { oneOf: [format, { const: 'sentinel' }] },
    { not: { not: format } },
    { if: format, then: true, else: false },
  ]) {
    assert.equal(validate(schema, '2024-02-29', { formatAssertion: true }).valid, true);
    assert.equal(validate(schema, '2023-02-29', { formatAssertion: true }).valid, false);
    assert.equal(validate(schema, '2023-02-29').valid, true);
  }
  const contains = { type: 'array', contains: format };
  assert.equal(validate(contains, ['2024-02-29'], { formatAssertion: true }).valid, true);
  assert.equal(validate(contains, ['2023-02-29'], { formatAssertion: true }).valid, false);
  assert.equal(validate(contains, ['2023-02-29']).valid, true);
});

test('suppressing retained errors never suppresses an invalid format verdict', () => {
  assert.deepEqual(validate({ format: 'ipv6' }, 'deadbeef', { formatAssertion: true, maxErrors: 0 }), {
    valid: false, errors: [],
  });
});
