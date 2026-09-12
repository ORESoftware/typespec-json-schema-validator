import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSchemaNode,
  normalizeSchemaNodeForComparison,
} from '../../src/canonical.mjs';

test('comparison normalization equates unique string const anyOf with enum', () => {
  const emitted = normalizeSchemaNodeForComparison({
    anyOf: [
      { type: 'string', const: 'push' },
      { type: 'string', const: 'pull' },
    ],
  });
  const authored = normalizeSchemaNodeForComparison({
    type: 'string',
    enum: ['pull', 'push'],
  });

  assert.deepEqual(emitted, authored);
  assert.deepEqual(emitted, { enum: ['pull', 'push'], type: 'string' });
});

test('executable normalization preserves string const anyOf', () => {
  const source = {
    anyOf: [
      { type: 'string', const: 'push' },
      { type: 'string', const: 'pull' },
    ],
  };

  assert.deepEqual(normalizeSchemaNode(source), {
    anyOf: [
      { const: 'pull', type: 'string' },
      { const: 'push', type: 'string' },
    ],
  });
});

test('comparison normalization does not collapse oneOf const strings', () => {
  const normalized = normalizeSchemaNodeForComparison({
    oneOf: [
      { type: 'string', const: 'pull' },
      { type: 'string', const: 'push' },
    ],
  });

  assert.ok(Array.isArray(normalized.oneOf));
  assert.equal(normalized.enum, undefined);
});

test('comparison normalization does not collapse mixed const types', () => {
  const normalized = normalizeSchemaNodeForComparison({
    anyOf: [
      { type: 'string', const: 'pull' },
      { type: 'integer', const: 1 },
    ],
  });

  assert.ok(Array.isArray(normalized.anyOf));
  assert.equal(normalized.enum, undefined);
});

test('comparison normalization does not discard branch assertions', () => {
  const normalized = normalizeSchemaNodeForComparison({
    anyOf: [
      { type: 'string', const: 'pull', minLength: 1 },
      { type: 'string', const: 'push' },
    ],
  });

  assert.ok(Array.isArray(normalized.anyOf));
  assert.equal(normalized.enum, undefined);
});

test('comparison normalization keeps duplicate anyOf const branches explicit', () => {
  const normalized = normalizeSchemaNodeForComparison({
    anyOf: [
      { type: 'string', const: 'pull' },
      { type: 'string', const: 'pull' },
    ],
  });

  assert.ok(Array.isArray(normalized.anyOf));
  assert.equal(normalized.enum, undefined);
});
