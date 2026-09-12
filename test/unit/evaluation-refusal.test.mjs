import assert from 'node:assert/strict';
import test from 'node:test';
import { crossValidate } from '../../src/differential.mjs';
import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import { extractSchemaDeclarations } from '../../src/json-schema.mjs';

function check(schema, instance, options = {}) {
  const resolver = new SchemaResolver([{ document: schema, path: 'evaluation.json' }]);
  return validateInstance({ schema, instance, resolver, base: resolver.documents[0].base, ...options });
}

const cyclicCases = [
  ['direct reference', { $ref: '#' }, 1],
  ['negated reference', { not: { $ref: '#' } }, 1],
  ['allOf', { allOf: [{ $ref: '#' }] }, 1],
  ['anyOf with a passing sibling', { anyOf: [true, { $ref: '#' }] }, 1],
  ['oneOf with a passing sibling', { oneOf: [true, { $ref: '#' }] }, 1],
  ['conditional test', { if: { $ref: '#' }, then: true, else: true }, 1],
  ['contains branch', { contains: { not: { $ref: '#/$defs/Loop' } }, $defs: { Loop: { $ref: '#/$defs/Loop' } } }, [1]],
];

for (const [label, schema, instance] of cyclicCases) {
  test(`unfinished ${label} evaluation is a refusal, never a boolean verdict`, () => {
    assert.throws(() => check(schema, instance, { maxErrors: 0 }), (error) => {
      assert.equal(error.name, 'SchemaEvaluationError');
      assert.equal(error.reason, 'reference-cycle');
      assert.equal(typeof error.pointer, 'string');
      return true;
    });
  });
}

for (const wrapper of [
  (deep) => deep,
  (deep) => ({ not: deep }),
  (deep) => ({ oneOf: [true, deep] }),
  (deep) => ({ if: deep, then: true, else: true }),
]) {
  test('acyclic evaluation beyond the depth budget cannot be inverted into acceptance', () => {
    let deep = { type: 'integer' };
    for (let index = 0; index < 140; index += 1) deep = { allOf: [deep] };
    assert.throws(() => check(wrapper(deep), 1), (error) =>
      error.name === 'SchemaEvaluationError' && error.reason === 'maximum-depth');
  });
}

test('finite recursive instance descent still accepts valid data and rejects bad data', () => {
  const schema = {
    type: 'object',
    properties: { value: { type: 'integer' }, next: { $ref: '#' } },
    required: ['value'],
    additionalProperties: false,
  };
  assert.equal(check(schema, { value: 1, next: { value: 2 } }).valid, true);
  assert.equal(check(schema, { value: 1, next: { value: 'wrong' } }).valid, false);
});

test('sibling references do not leave stale recursion frames behind', () => {
  const schema = { allOf: [{ $ref: '#/$defs/Number' }, { $ref: '#/$defs/Number' }], $defs: { Number: { type: 'integer' } } };
  assert.equal(check(schema, 1).valid, true);
  assert.equal(check(schema, 'wrong').valid, false);
});

test('unsupported resource dialects are refused rather than evaluated as Draft 2020-12', () => {
  const oldDialect = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'integer' };
  for (const schema of [oldDialect, { not: oldDialect }]) {
    assert.throws(() => check(schema, 1), (error) => error.name === 'UnsupportedKeywordError' && error.keyword === '$schema');
  }
});

test('two unfinished lanes cannot manufacture behavioral agreement', () => {
  const document = { $defs: { Loop: { not: { $ref: '#/$defs/Loop' } } } };
  const collection = {
    documents: [{ document, path: 'loop.json' }],
    declarations: extractSchemaDeclarations(document, 'loop.json'),
    findings: [],
  };
  const result = crossValidate({
    generatedCollection: collection,
    authoredCollection: structuredClone(collection),
    declarationMap: [{ typespec: 'Loop', generated: 'Loop', authored: 'Loop' }],
    maxProbes: 4,
  });
  assert.ok(result.summary.refusals > 0);
  assert.equal(result.summary.agreements, 0);
  assert.equal(result.summary.behaviorallyIndistinguishableDeclarations, 0);
  assert.ok(result.findings.every((finding) => finding.ruleId === 'differential-validation-refused'));
  assert.equal(result.findings[0].left.name, 'SchemaEvaluationError');
  assert.equal(result.findings[0].right.name, 'SchemaEvaluationError');
});
