import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SchemaResolutionError,
  SchemaResolver,
  UnsupportedKeywordError,
  jsonEquals,
  validateInstance,
} from '../../src/instance-validator.mjs';

function laneFor(document, path = 'unit.schema.json') {
  const resolver = new SchemaResolver();
  const record = resolver.addDocument(document, path);
  return {
    resolver,
    base: record.base,
    check(pointerName, instance, options = {}) {
      const schema = document.$defs ? document.$defs[pointerName] : document;
      return validateInstance({ schema, instance, resolver, base: record.base, ...options });
    },
  };
}

test('jsonEquals implements structural JSON equality', () => {
  assert.equal(jsonEquals({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
  assert.equal(jsonEquals({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(jsonEquals([1, 2], [2, 1]), false);
  assert.equal(jsonEquals(1, '1'), false);
});

test('type, integer and null assertions follow Draft 2020-12', () => {
  const lane = laneFor({ $defs: { T: { type: 'integer' } } });
  assert.equal(lane.check('T', 3).valid, true);
  assert.equal(lane.check('T', 3.0).valid, true);
  assert.equal(lane.check('T', 3.5).valid, false);
  assert.equal(lane.check('T', '3').valid, false);
  assert.equal(lane.check('T', null).valid, false);

  const nullable = laneFor({ $defs: { T: { type: ['string', 'null'] } } });
  assert.equal(nullable.check('T', null).valid, true);
  assert.equal(nullable.check('T', 'x').valid, true);
  assert.equal(nullable.check('T', 1).valid, false);
});

test('$ref resolves through $id inside a bundle', () => {
  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'bundle.schema.json',
    $defs: {
      Role: { $id: 'Role', type: 'string', enum: ['admin', 'member'] },
      User: {
        $id: 'User',
        type: 'object',
        properties: { role: { $ref: 'Role' } },
        required: ['role'],
      },
    },
  };
  const lane = laneFor(document, 'bundle.schema.json');
  assert.equal(lane.check('User', { role: 'admin' }).valid, true);
  assert.equal(lane.check('User', { role: 'owner' }).valid, false);
});

test('$ref resolves through JSON pointers', () => {
  const document = {
    $defs: {
      Name: { type: 'string', minLength: 2 },
      Holder: { type: 'object', properties: { name: { $ref: '#/$defs/Name' } }, required: ['name'] },
    },
  };
  const lane = laneFor(document);
  assert.equal(lane.check('Holder', { name: 'ok' }).valid, true);
  assert.equal(lane.check('Holder', { name: 'x' }).valid, false);
});

test('unresolvable references fail closed rather than passing silently', () => {
  const lane = laneFor({ $defs: { T: { $ref: 'https://absent.invalid/nothing' } } });
  assert.throws(() => lane.check('T', {}), SchemaResolutionError);
});

test('dynamic reference keywords are refused instead of ignored', () => {
  const lane = laneFor({ $defs: { T: { $dynamicRef: '#meta' } } });
  assert.throws(() => lane.check('T', {}), UnsupportedKeywordError);
});

test('unevaluatedProperties consumes annotations from allOf branches', () => {
  const document = {
    $defs: {
      Base: { type: 'object', properties: { a: { type: 'string' } } },
      Derived: {
        allOf: [{ $ref: '#/$defs/Base' }],
        type: 'object',
        properties: { b: { type: 'string' } },
        unevaluatedProperties: false,
      },
    },
  };
  const lane = laneFor(document);
  assert.equal(lane.check('Derived', { a: 'x', b: 'y' }).valid, true, 'allOf annotations must be visible');
  assert.equal(lane.check('Derived', { a: 'x', b: 'y', c: 'z' }).valid, false);
});

test('additionalProperties false and unevaluatedProperties false agree without composition', () => {
  const additional = laneFor({ $defs: { T: { type: 'object', properties: { a: {} }, additionalProperties: false } } });
  const unevaluated = laneFor({ $defs: { T: { type: 'object', properties: { a: {} }, unevaluatedProperties: false } } });
  for (const instance of [{ a: 1 }, { a: 1, b: 2 }, {}]) {
    assert.equal(
      additional.check('T', instance).valid,
      unevaluated.check('T', instance).valid,
      `verdicts must match for ${JSON.stringify(instance)}`,
    );
  }
});

test('oneOf requires exactly one matching branch', () => {
  const lane = laneFor({
    $defs: { T: { oneOf: [{ type: 'integer' }, { type: 'number' }] } },
  });
  assert.equal(lane.check('T', 1).valid, false, 'an integer matches both branches');
  assert.equal(lane.check('T', 1.5).valid, true);
  assert.equal(lane.check('T', 'x').valid, false);
});

test('array applicators evaluate prefixItems, items, contains and uniqueItems', () => {
  const lane = laneFor({
    $defs: {
      T: {
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: { type: 'integer' },
        contains: { type: 'integer', minimum: 5 },
        minContains: 1,
        uniqueItems: true,
      },
    },
  });
  assert.equal(lane.check('T', ['a', 5, 6]).valid, true);
  assert.equal(lane.check('T', ['a', 1, 2]).valid, false, 'contains is unsatisfied');
  assert.equal(lane.check('T', ['a', 5, 5]).valid, false, 'uniqueItems is violated');
  assert.equal(lane.check('T', ['a', 'b']).valid, false, 'items type is violated');
});

test('unevaluatedItems consumes prefixItems annotations', () => {
  const lane = laneFor({
    $defs: { T: { type: 'array', prefixItems: [{ type: 'string' }], unevaluatedItems: false } },
  });
  assert.equal(lane.check('T', ['a']).valid, true);
  assert.equal(lane.check('T', ['a', 'b']).valid, false);
});

test('if/then/else applies the taken branch only', () => {
  const lane = laneFor({
    $defs: {
      T: {
        type: 'object',
        properties: { kind: { type: 'string' } },
        if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
        then: { required: ['whenA'] },
        else: { required: ['whenOther'] },
      },
    },
  });
  assert.equal(lane.check('T', { kind: 'a', whenA: 1 }).valid, true);
  assert.equal(lane.check('T', { kind: 'a' }).valid, false);
  assert.equal(lane.check('T', { kind: 'b', whenOther: 1 }).valid, true);
});

test('numeric and string constraints are enforced', () => {
  const lane = laneFor({
    $defs: {
      N: { type: 'number', exclusiveMinimum: 0, maximum: 10, multipleOf: 0.5 },
      S: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' },
    },
  });
  assert.equal(lane.check('N', 0).valid, false);
  assert.equal(lane.check('N', 0.5).valid, true);
  assert.equal(lane.check('N', 0.3).valid, false);
  assert.equal(lane.check('N', 10.5).valid, false);
  assert.equal(lane.check('S', 'ab').valid, true);
  assert.equal(lane.check('S', 'a').valid, false);
  assert.equal(lane.check('S', 'abcde').valid, false);
  assert.equal(lane.check('S', 'AB').valid, false);
});

test('dependentRequired and dependentSchemas apply only when the trigger is present', () => {
  const lane = laneFor({
    $defs: {
      T: {
        type: 'object',
        dependentRequired: { card: ['billing'] },
        dependentSchemas: { billing: { required: ['country'] } },
      },
    },
  });
  assert.equal(lane.check('T', {}).valid, true);
  assert.equal(lane.check('T', { card: 1 }).valid, false);
  assert.equal(lane.check('T', { card: 1, billing: 1 }).valid, false, 'dependentSchemas requires country');
  assert.equal(lane.check('T', { card: 1, billing: 1, country: 'US' }).valid, true);
});

test('format is an annotation by default and an assertion on request', () => {
  const lane = laneFor({ $defs: { T: { type: 'string', format: 'uuid' } } });
  assert.equal(lane.check('T', 'not-a-uuid').valid, true);
  assert.equal(lane.check('T', 'not-a-uuid', { formatAssertion: true }).valid, false);
  assert.equal(
    lane.check('T', '123e4567-e89b-12d3-a456-426614174000', { formatAssertion: true }).valid,
    true,
  );
});

test('boolean schemas and unknown annotation keywords behave per specification', () => {
  const lane = laneFor({ $defs: { Yes: true, No: false, Annotated: { 'x-vendor': 'anything', title: 'T' } } });
  assert.equal(lane.check('Yes', { anything: true }).valid, true);
  assert.equal(lane.check('No', {}).valid, false);
  assert.equal(lane.check('Annotated', 42).valid, true);
});

test('errors carry the keyword, instance path and schema pointer', () => {
  const lane = laneFor({ $defs: { T: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } } });
  const result = lane.check('T', { a: 1 });
  assert.equal(result.valid, false);
  const [error] = result.errors;
  assert.equal(error.keyword, 'type');
  assert.equal(error.instancePath, '/a');
  assert.equal(error.schemaPointer, '#/properties/a/type');
});
