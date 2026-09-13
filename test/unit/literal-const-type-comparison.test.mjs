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

test('comparison equates a bare string const with the same typed const', () => {
  const authored = { const: 'fiducia.quote.v1' };
  const generated = { const: 'fiducia.quote.v1', type: 'string' };

  assert.equal(normalized(authored), normalized(generated));
  assert.deepEqual(normalizeSchemaNodeForComparison(generated), authored);
});

test('comparison equates safe boolean and null consts with redundant types', () => {
  assert.equal(normalized({ const: false }), normalized({ const: false, type: 'boolean' }));
  assert.equal(normalized({ const: null }), normalized({ const: null, type: 'null' }));
});

test('comparison equates a safe typed enum with the same bare enum', () => {
  const authored = { enum: ['draft', 'issued', 'accepted'] };
  const generated = { enum: ['draft', 'issued', 'accepted'], type: 'string' };

  assert.equal(normalized(authored), normalized(generated));
  assert.deepEqual(normalizeSchemaNodeForComparison(generated), {
    enum: ['accepted', 'draft', 'issued'],
  });
});

test('comparison refuses typed enums with mixed or mismatched literal types', () => {
  const malformed = { enum: ['draft', false], type: 'string' };
  assert.deepEqual(normalizeSchemaNodeForComparison(malformed), {
    enum: [false, 'draft'],
    type: 'string',
  });
});

test('singleton enums and one-branch literal unions converge all the way to bare const', () => {
  const union = { anyOf: [{ const: 'pull', type: 'string' }] };
  const singleton = { type: 'string', enum: ['pull'] };
  const typed = { const: 'pull', type: 'string' };
  const bare = { const: 'pull' };

  assert.equal(normalized(union), normalized(singleton));
  assert.equal(normalized(singleton), normalized(typed));
  assert.equal(normalized(typed), normalized(bare));
});

test('executable normalization preserves the redundant scalar type', () => {
  const schema = { const: 'fiducia.quote.v1', type: 'string' };
  assert.deepEqual(normalizeSchemaNode(schema), schema);
});

test('comparison refuses a const whose literal does not match its declared type', () => {
  const malformed = { const: false, type: 'string' };
  assert.deepEqual(normalizeSchemaNodeForComparison(malformed), malformed);
});

test('comparison leaves non-integral numeric const typing explicit', () => {
  const schema = { const: 1.5, type: 'number' };
  assert.deepEqual(normalizeSchemaNodeForComparison(schema), schema);
});

test('comparison does not erase type when additional assertions share the node', () => {
  const constrained = { const: 'x', minLength: 1, type: 'string' };
  assert.deepEqual(normalizeSchemaNodeForComparison(constrained), constrained);
});
