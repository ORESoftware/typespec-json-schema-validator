import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalStringify,
  canonicalizeJson,
  deepDiff,
  normalizeSchemaNode,
  normalizeSchemaNodeForComparison,
  resolveJsonPointer,
} from '../../src/canonical.mjs';

test('generic JSON canonicalization preserves array order and multiplicity', () => {
  const left = canonicalStringify({
    enum: ['b', 'a', 'b'],
    oneOf: [{ type: 'number' }, { type: 'integer' }, { type: 'number' }],
  });
  const right = canonicalStringify({
    enum: ['a', 'b'],
    oneOf: [{ type: 'integer' }, { type: 'number' }],
  });

  assert.notEqual(left, right);
  assert.deepEqual(canonicalizeJson({ values: [2, 1, 2] }), { values: [2, 1, 2] });
});

test('schema normalization retains duplicate and overlapping oneOf branches', () => {
  const normalized = normalizeSchemaNode({
    oneOf: [{ type: 'number' }, { type: 'integer' }, { type: 'number' }],
  });

  assert.equal(normalized.oneOf.length, 3);
  assert.equal(normalized.type, undefined);
  assert.deepEqual(normalized.oneOf, [
    { type: 'integer' },
    { type: 'number' },
    { type: 'number' },
  ]);
});

test('comparison metadata stripping does not erase schema-map names', () => {
  const normalized = normalizeSchemaNodeForComparison({
    title: 'root annotation',
    $defs: {
      title: { type: 'string', title: 'declaration annotation' },
    },
    properties: {
      title: { type: 'string', description: 'property annotation' },
      definitions: { type: 'integer' },
    },
  });

  assert.equal(Object.hasOwn(normalized, 'title'), false);
  assert.deepEqual(normalized.$defs.title, { type: 'string' });
  assert.deepEqual(normalized.properties.title, { type: 'string' });
  assert.deepEqual(normalized.properties.definitions, { type: 'integer' });
});

test('literal objects retain keyword-looking keys and own __proto__ data', () => {
  const input = JSON.parse(
    '{"const":{"title":"kept","definitions":{"properties":[2,1,2]},"__proto__":{"safe":true}}}',
  );
  const normalized = normalizeSchemaNodeForComparison(input);

  assert.equal(normalized.const.title, 'kept');
  assert.deepEqual(normalized.const.definitions.properties, [2, 1, 2]);
  assert.equal(Object.hasOwn(normalized.const, '__proto__'), true);
  assert.deepEqual(normalized.const.__proto__, { safe: true });
  assert.equal(Object.getPrototypeOf(normalized.const), Object.prototype);
});

test('JSON Pointer resolution uses strict array tokens and own properties only', () => {
  const document = JSON.parse(
    '{"items":[{"type":"string"}],"__proto__":{"safe":true},"a~b":{"type":"boolean"}}',
  );

  assert.deepEqual(resolveJsonPointer(document, '#/items/0'), { type: 'string' });
  assert.deepEqual(resolveJsonPointer(document, '#/__proto__'), { safe: true });
  assert.deepEqual(resolveJsonPointer(document, '#/a~0b'), { type: 'boolean' });

  for (const pointer of [
    '#/items/01',
    '#/items/length',
    '#/items/-',
    '#/toString',
    '#/constructor',
    '#/a~2b',
    '#/%',
    '#/%GG',
  ]) {
    assert.equal(resolveJsonPointer(document, pointer), undefined, pointer);
  }
});

test('deepDiff compares own __proto__ values rather than prototypes', () => {
  const left = JSON.parse('{"__proto__":{"value":1}}');
  const right = JSON.parse('{"__proto__":{"value":2}}');
  const result = deepDiff(left, right);

  assert.deepEqual(result.differences, [
    {
      pointer: '#/__proto__/value',
      kind: 'value-mismatch',
      left: 1,
      right: 2,
    },
  ]);
});
