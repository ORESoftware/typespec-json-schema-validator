import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSchemaNode,
  normalizeSchemaNodeForComparison,
} from '../../src/canonical.mjs';

const simpleObject = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
};

const withClosure = (keyword, extra = {}) => ({
  ...simpleObject,
  [keyword]: false,
  ...extra,
});

test('simple object closure spellings are equivalent only in the comparison lane', () => {
  const additional = withClosure('additionalProperties');
  const unevaluated = withClosure('unevaluatedProperties');

  assert.deepEqual(
    normalizeSchemaNodeForComparison(additional),
    normalizeSchemaNodeForComparison(unevaluated),
  );
  assert.notDeepEqual(normalizeSchemaNode(additional), normalizeSchemaNode(unevaluated));
});

test('simple nested declarations inherit the same comparison-only closure equivalence', () => {
  const additional = { $defs: { Item: withClosure('additionalProperties') } };
  const unevaluated = { $defs: { Item: withClosure('unevaluatedProperties') } };
  assert.deepEqual(
    normalizeSchemaNodeForComparison(additional),
    normalizeSchemaNodeForComparison(unevaluated),
  );
});

test('a 3FA-style closed model compares without changing either source authority', () => {
  const common = {
    type: 'object',
    required: ['display_name', 'seat_limit', 'discovery_opt_in'],
    properties: {
      display_name: { type: 'string', minLength: 1, maxLength: 120 },
      seat_limit: { type: 'integer', minimum: 1, maximum: 100000 },
      discovery_opt_in: { type: 'boolean' },
    },
  };
  const authored = { ...common, additionalProperties: false };
  const emitted = { ...common, unevaluatedProperties: false };
  const authoredBefore = JSON.stringify(authored);
  const emittedBefore = JSON.stringify(emitted);

  assert.deepEqual(
    normalizeSchemaNodeForComparison(authored),
    normalizeSchemaNodeForComparison(emitted),
  );
  assert.equal(JSON.stringify(authored), authoredBefore);
  assert.equal(JSON.stringify(emitted), emittedBefore);
});

const compositionCases = [
  ['$ref', { $ref: '#/$defs/Base' }],
  ['$dynamicRef', { $dynamicRef: '#node' }],
  ['$recursiveRef', { $recursiveRef: '#' }],
  ['allOf', { allOf: [{ properties: { inherited: { type: 'string' } } }] }],
  ['anyOf', { anyOf: [{ properties: { inherited: { type: 'string' } } }] }],
  ['oneOf', { oneOf: [{ properties: { inherited: { type: 'string' } } }] }],
  ['if', { if: { required: ['id'] } }],
  ['then', { then: { properties: { inherited: { type: 'string' } } } }],
  ['else', { else: { properties: { inherited: { type: 'string' } } } }],
  ['dependentSchemas', { dependentSchemas: { id: { properties: { inherited: { type: 'string' } } } } }],
  ['dependencies', { dependencies: { id: { properties: { inherited: { type: 'string' } } } } }],
  ['not', { not: { required: ['forbidden'] } }],
];

for (const [name, extra] of compositionCases) {
  test(`closure spellings stay distinct across ${name} evaluation boundaries`, () => {
    assert.notDeepEqual(
      normalizeSchemaNodeForComparison(withClosure('additionalProperties', extra)),
      normalizeSchemaNodeForComparison(withClosure('unevaluatedProperties', extra)),
    );
  });
}

test('non-false closure values are not collapsed', () => {
  for (const value of [true, { type: 'string' }]) {
    const additional = { ...simpleObject, additionalProperties: value };
    const unevaluated = { ...simpleObject, unevaluatedProperties: value };
    assert.notDeepEqual(
      normalizeSchemaNodeForComparison(additional),
      normalizeSchemaNodeForComparison(unevaluated),
    );
  }
});

test('schemas without an explicit object type remain distinct', () => {
  const { type: _type, ...untyped } = simpleObject;
  assert.notDeepEqual(
    normalizeSchemaNodeForComparison({ ...untyped, additionalProperties: false }),
    normalizeSchemaNodeForComparison({ ...untyped, unevaluatedProperties: false }),
  );
});

test('retaining both closure keywords is treated as explicit evidence, not simplified', () => {
  const both = {
    ...simpleObject,
    additionalProperties: false,
    unevaluatedProperties: false,
  };
  const normalized = normalizeSchemaNodeForComparison(both);
  assert.equal(normalized.additionalProperties, false);
  assert.equal(normalized.unevaluatedProperties, false);
});
