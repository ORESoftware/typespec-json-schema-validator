import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERNAL,
  SchemaSyntaxError,
  assertSchemaNodeSyntax,
  validateSchemaNodeSyntax,
} from '../../src/schema-syntax.mjs';
import { SchemaIdentityError, registerSchemaUri } from '../../src/schema-uri-index.mjs';

function ruleIds(schema) {
  return validateSchemaNodeSyntax(schema, { source: 'contract.schema.json' }).map((item) => item.ruleId);
}

function entry(schema, pointer = '#', path = 'contract.schema.json') {
  const record = { path };
  return { schema, base: 'https://example.test/root.json', record, pointer };
}

test('accepts valid Draft 2020-12 identifier, vocabulary, regex, and keyword shapes', () => {
  const schema = {
    $id: 'https://example.test/contracts/root.json',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $anchor: '_root-1.ok',
    $ref: './child.json#node',
    $vocabulary: {
      'https://json-schema.org/draft/2020-12/vocab/core': true,
    },
    type: ['object', 'null'],
    properties: { name: { type: 'string' } },
    patternProperties: { '^x-\\p{Letter}+$': { type: 'string' } },
    required: ['name'],
    dependentRequired: { name: ['kind'] },
    allOf: [{ type: 'object' }, { type: 'object' }],
    examples: [{ name: 'one' }, { name: 'one' }],
    readOnly: false,
  };
  assert.deepEqual(validateSchemaNodeSyntax(schema), []);
});

test('allows an empty $id fragment but rejects a non-empty fragment', () => {
  assert.deepEqual(validateSchemaNodeSyntax({ $id: 'child.json#' }), []);
  assert.ok(ruleIds({ $id: 'child.json#named' }).includes('json-schema-invalid-id'));
});

test('rejects invalid identifier and vocabulary syntax without echoing values', () => {
  const findings = validateSchemaNodeSyntax({
    $id: 'bad id',
    $schema: './relative-meta-schema',
    $anchor: '9bad',
    $dynamicAnchor: 'bad:anchor',
    $ref: 'bad%2',
    $dynamicRef: 42,
    $vocabulary: {
      relative: 'yes',
    },
  }, { source: 'secrets-not-echoed.schema.json' });
  const rules = new Set(findings.map((item) => item.ruleId));
  for (const expected of [
    'json-schema-invalid-id',
    'json-schema-invalid-schema-uri',
    'json-schema-invalid-anchor',
    'json-schema-invalid-ref',
    'json-schema-invalid-vocabulary-uri',
    'json-schema-invalid-vocabulary-requirement',
  ]) {
    assert.ok(rules.has(expected), `missing ${expected}`);
  }
  assert.ok(findings.every((item) => !item.message.includes('bad id')));
});

test('uses ECMA-262 Unicode regex syntax and never falls back to legacy parsing', () => {
  assert.doesNotThrow(() => new RegExp('\\p{Letter}+', 'u'));
  assert.throws(() => new RegExp('\\8', 'u'));
  assert.doesNotThrow(() => new RegExp('\\8'));
  const rules = ruleIds({
    pattern: '\\8',
    patternProperties: { '\\8': true },
  });
  assert.equal(rules.filter((rule) => rule === 'json-schema-invalid-regex').length, 2);
});

test('validates immediate meta-schema keyword shapes without deduplicating schema arrays or examples', () => {
  const valid = {
    oneOf: [{ type: 'string' }, { type: 'string' }],
    examples: [1, 1],
  };
  assert.deepEqual(validateSchemaNodeSyntax(valid), []);

  const invalid = {
    type: [],
    enum: [],
    required: ['id', 'id', 4],
    dependentRequired: { id: ['kind', 'kind', false] },
    properties: [],
    allOf: [],
    items: [],
    multipleOf: 0,
    maxLength: -1,
    minimum: Number.POSITIVE_INFINITY,
    uniqueItems: 'true',
    examples: 'not-an-array',
  };
  const rules = new Set(ruleIds(invalid));
  for (const expected of [
    'json-schema-empty-type',
    'json-schema-empty-array',
    'json-schema-duplicate-array-item',
    'json-schema-invalid-array-item',
    'json-schema-invalid-schema-map',
    'json-schema-invalid-child-schema',
    'json-schema-invalid-multiple-of',
    'json-schema-invalid-cardinality',
    'json-schema-invalid-number',
    'json-schema-invalid-boolean',
    'json-schema-invalid-array',
  ]) {
    assert.ok(rules.has(expected), `missing ${expected}`);
  }
});

test('assertion API throws a typed error with stable diagnostic fields', () => {
  assert.throws(
    () => assertSchemaNodeSyntax({ $anchor: '#bad' }, { pointer: '#/$defs/Bad', source: 'bundle.schema.json' }),
    (error) => {
      assert.ok(error instanceof SchemaSyntaxError);
      assert.equal(error.ruleId, 'json-schema-invalid-anchor');
      assert.equal(error.pointer, '#/$defs/Bad/$anchor');
      assert.equal(error.source, 'bundle.schema.json');
      return true;
    },
  );
});

test('URI registration is transactional when schema syntax is invalid', () => {
  const pending = new Map();
  const committed = new Map();
  assert.throws(
    () => registerSchemaUri(
      pending,
      committed,
      'https://example.test/root.json',
      entry({ $id: 'https://example.test/root.json#forbidden' }),
    ),
    SchemaSyntaxError,
  );
  assert.equal(pending.size, 0);
  assert.equal(committed.size, 0);
});

test('URI registration still rejects conflicting identities after syntax validation', () => {
  const pending = new Map();
  const committed = new Map();
  const first = entry({ type: 'string' }, '#/$defs/First', 'first.schema.json');
  registerSchemaUri(pending, committed, 'https://example.test/shared', first);
  committed.set('https://example.test/shared', pending.get('https://example.test/shared'));
  pending.clear();

  const second = entry({ type: 'string' }, '#/$defs/Second', 'second.schema.json');
  assert.throws(
    () => registerSchemaUri(pending, committed, 'https://example.test/shared', second),
    SchemaIdentityError,
  );
  assert.equal(pending.size, 0);
  assert.equal(committed.get('https://example.test/shared').record.path, 'first.schema.json');
});

test('anchor grammar matches the Draft 2020-12 ASCII NCName profile', () => {
  assert.equal(INTERNAL.ANCHOR_PATTERN.test('A'), true);
  assert.equal(INTERNAL.ANCHOR_PATTERN.test('_node-1.ok'), true);
  assert.equal(INTERNAL.ANCHOR_PATTERN.test('a:b'), false);
  assert.equal(INTERNAL.ANCHOR_PATTERN.test('9node'), false);
  assert.equal(INTERNAL.ANCHOR_PATTERN.test('#node'), false);
});
