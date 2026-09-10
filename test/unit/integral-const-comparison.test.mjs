import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSchemaNode,
  normalizeSchemaNodeForComparison,
} from '../../src/canonical.mjs';

test('comparison treats integral const number and integer assertions as equivalent', () => {
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'number', const: 1 }),
    { const: 1, type: 'integer' },
  );
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'integer', const: 1 }),
    { const: 1, type: 'integer' },
  );
});

test('executable normalization preserves the original numeric type', () => {
  assert.deepEqual(
    normalizeSchemaNode({ type: 'number', const: 1 }),
    { const: 1, type: 'number' },
  );
});

test('comparison does not narrow unconstrained or non-integral numbers', () => {
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'number' }),
    { type: 'number' },
  );
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'number', const: 1.5 }),
    { const: 1.5, type: 'number' },
  );
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'number', const: '1' }),
    { const: '1', type: 'number' },
  );
});
