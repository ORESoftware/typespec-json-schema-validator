import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalStringify,
  deepDiff,
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

test('legacy definitions and refs normalize to Draft 2020-12 spellings', () => {
  const normalized = normalizeSchemaDocument({
    definitions: { User: { type: 'object' } },
    $ref: '#/definitions/User',
  });
  assert.deepEqual(normalized, {
    $defs: { User: { type: 'object' } },
    $ref: '#/$defs/User',
  });
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
