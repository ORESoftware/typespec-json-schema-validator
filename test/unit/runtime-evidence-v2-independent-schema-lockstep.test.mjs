import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  RUNTIME_EVIDENCE_SCHEMA_V1,
  RUNTIME_EVIDENCE_SCHEMA_V2,
  validateRuntimeEvidence,
} from '../../src/runtime-conformance/index.mjs';

const digest = (character) => character.repeat(64);

async function independentValidator(
  schemaPath = '../../schema/runtime-evidence-v2.schema.json',
) {
  const schema = JSON.parse(await readFile(
    new URL(schemaPath, import.meta.url),
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
  ['wrong evidence schema identity', (value) => { value.schema = 'ores.typespec-json-schema-validator.runtime-evidence/v3'; }],
  ['unknown result property', (value) => { firstResult(value, 0).raw = true; }],
  ['malformed result input digest', (value) => { firstResult(value, 0).inputDigest = 'not-a-digest'; }],
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
  ['runtime error carries output digest', (value) => {
    Object.assign(firstResult(value, 1), {
      verdict: 'error',
      outputDigest: digest('8'),
      errors: [],
    });
  }],
  ['invalid JSON Pointer error path', (value) => { firstResult(value, 1).errors[0].path = 'id'; }],
  ['raw-looking error parameter value', (value) => {
    firstResult(value, 1).errors[0].params = { value: 'alice@example.com' };
  }],
  ['unknown validation error property', (value) => { firstResult(value, 1).errors[0].message = 'required'; }],
  ['uppercase output digest', (value) => { firstResult(value, 0).outputDigest = 'A'.repeat(64); }],
  ['overlong adapter language', (value) => { value.adapters[0].language = 'x'.repeat(129); }],
  ['control character in adapter runtime', (value) => { value.adapters[0].runtime = 'node\n22'; }],
  ['invalid adapter status', (value) => { value.adapters[0].status = 'ok'; }],
  ['too many validation errors', (value) => {
    firstResult(value, 1).errors = Array.from({ length: 33 }, (_, index) => ({
      path: `/field${index}`,
      code: 'invalid',
      params: { index },
    }));
  }],
];

test('both runtime evidence schemas compile under independent strict Draft 2020-12 validation', async () => {
  const v1 = await independentValidator('../../schema/runtime-evidence.schema.json');
  const v2 = await independentValidator();
  assert.equal(typeof v1, 'function');
  assert.equal(typeof v2, 'function');
});

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

test('v2 schema and executable use JSON character length for bounded Unicode text', async () => {
  const validate = await independentValidator();
  const value = evidence();
  const shortBound = '😀'.repeat(128);
  const longBound = '😀'.repeat(512);
  Object.assign(value.adapters[0], {
    language: shortBound,
    runtime: shortBound,
    validator: shortBound,
    toolchain: longBound,
  });
  for (const result of value.adapters[0].results) result.declaration = longBound;

  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  assert.deepEqual(validateRuntimeEvidence(value).findings, []);

  const over = evidence();
  over.adapters[0].language = '😀'.repeat(129);
  assert.equal(validate(over), false, JSON.stringify(validate.errors));
  assertExecutableRejects(over, '129 Unicode characters exceed adapter language bound');
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

test('schema-valid duplicate adapter and case identities remain explicit executable cross-item policy', async () => {
  const validate = await independentValidator();

  const duplicateAdapter = evidence();
  duplicateAdapter.adapters.push(structuredClone(duplicateAdapter.adapters[0]));
  assert.equal(validate(duplicateAdapter), true, JSON.stringify(validate.errors));
  assert.ok(validateRuntimeEvidence(duplicateAdapter).findings.some(
    (finding) => finding.ruleId === 'runtime-adapter-duplicate',
  ));

  const duplicateCase = evidence();
  duplicateCase.adapters[0].results.push(structuredClone(firstResult(duplicateCase, 0)));
  assert.equal(validate(duplicateCase), true, JSON.stringify(validate.errors));
  assert.ok(validateRuntimeEvidence(duplicateCase).findings.some(
    (finding) => finding.ruleId === 'runtime-result-duplicate',
  ));
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

test('malformed known runtime-evidence fields never echo their raw value into findings', () => {
  const marker = 'secret-looking-output';
  const mutations = [
    (value) => { value.schema = marker; },
    (value) => { value.contractIrId = marker; },
    (value) => { value.adapters = marker; },
    (value) => { value.adapters[0].status = marker; },
    (value) => { value.adapters[0].toolchain = `node@22\n${marker}`; },
    (value) => { firstResult(value, 0).outputDigest = marker; },
    (value) => { firstResult(value, 1).errors[0].path = marker; },
    (value) => { firstResult(value, 1).errors[0].code = `${marker} with spaces`; },
  ];

  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    const runtime = validateRuntimeEvidence(value);
    assert.ok(runtime.findings.length > 0);
    assert.equal(JSON.stringify(runtime.findings).includes(marker), false);
  }
});

test('v1 remains a supported protocol identity after strict-schema hardening', () => {
  assert.equal(RUNTIME_EVIDENCE_SCHEMA_V1, 'ores.typespec-json-schema-validator.runtime-evidence/v1');
});
