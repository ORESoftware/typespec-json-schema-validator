import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalStringify,
  deepDiff,
  normalizeRef,
  normalizeSchemaDocument,
  normalizeSchemaNode,
  resolveJsonPointer,
} from '../../src/canonical.mjs';

test('schema normalization is deterministic and respects semantic set ordering', () => {
  const left = normalizeSchemaNode({
    required: ['z', 'a'],
    enum: ['member', 'admin'],
    properties: { z: { type: 'string' }, a: { type: 'boolean' } },
    unevaluatedProperties: { not: {} },
  });
  const right = normalizeSchemaNode({
    properties: { a: { type: 'boolean' }, z: { type: 'string' } },
    enum: ['admin', 'member'],
    required: ['a', 'z'],
    unevaluatedProperties: false,
  });
  assert.equal(canonicalStringify(left), canonicalStringify(right));
});

test('legacy definitions and refs normalize to Draft 2020-12 declaration identities', () => {
  const normalized = normalizeSchemaDocument({
    definitions: { User: { type: 'object' } },
    $ref: '#/definitions/User',
  });
  assert.deepEqual(normalized, {
    $defs: { User: { type: 'object' } },
    $ref: 'urn:tsjsv:declaration:User',
  });
});

test('generated file refs and bundled defs refs normalize to the same declaration', () => {
  assert.equal(normalizeRef('User.json'), 'urn:tsjsv:declaration:User');
  assert.equal(normalizeRef('./User.json'), 'urn:tsjsv:declaration:User');
  assert.equal(normalizeRef('#/$defs/User'), 'urn:tsjsv:declaration:User');
  assert.equal(normalizeRef('schemas/User.json'), 'schemas/User.json');
  assert.equal(normalizeRef('User.json#/properties/id'), 'User.json#/properties/id');
});

test('non-assertion schema metadata does not create false parity failures', () => {
  const generated = normalizeSchemaNode({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'User.json',
    title: 'Generated user',
    description: 'Generated wording',
    type: 'object',
    properties: { id: { type: 'string', description: 'Generated id wording' } },
  });
  const authored = normalizeSchemaNode({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:example:user',
    $comment: 'Independent source note',
    title: 'Authored user',
    description: 'Independent wording',
    type: 'object',
    properties: { id: { type: 'string', examples: ['u-1'] } },
  });
  assert.equal(canonicalStringify(generated), canonicalStringify(authored));
});

test('assertion differences remain visible after metadata normalization', () => {
  const generated = normalizeSchemaNode({
    description: 'generated',
    type: 'integer',
    minimum: 0,
  });
  const authored = normalizeSchemaNode({
    description: 'authored',
    type: 'integer',
    minimum: 1,
  });
  assert.deepEqual(deepDiff(generated, authored).differences, [
    {
      pointer: '#/minimum',
      kind: 'value-mismatch',
      left: 0,
      right: 1,
    },
  ]);
});

test('simple nullable anyOf union normalizes to a type set', () => {
  assert.deepEqual(
    normalizeSchemaNode({ anyOf: [{ type: 'null' }, { type: 'string' }] }),
    { type: ['null', 'string'] },
  );
});

test('deepDiff uses stable JSON Pointer locations', () => {
  const result = deepDiff(
    { properties: { id: { type: 'string' } } },
    { properties: { id: { type: 'integer' }, name: { type: 'string' } } },
  );
  assert.deepEqual(
    result.differences.map((item) => [item.kind, item.pointer]),
    [
      ['value-mismatch', '#/properties/id/type'],
      ['missing-left', '#/properties/name'],
    ],
  );
});

test('local JSON Pointer resolution decodes escaped segments', () => {
  const document = { $defs: { 'a/b': { type: 'string' }, 'x~y': { type: 'integer' } } };
  assert.deepEqual(resolveJsonPointer(document, '#/$defs/a~1b'), { type: 'string' });
  assert.deepEqual(resolveJsonPointer(document, '#/$defs/x~0y'), { type: 'integer' });
});
