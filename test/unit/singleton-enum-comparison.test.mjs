import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalStringify,
  normalizeSchemaNode,
  normalizeSchemaNodeForComparison,
} from '../../src/canonical.mjs';

function normalized(value) {
  return canonicalStringify(normalizeSchemaNodeForComparison(value));
}

test('comparison equates a string singleton enum with an equivalent typed const', () => {
  const authored = { type: 'string', enum: ['push'] };
  const generated = { const: 'push', type: 'string' };

  assert.equal(normalized(authored), normalized(generated));
  assert.deepEqual(normalizeSchemaNodeForComparison(authored), generated);
});

test('comparison equates safe boolean and null singleton enums with typed consts', () => {
  assert.equal(
    normalized({ type: 'boolean', enum: [false] }),
    normalized({ const: false, type: 'boolean' }),
  );
  assert.equal(
    normalized({ type: 'null', enum: [null] }),
    normalized({ const: null, type: 'null' }),
  );
});

test('singleton enum parity composes recursively with simple closed-object parity', () => {
  const authored = {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['pull'] },
    },
    additionalProperties: false,
  };
  const generated = {
    type: 'object',
    properties: {
      direction: { const: 'pull', type: 'string' },
    },
    unevaluatedProperties: false,
  };

  assert.equal(normalized(authored), normalized(generated));
});

test('comparison strips non-assertion metadata before singleton enum equivalence', () => {
  const authored = {
    type: 'string',
    enum: ['push'],
    description: 'independently authored documentation',
  };
  const generated = {
    const: 'push',
    type: 'string',
    title: 'generated comparison witness',
  };

  assert.equal(normalized(authored), normalized(generated));
  assert.deepEqual(normalizeSchemaNode(authored), {
    description: 'independently authored documentation',
    enum: ['push'],
    type: 'string',
  });
});

test('executable normalization preserves singleton enum spelling', () => {
  const authored = { type: 'string', enum: ['push'] };
  assert.deepEqual(normalizeSchemaNode(authored), authored);
});

test('comparison refuses multi-value enums', () => {
  const authored = { type: 'string', enum: ['pull', 'push'] };
  const generated = { const: 'pull', type: 'string' };

  assert.notEqual(normalized(authored), normalized(generated));
  assert.ok(Object.hasOwn(normalizeSchemaNodeForComparison(authored), 'enum'));
});

test('comparison refuses singleton enums whose literal does not match the declared type', () => {
  const malformed = { type: 'string', enum: [false] };
  assert.ok(Object.hasOwn(normalizeSchemaNodeForComparison(malformed), 'enum'));
});

test('comparison refuses constrained or numeric singleton enums', () => {
  const constrained = { type: 'string', enum: ['x'], minLength: 1 };
  const numeric = { type: 'integer', enum: [1] };

  assert.ok(Object.hasOwn(normalizeSchemaNodeForComparison(constrained), 'enum'));
  assert.ok(Object.hasOwn(normalizeSchemaNodeForComparison(numeric), 'enum'));
});

test('single-branch literal unions converge to the same typed const representation', () => {
  const union = { anyOf: [{ const: 'pull', type: 'string' }] };
  const singleton = { type: 'string', enum: ['pull'] };
  const direct = { const: 'pull', type: 'string' };

  assert.equal(normalized(union), normalized(singleton));
  assert.equal(normalized(singleton), normalized(direct));
});
