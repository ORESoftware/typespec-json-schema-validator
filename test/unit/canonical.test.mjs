import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalStringify,
  deepDiff,
  normalizeComparisonRef,
  normalizeRef,
  normalizeSchemaDocument,
  normalizeSchemaNode,
  normalizeSchemaNodeForComparison,
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

test('executable normalization preserves resource identifiers and probe annotations', () => {
  const normalized = normalizeSchemaDocument({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'bundle.json',
    title: 'Bundle',
    $defs: {
      User: {
        $id: 'User',
        type: 'string',
        default: 'u-default',
        examples: ['u-1'],
      },
    },
  });
  assert.equal(normalized.$id, 'bundle.json');
  assert.equal(normalized.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(normalized.title, 'Bundle');
  assert.equal(normalized.$defs.User.$id, 'User');
  assert.equal(normalized.$defs.User.default, 'u-default');
  assert.deepEqual(normalized.$defs.User.examples, ['u-1']);
});

test('runtime and comparison reference normalization stay intentionally separate', () => {
  assert.equal(normalizeRef('User.json'), 'User.json');
  assert.equal(normalizeRef('./User.json'), './User.json');
  assert.equal(normalizeRef('#/$defs/User'), '#/$defs/User');
  assert.equal(normalizeRef('#/definitions/User'), '#/$defs/User');
  assert.equal(normalizeRef('schemas/User.json'), 'schemas/User.json');
  assert.equal(normalizeRef('User.json#/properties/id'), 'User.json#/properties/id');

  assert.equal(normalizeComparisonRef('User.json'), 'urn:tsjsv:declaration:User');
  assert.equal(normalizeComparisonRef('./User.json'), 'urn:tsjsv:declaration:User');
  assert.equal(normalizeComparisonRef('#/$defs/User'), 'urn:tsjsv:declaration:User');
  assert.equal(normalizeComparisonRef('#/definitions/User'), 'urn:tsjsv:declaration:User');
  assert.equal(normalizeComparisonRef('schemas/User.json'), 'schemas/User.json');
  assert.equal(normalizeComparisonRef('User.json#/properties/id'), 'User.json#/properties/id');
});

test('non-assertion schema metadata does not create false parity failures', () => {
  const generated = normalizeSchemaNodeForComparison({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'User.json',
    title: 'Generated user',
    description: 'Generated wording',
    type: 'object',
    properties: { id: { type: 'string', description: 'Generated id wording' } },
  });
  const authored = normalizeSchemaNodeForComparison({
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

test('comparison normalization unifies top-level declaration reference layouts', () => {
  const generated = normalizeSchemaNodeForComparison({
    type: 'object',
    properties: { user: { $ref: 'User.json' } },
  });
  const authored = normalizeSchemaNodeForComparison({
    type: 'object',
    properties: { user: { $ref: '#/$defs/User' } },
  });
  assert.equal(canonicalStringify(generated), canonicalStringify(authored));
});

test('assertion differences remain visible after metadata normalization', () => {
  const generated = normalizeSchemaNodeForComparison({
    description: 'generated',
    type: 'integer',
    minimum: 0,
  });
  const authored = normalizeSchemaNodeForComparison({
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

test('comparison normalization erases only redundant number/integer spelling for a safe integer const', () => {
  const generated = normalizeSchemaNodeForComparison({ type: 'number', const: 1 });
  const authored = normalizeSchemaNodeForComparison({ type: 'integer', const: 1 });
  assert.deepEqual(generated, { const: 1 });
  assert.deepEqual(authored, { const: 1 });
  assert.equal(canonicalStringify(generated), canonicalStringify(authored));

  assert.deepEqual(normalizeSchemaNode({ type: 'number', const: 1 }), { const: 1, type: 'number' });
  assert.deepEqual(normalizeSchemaNode({ type: 'integer', const: 1 }), { const: 1, type: 'integer' });
});

test('safe integer const normalization applies recursively inside schema locations', () => {
  const generated = normalizeSchemaNodeForComparison({
    type: 'object',
    properties: { schema_version: { type: 'number', const: 1 } },
  });
  const authored = normalizeSchemaNodeForComparison({
    type: 'object',
    properties: { schema_version: { type: 'integer', const: 1 } },
  });
  assert.equal(canonicalStringify(generated), canonicalStringify(authored));
  assert.deepEqual(generated.properties.schema_version, { const: 1 });
});

test('number/integer differences remain visible without a provably equivalent safe integer const', () => {
  const cases = [
    [{ type: 'number' }, { type: 'integer' }],
    [{ type: 'number', const: 1.5 }, { type: 'integer', const: 1.5 }],
    [{ type: 'number', const: 9007199254740992 }, { type: 'integer', const: 9007199254740992 }],
    [{ type: 'number', enum: [1] }, { type: 'integer', enum: [1] }],
  ];
  for (const [left, right] of cases) {
    assert.notEqual(
      canonicalStringify(normalizeSchemaNodeForComparison(left)),
      canonicalStringify(normalizeSchemaNodeForComparison(right)),
    );
  }
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

test('malformed percent-encoded JSON Pointer segments fail closed', () => {
  const document = { $defs: { User: { type: 'string' } } };
  assert.equal(resolveJsonPointer(document, '#/$defs/%'), undefined);
  assert.equal(resolveJsonPointer(document, '#/$defs/%GG'), undefined);
  assert.equal(resolveJsonPointer(document, '#/$defs/%E0%A4%A'), undefined);
});
