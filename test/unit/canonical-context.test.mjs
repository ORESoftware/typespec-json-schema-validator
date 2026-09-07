import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeJson, canonicalStringify, deepDiff, normalizeComparisonRef,
  normalizeSchemaDocument, normalizeSchemaNode, normalizeSchemaNodeForComparison,
  resolveJsonPointer, sha256, stableFindingFingerprint,
} from '../../src/canonical.mjs';

const normalizers = [normalizeSchemaNode, normalizeSchemaNodeForComparison];
const parsed = (text) => JSON.parse(text);
const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => sha256(canonicalStringify(value));

for (const key of ['enum', 'required', 'type', 'allOf', 'anyOf', 'oneOf']) {
  test(`JSON digests retain literal ${key} array order and multiplicity`, () => {
    const original = { [key]: [2, 1, 2] };
    assert.deepEqual(canonicalizeJson(original), original);
    assert.notEqual(digest(original), digest({ [key]: [1, 2] }));
    assert.notEqual(digest({ [key]: [2, 1] }), digest({ [key]: [1, 2] }));
  });
}

test('JSON object ordering remains deterministic without changing nested arrays', () => {
  assert.equal(canonicalStringify({ z: 1, a: { enum: [2, 1] } }),
    canonicalStringify({ a: { enum: [2, 1] }, z: 1 }));
});

for (const keyword of ['properties', 'patternProperties', '$defs', 'dependentSchemas']) {
  test(`${keyword} preserves every keyword-looking declaration name`, () => {
    const names = ['title', 'description', 'default', 'examples', '$id', '$schema',
      '$comment', 'deprecated', 'readOnly', 'writeOnly', 'definitions', '$ref',
      'enum', 'required', 'type', 'not', 'constructor', 'prototype', '__proto__'];
    const map = Object.fromEntries(names.map((name) => [name, { type: 'string', minLength: 2 }]));
    for (const normalize of normalizers) {
      assert.deepEqual(normalize({ [keyword]: map })[keyword], map);
    }
  });
}

test('a property named not is not interpreted as the false schema', () => {
  for (const normalize of normalizers) {
    assert.deepEqual(normalize({ properties: { not: {} } }), { properties: { not: {} } });
  }
});

test('metadata is removed only from schema nodes, not property names or literal values', () => {
  const input = { title: 'annotation', properties: { title: {
    description: 'annotation', const: { title: 'literal', description: 'literal' },
  } } };
  assert.deepEqual(normalizeSchemaNodeForComparison(input), {
    properties: { title: { const: { title: 'literal', description: 'literal' } } },
  });
});

const literal = parsed('{"title":"literal","description":"literal","$id":"literal","$ref":"User.json","definitions":{"not":{}},"enum":[2,1,2],"required":["z","a"],"oneOf":[{"type":"number"},{"type":"integer"}],"__proto__":{"kept":true}}');
for (const keyword of ['const', 'default', 'examples', 'x-extension']) {
  test(`${keyword} values are opaque JSON rather than schemas`, () => {
    const value = keyword === 'examples' ? [literal, { not: {} }] : literal;
    assert.deepEqual(normalizeSchemaNode({ [keyword]: value }), { [keyword]: value });
    if (keyword === 'const' || keyword === 'x-extension') {
      assert.deepEqual(normalizeSchemaNodeForComparison({ [keyword]: value }), { [keyword]: value });
    }
  });
}

test('enum members preserve metadata, refs, false-schema-looking values, and nested arrays', () => {
  for (const normalize of normalizers) {
    const result = normalize({ enum: [literal, { not: {} }, [2, 1]] });
    assert.equal(result.enum.length, 3);
    assert.ok(result.enum.some((value) => canonicalStringify(value) === canonicalStringify(literal)));
    assert.ok(result.enum.some((value) => canonicalStringify(value) === '{"not":{}}'));
    assert.ok(result.enum.some((value) => canonicalStringify(value) === '[2,1]'));
  }
});

for (const keyword of ['enum', 'required', 'type']) {
  test(`normalizing ${keyword} sorts but does not hide duplicate evidence`, () => {
    assert.deepEqual(normalizeSchemaNode({ [keyword]: ['z', 'a', 'z'] })[keyword], ['a', 'z', 'z']);
  });
}

test('duplicate oneOf branches remain exclusive rather than becoming a type set', () => {
  const schema = { oneOf: [{ type: 'string' }, { type: 'string' }] };
  for (const normalize of normalizers) assert.deepEqual(normalize(schema), schema);
});

test('number/integer oneOf is not weakened into an inclusive type array', () => {
  for (const normalize of normalizers) {
    const result = normalize({ oneOf: [{ type: 'number' }, { type: 'integer' }] });
    assert.ok(Array.isArray(result.oneOf));
    assert.equal(result.oneOf.length, 2);
    assert.equal(result.type, undefined);
  }
});

test('only disjoint known simple oneOf types collapse', () => {
  assert.deepEqual(normalizeSchemaNode({ oneOf: [{ type: 'string' }, { type: 'null' }] }),
    { type: ['null', 'string'] });
  const invalid = { oneOf: [{ type: 'not-a-type' }, { type: 'string' }] };
  assert.ok(normalizeSchemaNode(invalid).oneOf);
});

test('inclusive simple anyOf types still collapse', () => {
  assert.deepEqual(normalizeSchemaNode({ anyOf: [{ type: 'number' }, { type: 'integer' }] }),
    { type: ['integer', 'number'] });
});

for (const key of ['allOf', 'anyOf', 'oneOf']) {
  test(`${key} branch ordering is deterministic without losing duplicate constraints`, () => {
    const a = { type: 'string', minLength: 1 };
    const b = { type: 'string', maxLength: 8 };
    assert.equal(canonicalStringify(normalizeSchemaNode({ [key]: [b, a, b] })),
      canonicalStringify(normalizeSchemaNode({ [key]: [a, b, b] })));
    assert.equal(normalizeSchemaNode({ [key]: [a, b, b] })[key].length, 3);
  });
}

for (const keyword of ['additionalProperties', 'unevaluatedProperties', 'propertyNames',
  'contains', 'not', 'if', 'then', 'else', 'contentSchema', 'items', 'unevaluatedItems']) {
  test(`${keyword} descends into a schema, not into that schema's literal payload`, () => {
    const schema = { [keyword]: { title: 'annotation', const: literal } };
    assert.deepEqual(normalizeSchemaNodeForComparison(schema), { [keyword]: { const: literal } });
  });
}

for (const key of ['prefixItems', 'items']) {
  test(`${key} tuple positions remain ordered`, () => {
    const tuple = [{ type: 'string', title: 'annotation' }, { type: 'integer' }];
    assert.deepEqual(normalizeSchemaNodeForComparison({ [key]: tuple })[key],
      [{ type: 'string' }, { type: 'integer' }]);
  });
}

test('dependentRequired names are data and dependency lists are unordered', () => {
  assert.deepEqual(normalizeSchemaNodeForComparison({ dependentRequired: {
    title: ['z', 'a'], definitions: ['title'],
  } }), { dependentRequired: { definitions: ['title'], title: ['a', 'z'] } });
});

test('legacy dependencies distinguish schema values and property-name arrays', () => {
  assert.deepEqual(normalizeSchemaNodeForComparison({ dependencies: {
    title: ['z', 'a'], trigger: { title: 'annotation', properties: { default: { type: 'string' } } },
  } }), { dependencies: {
    title: ['a', 'z'], trigger: { properties: { default: { type: 'string' } } },
  } });
});

test('nested conflicting definitions and $defs stop normalization', () => {
  const schema = { properties: { child: {
    $defs: { title: { type: 'string' } }, definitions: { title: { type: 'integer' } },
  } } };
  for (const normalize of normalizers) assert.throws(() => normalize(schema), /conflicting/);
});

test('equivalent alias maps merge without renaming declaration keys', () => {
  const map = { title: { type: 'string' }, definitions: { not: {} } };
  assert.deepEqual(normalizeSchemaDocument({ $defs: map, definitions: clone(map) }), {
    $defs: { title: { type: 'string' }, definitions: false },
  });
});

test('parentKey explicitly selects schema-map versus literal context', () => {
  const value = { title: { type: 'string', description: 'annotation' } };
  assert.deepEqual(normalizeSchemaNodeForComparison(value, 'properties'), { title: { type: 'string' } });
  assert.deepEqual(normalizeSchemaNodeForComparison(value, 'const'), value);
});

test('own __proto__ data survives canonicalization and both schema lanes', () => {
  const value = parsed('{"__proto__":{"type":"string"},"constructor":{"type":"number"}}');
  assert.deepEqual(canonicalizeJson(value), value);
  for (const normalize of normalizers) {
    const result = normalize({ properties: value });
    assert.ok(Object.hasOwn(result.properties, '__proto__'));
    assert.equal(Object.getPrototypeOf(result.properties), Object.prototype);
    assert.deepEqual(result.properties, value);
  }
  assert.notEqual(digest(value), digest({ constructor: { type: 'number' } }));
});

test('deepDiff reports missing own prototype-looking keys rather than inherited values', () => {
  const value = parsed('{"__proto__":1,"constructor":2,"toString":3}');
  for (const [left, right, kind] of [[{}, value, 'missing-left'], [value, {}, 'missing-right']]) {
    const differences = deepDiff(left, right).differences;
    assert.equal(differences.length, 3);
    assert.ok(differences.every((finding) => finding.kind === kind));
  }
});

test('finding fingerprints bind the exact literal array evidence', () => {
  assert.notEqual(stableFindingFingerprint({ left: { enum: [2, 1] } }),
    stableFindingFingerprint({ left: { enum: [1, 2] } }));
});

test('comparison references do not collapse nested or URI-encoded pointer targets', () => {
  for (const reference of ['#/$defs/User/properties/id', '#/definitions/User/properties/id',
    '#/$defs/a%2Fb', '#/$defs/a~2b']) {
    assert.equal(normalizeComparisonRef(reference), reference);
  }
  assert.equal(normalizeComparisonRef('#/$defs/a~1b'), 'urn:tsjsv:declaration:a~1b');
});

test('JSON Pointer uses own properties only but accepts explicit prototype-looking keys', () => {
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.equal(resolveJsonPointer({}, `#/${key}`), undefined);
  }
  const value = parsed('{"__proto__":1,"constructor":2,"toString":3}');
  assert.equal(resolveJsonPointer(value, '#/__proto__'), 1);
  assert.equal(resolveJsonPointer(value, '#/constructor'), 2);
  assert.equal(resolveJsonPointer(value, '#/toString'), 3);
});

test('JSON Pointer decodes the URI fragment before splitting tokens', () => {
  const value = { a: { b: 1 }, 'a/b': 2, 'm~n': 3, '%2F': 4 };
  assert.equal(resolveJsonPointer(value, '#/a%2Fb'), 1);
  assert.equal(resolveJsonPointer(value, '#/a~1b'), 2);
  assert.equal(resolveJsonPointer(value, '#%2Fa%2Fb'), 1);
  assert.equal(resolveJsonPointer(value, '#/m~0n'), 3);
  assert.equal(resolveJsonPointer(value, '#/%252F'), 4);
});

test('malformed pointer fragments fail without throwing or accessing non-JSON members', () => {
  const value = { list: [7], 'a~2b': 8, 'a~': 9 };
  for (const pointer of [null, 4, '#/bad%', '#/a~2b', '#/a~', '#/list/length',
    '#/list/01', '#/list/-', '#/list/1', '#/list/-1', '#/list/1e0', '#/list/constructor']) {
    assert.equal(resolveJsonPointer(value, pointer), undefined, String(pointer));
  }
  assert.equal(resolveJsonPointer(value, '#/list/0'), 7);
  assert.equal(resolveJsonPointer(value, '#'), value);
});

test('normalization is immutable and idempotent for schema and literal contexts', () => {
  const value = { properties: { title: { enum: [literal, 'x'] } },
    required: ['title'], oneOf: [{ type: 'number' }, { type: 'integer' }] };
  const before = JSON.stringify(value);
  for (const normalize of normalizers) {
    const result = normalize(value);
    assert.deepEqual(normalize(result), result);
    assert.equal(JSON.stringify(value), before);
  }
});
