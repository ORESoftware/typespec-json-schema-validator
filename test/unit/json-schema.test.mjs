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

test('structural validator catches dialect, required, enum, and pointer defects', () => {
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
    'json-schema-empty-array',
    'json-schema-unresolved-local-ref',
  ]) {
    assert.ok(rules.has(rule), `missing expected rule ${rule}`);
  }
});

test('required may constrain a property without declaring its value schema', () => {
  assert.deepEqual(
    validateJsonSchemaDocument({
      $schema: dialect,
      type: 'object',
      required: ['id'],
    }),
    [],
  );
});

test('anchor references are not misinterpreted as JSON Pointers', () => {
  assert.deepEqual(
    validateJsonSchemaDocument({
      $schema: dialect,
      $defs: {
        Name: { $anchor: 'name', type: 'string' },
        Holder: { $ref: '#name' },
      },
    }),
    [],
  );
});

test('local JSON Pointers resolve inside the nearest nested resource', () => {
  const valid = {
    $schema: dialect,
    $defs: {
      Child: {
        $id: 'child.json',
        $defs: { Value: { type: 'string' } },
        $ref: '#/$defs/Value',
      },
    },
  };
  assert.deepEqual(validateJsonSchemaDocument(valid), []);

  valid.$defs.Child.$ref = '#/$defs/Missing';
  assert.ok(
    validateJsonSchemaDocument(valid).some((item) => item.ruleId === 'json-schema-unresolved-local-ref'),
  );
});

test('URI-fragment JSON Pointers are percent-decoded before lookup', () => {
  assert.deepEqual(
    validateJsonSchemaDocument({
      $schema: dialect,
      $defs: {
        '$name': { type: 'string' },
        Holder: { $ref: '#/%24defs/%24name' },
      },
    }),
    [],
  );
});

test('shared syntax guard runs during structural parity even without instance probes', () => {
  const findings = validateJsonSchemaDocument({
    $schema: dialect,
    $id: 'bad id',
    pattern: '\\8',
    required: ['id', 'id'],
    properties: [],
    multipleOf: 0,
  }, 'bad.schema.json');
  const rules = new Set(findings.map((item) => item.ruleId));
  for (const rule of [
    'json-schema-invalid-id',
    'json-schema-invalid-regex',
    'json-schema-duplicate-array-item',
    'json-schema-invalid-schema-map',
    'json-schema-invalid-multiple-of',
  ]) {
    assert.ok(rules.has(rule), `missing expected rule ${rule}`);
  }
});

test('OpenAPI nullable keyword is rejected in the Draft 2020-12 authority lane', () => {
  const findings = validateJsonSchemaDocument({ $schema: dialect, type: 'string', nullable: true });
  assert.ok(findings.some((item) => item.ruleId === 'json-schema-openapi-nullable-keyword'));
});

test('top-level declaration extraction does not mistake nested property names for declarations', () => {
  const schema = {
    $schema: dialect,
    $defs: {
      Envelope: {
        type: 'object',
        properties: {
          User: {
            type: 'object',
            properties: { id: { type: 'string' } },
            $defs: { User: { type: 'string' } },
          },
        },
      },
    },
  };
  assert.deepEqual(extractSchemaDeclarations(schema, 'schema.json').map((item) => item.name), ['Envelope']);
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
