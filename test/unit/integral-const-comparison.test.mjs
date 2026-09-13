import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSchemaNode,
  normalizeSchemaNodeForComparison,
} from '../../src/canonical.mjs';

// Once `const` fixes the only admissible JSON numeric value to a safely
// representable integer, `type: number`, `type: integer` and an absent `type`
// all accept exactly the same instance. The comparison lane erases that
// redundant spelling so two authorities that disagree only on it still match.

test('comparison treats integral const number and integer assertions as equivalent', () => {
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'number', const: 1 }),
    { const: 1 },
  );
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'integer', const: 1 }),
    { const: 1 },
  );
});

test('comparison also unifies an authority that omits the numeric type', () => {
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ const: 1 }),
    { const: 1 },
  );
});

test('executable normalization preserves the original numeric type', () => {
  assert.deepEqual(
    normalizeSchemaNode({ type: 'number', const: 1 }),
    { const: 1, type: 'number' },
  );
  assert.deepEqual(
    normalizeSchemaNode({ type: 'integer', const: 1 }),
    { const: 1, type: 'integer' },
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

test('comparison keeps unsafe integral constants distinct', () => {
  // Beyond Number.MAX_SAFE_INTEGER, JavaScript number parsing cannot prove the
  // two spellings accept the same JSON text, so the type must survive.
  const unsafe = Number.MAX_SAFE_INTEGER + 2;
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'number', const: unsafe }),
    { const: unsafe, type: 'number' },
  );
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'integer', const: unsafe }),
    { const: unsafe, type: 'integer' },
  );
});

test('comparison independently canonicalizes safe non-numeric const typing', () => {
  assert.deepEqual(
    normalizeSchemaNodeForComparison({ type: 'string', const: 'a' }),
    { const: 'a' },
  );
});
