import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractSchemaDeclarations,
  inferSchemaKind,
  validateJsonSchemaDocument,
} from '../../src/json-schema.mjs';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

test('valid Draft 2020-12 declaration bundle passes structural validation', () => {
  const schema = {
    $schema: dialect,
    $defs: {
      User: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        unevaluatedProperties: false,
      },
    },
  };
  assert.deepEqual(validateJsonSchemaDocument(schema), []);
  assert.deepEqual(extractSchemaDeclarations(schema, 'schema.json').map((item) => item.name), ['User']);
});

test('structural validator catches dialect, required, enum, and ref defects', () => {
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $defs: {
      Broken: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['missing', 'missing'],
        enum: [],
        allOf: [{ $ref: '#/$defs/NoSuchDefinition' }],
      },
    },
  };
  const rules = new Set(validateJsonSchemaDocument(schema).map((item) => item.ruleId));
  for (const rule of [
    'json-schema-dialect',
    'json-schema-duplicate-array-item',
    'json-schema-required-property-missing',
    'json-schema-empty-enum',
    'json-schema-unresolved-local-ref',
  ]) {
    assert.ok(rules.has(rule), `missing expected rule ${rule}`);
  }
});

test('OpenAPI nullable keyword is rejected in the Draft 2020-12 authority lane', () => {
  const findings = validateJsonSchemaDocument({ $schema: dialect, type: 'string', nullable: true });
  assert.ok(findings.some((item) => item.ruleId === 'json-schema-openapi-nullable-keyword'));
});

test('kind inference distinguishes models, enums, unions, and scalar-like schemas', () => {
  assert.equal(inferSchemaKind({ type: 'object', properties: {} }), 'model');
  assert.equal(
    inferSchemaKind({
      type: 'object',
      properties: { kind: { type: 'string' } },
      oneOf: [{ '$ref': 'Child' }, { type: 'object' }],
    }),
    'model',
  );
  assert.equal(inferSchemaKind({ type: 'string', enum: ['a'] }), 'enum');
  assert.equal(inferSchemaKind({ oneOf: [{ type: 'string' }, { type: 'integer' }] }), 'union');
  assert.equal(inferSchemaKind({ type: 'string' }), 'scalar-like');
});
