import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSchemaNode,
  normalizeSchemaNodeForComparison,
} from '../../src/canonical.mjs';

test('comparison treats pure Record<T> additional and unevaluated property schemas as equivalent', () => {
  const generated = {
    type: 'object',
    maxProperties: 128,
    properties: {},
    unevaluatedProperties: { $ref: '#/$defs/EnvironmentValue' },
  };
  const authored = {
    type: 'object',
    maxProperties: 128,
    additionalProperties: { $ref: '#/$defs/EnvironmentValue' },
  };

  assert.deepEqual(
    normalizeSchemaNodeForComparison(generated),
    normalizeSchemaNodeForComparison(authored),
  );
  assert.notDeepEqual(normalizeSchemaNode(generated), normalizeSchemaNode(authored));
});

test('comparison preserves schema-valued map constraints while normalizing the keyword spelling', () => {
  const generated = {
    type: 'object',
    properties: {},
    unevaluatedProperties: { type: 'string', minLength: 1, maxLength: 4096 },
  };
  const authored = {
    type: 'object',
    additionalProperties: { type: 'string', minLength: 1, maxLength: 4096 },
  };

  assert.deepEqual(
    normalizeSchemaNodeForComparison(generated),
    normalizeSchemaNodeForComparison(authored),
  );
});

test('composition boundary keeps additionalProperties and unevaluatedProperties distinct', () => {
  const branch = { properties: { known: { type: 'string' } } };
  const generated = {
    type: 'object',
    allOf: [branch],
    unevaluatedProperties: { type: 'string' },
  };
  const authored = {
    type: 'object',
    allOf: [branch],
    additionalProperties: { type: 'string' },
  };

  assert.notDeepEqual(
    normalizeSchemaNodeForComparison(generated),
    normalizeSchemaNodeForComparison(authored),
  );
});

test('reference boundary keeps additionalProperties and unevaluatedProperties distinct', () => {
  const generated = {
    type: 'object',
    $ref: '#/$defs/Base',
    unevaluatedProperties: { type: 'string' },
  };
  const authored = {
    type: 'object',
    $ref: '#/$defs/Base',
    additionalProperties: { type: 'string' },
  };

  assert.notDeepEqual(
    normalizeSchemaNodeForComparison(generated),
    normalizeSchemaNodeForComparison(authored),
  );
});
