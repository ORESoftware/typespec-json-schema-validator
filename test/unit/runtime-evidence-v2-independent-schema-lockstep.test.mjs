import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  RUNTIME_EVIDENCE_SCHEMA_V2,
  validateRuntimeEvidence,
} from '../../src/runtime-conformance/index.mjs';

const digest = (character) => character.repeat(64);

async function independentValidator() {
  const schema = JSON.parse(await readFile(
    new URL('../../schema/runtime-evidence-v2.schema.json', import.meta.url),
    'utf8',
  ));
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

function accepted(overrides = {}) {
  return {
    caseId: 'user.valid.basic',
    declaration: 'Example.User',
    verdict: 'accepted',
    inputDigest: digest('1'),
    outputDigest: digest('2'),
    errors: [],
    ...overrides,
  };
}

function rejected(overrides = {}) {
  return {
    caseId: 'user.invalid.missing-id',
    declaration: 'Example.User',
    verdict: 'rejected',
    inputDigest: digest('3'),
    outputDigest: null,
    errors: [{ path: '/id', code: 'required', params: {} }],
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    schema: RUNTIME_EVIDENCE_SCHEMA_V2,
    contractIrId: digest('4'),
    inputDigest: digest('5'),
    corpusDigest: digest('6'),
    adapters: [{
      id: 'typescript-zod',
      language: 'typescript',
      runtime: 'node@22.16.0',
      validator: 'zod@4.5.4',
      toolchain: 'typescript@7.0.2',
      status: 'passed',
      results: [accepted(), rejected()],
    }],
    ...overrides,
  };
}

function firstResult(value, index) {
  return value.adapters[0].results[index];
}

function assertExecutableRejects(value, label) {
  const result = validateRuntimeEvidence(value);
  assert.ok(result.findings.length > 0, `${label}: executable admission unexpectedly had no findings`);
}

const schemaInvalidMutations = [
  ['unknown result property', (value) => { firstResult(value, 0).raw = true; }],
  ['accepted output digest missing', (value) => { firstResult(value, 0).outputDigest = null; }],
  ['accepted validation errors present', (value) => {
    firstResult(value, 0).errors = [{ path: '/id', code: 'unexpected', params: {} }];
  }],
  ['rejected output digest present', (value) => { firstResult(value, 1).outputDigest = digest('7'); }],
  ['rejected validation errors empty', (value) => { firstResult(value, 1).errors = []; }],
  ['runtime error carries validation error', (value) => {
    Object.assign(firstResult(value, 1), {
      verdict: 'error',
      errors: [{ path: '/id', code: 'required', params: {} }],
    });
  }],
  ['invalid JSON Pointer error path', (value) => { firstResult(value, 1).errors[0].path = 'id'; }],
  ['raw-looking error parameter value', (value) => {
    firstResult(value, 1).errors[0].params = { value: 'alice@example.com' };
  }],
  ['unknown validation error property', (value) => { firstResult(value, 1).errors[0].message = 'required'; }],
  ['uppercase output digest', (value) => { firstResult(value, 0).outputDigest = 'A'.repeat(64); }],
  ['too many validation errors', (value) => {
    firstResult(value, 1).errors = Array.from({ length: 33 }, (_, index) => ({
      path: `/field${index}`,
      code: 'invalid',
      params: { index },
    }));
  }],
];

test('Ajv Draft 2020-12 independently admits the canonical runtime-evidence v2 envelope', async () => {
  const validate = await independentValidator();
  const value = evidence();
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  assert.deepEqual(validateRuntimeEvidence(value).findings, []);
});

test('sampled v2 schema-invalid envelopes also fail executable admission', async () => {
  const validate = await independentValidator();
  for (const [label, mutate] of schemaInvalidMutations) {
    const value = structuredClone(evidence());
    mutate(value);
    assert.equal(validate(value), false, `${label}: independent schema unexpectedly accepted mutation`);
    assertExecutableRejects(value, label);
  }
});

test('schema-valid duplicate stable errors remain an explicit executable cross-item policy', async () => {
  const validate = await independentValidator();
  const value = evidence();
  const duplicate = structuredClone(firstResult(value, 1).errors[0]);
  firstResult(value, 1).errors.push(duplicate);

  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  const runtime = validateRuntimeEvidence(value);
  assert.ok(runtime.findings.some((finding) => finding.ruleId === 'runtime-result-error-duplicate'));
});

test('v2 schema and executable both reject non-data-like public error metadata surfaces', async () => {
  const validate = await independentValidator();
  const value = evidence();
  firstResult(value, 1).errors[0].params = { format: 'email', minimum: 3 };
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  assert.deepEqual(validateRuntimeEvidence(value).findings, []);

  const unsafe = evidence();
  firstResult(unsafe, 1).errors[0].params = { format: 'not an identifier with spaces' };
  assert.equal(validate(unsafe), false);
  assertExecutableRejects(unsafe, 'unbounded/free-form error metadata');
});
