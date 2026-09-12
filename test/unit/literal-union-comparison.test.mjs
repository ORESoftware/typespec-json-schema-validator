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

test('comparison equates a pure string anyOf literal union with an authored enum', () => {
  const generated = {
    anyOf: [
      { const: 'push', type: 'string' },
      { const: 'pull', type: 'string' },
    ],
  };
  const authored = { type: 'string', enum: ['pull', 'push'] };

  assert.equal(normalized(generated), normalized(authored));
  assert.deepEqual(normalizeSchemaNodeForComparison(generated), {
    enum: ['pull', 'push'],
    type: 'string',
  });

  assert.deepEqual(normalizeSchemaNode(generated), {
    anyOf: [
      { const: 'pull', type: 'string' },
      { const: 'push', type: 'string' },
    ],
  });
});

test('comparison equates a unique string oneOf literal union with an authored enum', () => {
  const generated = {
    oneOf: [
      { const: 'pull', type: 'string' },
      { const: 'push', type: 'string' },
    ],
  };
  const authored = { enum: ['push', 'pull'], type: 'string' };
  assert.equal(normalized(generated), normalized(authored));
});

test('literal-union equivalence applies recursively at property schema locations', () => {
  const generated = {
    type: 'object',
    properties: {
      direction: {
        anyOf: [
          { const: 'push', type: 'string' },
          { const: 'pull', type: 'string' },
        ],
      },
    },
  };
  const authored = {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['pull', 'push'] },
    },
  };
  assert.equal(normalized(generated), normalized(authored));
});

test('comparison refuses to collapse duplicate oneOf literals because XOR semantics differ', () => {
  const oneOf = {
    oneOf: [
      { const: 'pull', type: 'string' },
      { const: 'pull', type: 'string' },
    ],
  };
  const authored = { type: 'string', enum: ['pull'] };
  assert.notEqual(normalized(oneOf), normalized(authored));
  assert.ok(Object.hasOwn(normalizeSchemaNodeForComparison(oneOf), 'oneOf'));
});

test('comparison refuses mixed literal types and branches with assertion constraints', () => {
  const mixed = {
    anyOf: [
      { const: 'pull', type: 'string' },
      { const: true, type: 'boolean' },
    ],
  };
  const constrained = {
    anyOf: [
      { const: 'pull', type: 'string', minLength: 1 },
      { const: 'push', type: 'string' },
    ],
  };
  assert.ok(Object.hasOwn(normalizeSchemaNodeForComparison(mixed), 'anyOf'));
  assert.ok(Object.hasOwn(normalizeSchemaNodeForComparison(constrained), 'anyOf'));
});

test('comparison still reports genuinely different literal sets', () => {
  const generated = {
    anyOf: [
      { const: 'pull', type: 'string' },
      { const: 'push', type: 'string' },
    ],
  };
  const authored = { type: 'string', enum: ['pull', 'push', 'merge'] };
  assert.notEqual(normalized(generated), normalized(authored));
});

test('comparison can normalize boolean and null literal unions without broadening the rule', () => {
  assert.equal(
    normalized({ anyOf: [{ const: false, type: 'boolean' }, { const: true, type: 'boolean' }] }),
    normalized({ type: 'boolean', enum: [true, false] }),
  );
  assert.equal(
    normalized({ anyOf: [{ const: null, type: 'null' }] }),
    normalized({ type: 'null', enum: [null] }),
  );
});
