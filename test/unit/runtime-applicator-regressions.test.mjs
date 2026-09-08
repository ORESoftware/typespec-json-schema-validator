import assert from 'node:assert/strict';
import test from 'node:test';
import { SchemaResolver, SchemaResolutionError, validateInstance } from '../../src/instance-validator.mjs';

function verdict(schema, instance) {
  const resolver = new SchemaResolver();
  const { base } = resolver.addDocument(schema, 'regression.schema.json');
  return validateInstance({ schema, instance, resolver, base });
}

// These expectations are authored independently of the two schema lanes. A/B
// agreement alone cannot reveal a defect shared by both uses of this evaluator.
for (const [name, instance, expected] of [
  ['unmatched first item', ['bad', 1], false],
  ['unmatched interior item', [1, 'bad', 2], false],
  ['unmatched final item', [1, 'bad'], false],
  ['all items match', [1, 2], true],
  ['default minimum rejects empty', [], false],
]) {
  test(`contains plus unevaluatedItems: ${name}`, () => {
    assert.equal(verdict({ contains: { type: 'integer' }, unevaluatedItems: false }, instance).valid, expected);
  });
}

test('contains keeps the precise rejected instance path', () => {
  const result = verdict({ contains: { type: 'integer' }, unevaluatedItems: false }, ['bad', 1]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath === '/0'));
});

test('minContains zero does not mark unmatched items evaluated', () => {
  const schema = { contains: { type: 'integer' }, minContains: 0, unevaluatedItems: false };
  assert.equal(verdict(schema, []).valid, true);
  assert.equal(verdict(schema, ['bad']).valid, false);
});

test('unevaluatedItems validates holes, not only the suffix after the last match', () => {
  const schema = { contains: { type: 'integer' }, unevaluatedItems: { type: 'string' } };
  assert.equal(verdict(schema, ['ok', 1]).valid, true);
  assert.equal(verdict(schema, [false, 1]).valid, false);
});

test('allOf propagates sparse contains annotations without filling holes', () => {
  const schema = { allOf: [{ contains: { type: 'integer' } }], unevaluatedItems: false };
  assert.equal(verdict(schema, ['bad', 1]).valid, false);
  assert.equal(verdict(schema, [1, 2]).valid, true);
});

test('anyOf unions the exact evaluated indices from every successful branch', () => {
  const schema = {
    anyOf: [{ contains: { type: 'integer' } }, { contains: { type: 'string' } }],
    unevaluatedItems: false,
  };
  assert.equal(verdict(schema, ['ok', 1]).valid, true);
  assert.equal(verdict(schema, [false, 'ok', 1]).valid, false);
});

test('failed anyOf branches do not donate contains annotations', () => {
  const schema = {
    anyOf: [{ contains: { type: 'integer' }, minContains: 3 }, { contains: { type: 'string' } }],
    unevaluatedItems: false,
  };
  assert.equal(verdict(schema, [1, 'ok']).valid, false);
});

test('oneOf propagates only the successful branch indices', () => {
  const schema = { oneOf: [{ contains: { type: 'integer' } }, false], unevaluatedItems: false };
  assert.equal(verdict(schema, ['bad', 1]).valid, false);
  assert.equal(verdict(schema, [1]).valid, true);
});

test('$ref propagates sparse array annotations', () => {
  const schema = {
    $id: 'https://example.test/arrays', $defs: { Items: { contains: { type: 'integer' } } },
    $ref: '#/$defs/Items', unevaluatedItems: false,
  };
  assert.equal(verdict(schema, ['bad', 1]).valid, false);
  assert.equal(verdict(schema, [1, 2]).valid, true);
});

test('prefixItems and contains jointly cover only their actual indices', () => {
  const schema = {
    prefixItems: [{ type: 'string' }], contains: { type: 'integer' }, unevaluatedItems: false,
  };
  assert.equal(verdict(schema, ['ok', 1]).valid, true);
  assert.equal(verdict(schema, ['ok', false, 1]).valid, false);
});

test('items still annotates a successfully validated suffix', () => {
  const schema = { prefixItems: [{ type: 'string' }], items: { type: 'integer' }, unevaluatedItems: false };
  assert.equal(verdict(schema, ['ok', 1, 2]).valid, true);
  assert.equal(verdict(schema, ['ok', false, 2]).valid, false);
});

test('if and then combine evaluated indices without claiming intervening items', () => {
  const schema = { if: { contains: { type: 'integer' } }, then: { contains: { type: 'string' } }, unevaluatedItems: false };
  assert.equal(verdict(schema, ['ok', 1]).valid, true);
  assert.equal(verdict(schema, [false, 'ok', 1]).valid, false);
});

for (const referenced of [{ properties: { name: { type: 'string' } } }, { patternProperties: { '^name$': { type: 'string' } } }]) {
  test(`additionalProperties does not consume $ref ${Object.keys(referenced)[0]} annotations`, () => {
    const schema = { $id: 'https://example.test/object', $defs: { Model: referenced }, $ref: '#/$defs/Model', additionalProperties: false };
    assert.equal(verdict(schema, { name: 'ok' }).valid, false);
    assert.equal(verdict(schema, {}).valid, true);
    // Unlike additionalProperties, unevaluatedProperties intentionally sees $ref.
    delete schema.additionalProperties;
    schema.unevaluatedProperties = false;
    assert.equal(verdict(schema, { name: 'ok' }).valid, true);
  });
}

test('additionalProperties still recognizes its own properties and patterns', () => {
  const schema = { properties: { name: { type: 'string' } }, patternProperties: { '^x-': { type: 'integer' } }, additionalProperties: false };
  assert.equal(verdict(schema, { name: 'ok', 'x-count': 1 }).valid, true);
  assert.equal(verdict(schema, { name: 'ok', other: 1 }).valid, false);
  assert.equal(verdict(schema, { name: 2 }).valid, false);
});

test('additionalProperties schema applies even to properties evaluated by $ref', () => {
  const schema = {
    $id: 'https://example.test/object', $defs: { Model: { properties: { name: true } } },
    $ref: '#/$defs/Model', additionalProperties: { type: 'integer' },
  };
  assert.equal(verdict(schema, { name: 'bad' }).valid, false);
  assert.equal(verdict(schema, { name: 1 }).valid, true);
});

function pointerFixture() {
  const schema = {
    $id: 'https://example.test/pointers',
    $defs: { A: { type: 'integer' }, '~2': { type: 'string' }, 'a/b': false, 'percent%': true },
    prefixItems: [true, false],
  };
  const resolver = new SchemaResolver();
  const { base } = resolver.addDocument(schema, 'pointers.schema.json');
  return { schema, resolver, base };
}

for (const index of ['01', '+1', '1e0', '1.0', '-0', '', '-', 'length']) {
  test(`runtime JSON Pointer refuses noncanonical array index ${JSON.stringify(index)}`, () => {
    const { resolver, base } = pointerFixture();
    assert.equal(resolver.resolve(`#/prefixItems/${index}`, base), undefined);
  });
}

for (const reference of ['#/__proto__', '#/constructor', '#/$defs/~2', '#/$defs/~', '#/$defs/%', '#/$defs/%FF']) {
  test(`runtime JSON Pointer refuses inherited or malformed target ${reference}`, () => {
    const { resolver, base } = pointerFixture();
    assert.equal(resolver.resolve(reference, base), undefined);
    assert.throws(() => validateInstance({ schema: { $ref: reference }, instance: null, resolver, base }), SchemaResolutionError);
  });
}

test('runtime pointer percent-decodes the complete fragment before tokenization', () => {
  const { schema, resolver, base } = pointerFixture();
  assert.equal(resolver.resolve('#%2F$defs%2FA', base)?.schema, schema.$defs.A);
  assert.equal(resolver.resolve('#/$defs~1A', base), undefined);
  assert.equal(resolver.resolve('#/$defs/a~1b', base)?.schema, false);
  assert.equal(resolver.resolve('#/$defs/~02', base)?.schema, schema.$defs['~2']);
  assert.equal(resolver.resolve('#/$defs/percent%25', base)?.schema, true);
  assert.equal(resolver.resolve('#/prefixItems/0', base)?.schema, true);
  assert.equal(resolver.resolve('#/prefixItems/1', base)?.schema, false);
});

test('pointer lookup supports no-id roots and legitimate own prototype-like names', () => {
  const schema = JSON.parse('{"$defs":{"__proto__":{"type":"integer"}}}');
  const resolver = new SchemaResolver();
  const { base } = resolver.addDocument(schema, 'no-id.json');
  assert.equal(resolver.resolve('#%2F$defs%2F__proto__', base)?.schema, schema.$defs.__proto__);
  assert.equal(resolver.resolve('#', base)?.schema, schema);
});

for (const keyword of ['const', 'enum', 'default', 'examples', 'x-fixture']) {
  test(`literal ${keyword} values cannot register an overriding $id or $anchor`, () => {
    const real = { $id: 'https://example.test/real', $anchor: 'actual', type: 'integer' };
    const poison = { $id: 'https://example.test/real', $anchor: 'actual', type: 'string' };
    const schema = {
      $id: 'https://example.test/root', $defs: { Real: real },
      [keyword]: ['enum', 'examples'].includes(keyword) ? [poison] : poison,
    };
    const resolver = new SchemaResolver();
    const { base } = resolver.addDocument(schema, 'literal.json');
    assert.equal(resolver.resolve(real.$id, base)?.schema, real);
    assert.equal(resolver.resolve(`${real.$id}#actual`, base)?.schema, real);
    const literalPointer = `#/${keyword}${['enum', 'examples'].includes(keyword) ? '/0' : ''}`;
    assert.equal(resolver.resolve(literalPointer, base), undefined);
  });
}

for (const keyword of ['$defs', 'properties', 'patternProperties', 'dependentSchemas']) {
  test(`a ${keyword} map is not itself a schema resource`, () => {
    const schema = { $id: 'https://example.test/maps', [keyword]: { safe: { type: 'integer' } } };
    const resolver = new SchemaResolver();
    const { base } = resolver.addDocument(schema, 'maps.json');
    assert.equal(resolver.resolve(`#/${keyword}`, base), undefined);
    assert.equal(resolver.resolve(`#/${keyword}/safe`, base)?.schema, schema[keyword].safe);
  });
}

test('a named subschema can legitimately be called $id or $anchor', () => {
  const schema = { $id: 'https://example.test/names', properties: { $id: { type: 'integer' }, $anchor: false } };
  const resolver = new SchemaResolver();
  const { base } = resolver.addDocument(schema, 'names.json');
  assert.equal(resolver.resolve('#/properties/$id', base)?.schema, schema.properties.$id);
  assert.equal(resolver.resolve('#/properties/$anchor', base)?.schema, false);
});

test('fragment pointers within an embedded resource reject literal values too', () => {
  const inner = { $id: 'https://example.test/inner', $defs: { Child: false }, default: { type: 'string' } };
  const resolver = new SchemaResolver();
  const { base } = resolver.addDocument({ $id: 'https://example.test/root', $defs: { Inner: inner } }, 'embedded.json');
  assert.equal(resolver.resolve('https://example.test/inner#/$defs/Child', base)?.schema, false);
  assert.equal(resolver.resolve('https://example.test/inner#/default', base), undefined);
});

test('schema-typed applicators and boolean roots remain addressable', () => {
  const schema = { $id: 'https://example.test/applicators', not: false, if: true, contains: false, allOf: [true] };
  const resolver = new SchemaResolver();
  const { base } = resolver.addDocument(schema, 'applicators.json');
  for (const [pointer, expected] of [['#/not', false], ['#/if', true], ['#/contains', false], ['#/allOf/0', true]]) {
    assert.equal(resolver.resolve(pointer, base)?.schema, expected);
  }
  const { base: booleanBase } = resolver.addDocument(false, 'boolean.json');
  assert.equal(resolver.resolve('#', booleanBase)?.schema, false);
});
