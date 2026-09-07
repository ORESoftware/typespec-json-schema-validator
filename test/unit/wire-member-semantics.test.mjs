import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStringify, normalizeSchemaNode } from '../../src/canonical.mjs';
import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function accepts(schema, instance) {
  const resolver = new SchemaResolver();
  const { base } = resolver.addDocument(schema, 'wire-members.schema.json');
  return validateInstance({ schema, instance, resolver, base }).valid;
}
function assertUnchangedVerdict(schema, instance, expected) {
  const originalSchema = copy(schema);
  const originalInstance = copy(instance);
  freeze(schema);
  freeze(instance);
  assert.equal(accepts(schema, instance), expected, 'authored executable schema');
  const normalized = freeze(normalizeSchemaNode(schema));
  assert.equal(accepts(normalized, instance), expected, 'executable normalized schema');
  assert.deepEqual(instance, originalInstance, 'validator must not coerce, strip, default or normalize');
  assert.deepEqual(schema, originalSchema, 'schema objects remain caller-owned');
}

for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'a/b', 'a~b', 'title', '$ref']) {
  for (const closure of ['additionalProperties', 'unevaluatedProperties']) {
    test(`${closure}: literal JSON member ${key} survives schema normalization and instance validation`, () => {
      const schema = JSON.parse(JSON.stringify({
        type: 'object', properties: { [key]: { type: 'string', minLength: 1 } },
        required: [key], [closure]: false,
      }));
      const valid = JSON.parse(JSON.stringify({ [key]: 'exact-wire-value' }));
      assert.equal(Object.hasOwn(valid, key), true);
      assertUnchangedVerdict(schema, valid, true);
      assertUnchangedVerdict(copy(schema), {}, false);
      assertUnchangedVerdict(copy(schema), JSON.parse(JSON.stringify({ [key]: null })), false);
      assertUnchangedVerdict(copy(schema), JSON.parse(JSON.stringify({ ...valid, extra: true })), false);
      const normalized = normalizeSchemaNode(schema);
      assert.equal(Object.hasOwn(normalized.properties, key), true);
      assert.equal(Object.hasOwn(JSON.parse(canonicalStringify(valid)), key), true);
      assert.equal(Object.getPrototypeOf(valid), Object.prototype);
    });
  }
}

for (const [name, value, minLength, maxLength, expected] of [
  ['astral one character', '\u{1f680}', 1, 1, true],
  ['astral exceeds maximum', '\u{1f680}\u{1f680}', 1, 1, false],
  ['astral below minimum', '\u{1f680}', 2, 2, false],
  ['combining sequence has two characters', 'e\u0301', 2, 2, true],
  ['combining sequence is not one character', 'e\u0301', 1, 1, false],
  ['precomposed has one character', '\u00e9', 1, 1, true],
  ['zero width joiner counts', '\u{1f469}\u200d\u{1f4bb}', 3, 3, true],
  ['joined emoji is not one schema character', '\u{1f469}\u200d\u{1f4bb}', 1, 1, false],
  ['NUL is a JSON character', '\u0000', 1, 1, true],
  ['empty fails positive minimum', '', 1, 1, false],
]) {
  test(`Unicode wire length: ${name}`, () => {
    assertUnchangedVerdict({ type: 'string', minLength, maxLength }, value, expected);
  });
}

test('default annotations cannot fill missing required properties or replace null/false/empty', () => {
  const schema = {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      label: { type: 'string', default: 'fallback' },
      tags: { type: 'array', items: { type: 'string' }, default: ['fallback'] },
    },
    required: ['enabled', 'label', 'tags'], additionalProperties: false,
  };
  const minimum = { enabled: false, label: '', tags: [] };
  assertUnchangedVerdict(copy(schema), copy(minimum), true);
  for (const key of schema.required) {
    const missing = copy(minimum); delete missing[key];
    assertUnchangedVerdict(copy(schema), missing, false);
    assertUnchangedVerdict(copy(schema), { ...copy(minimum), [key]: null }, false);
  }
});

test('Unicode identifiers remain distinct in const, enum and uniqueItems', () => {
  const composed = '\u00e9';
  const decomposed = 'e\u0301';
  assertUnchangedVerdict({ const: composed }, decomposed, false);
  assertUnchangedVerdict({ enum: [composed] }, decomposed, false);
  assertUnchangedVerdict({ type: 'array', uniqueItems: true }, [composed, decomposed], true);
  assertUnchangedVerdict({ type: 'array', uniqueItems: true }, [composed, composed], false);
  assert.notEqual(canonicalStringify(composed), canonicalStringify(decomposed));
});

test('canonical wire digest input preserves a JSON-parsed __proto__ member', () => {
  const payload = JSON.parse('{"__proto__":{"polluted":true},"value":1}');
  const before = copy(payload);
  const serialized = canonicalStringify(freeze(payload));
  assert.deepEqual(JSON.parse(serialized), before);
  assert.notEqual(serialized, canonicalStringify({ value: 1 }));
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});
