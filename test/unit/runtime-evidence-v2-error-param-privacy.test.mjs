import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import {
  RUNTIME_EVIDENCE_SCHEMA_V2,
  validateRuntimeEvidence,
} from '../../src/runtime-conformance/index.mjs';

const digest = (character) => character.repeat(64);

function evidence(params) {
  return {
    schema: RUNTIME_EVIDENCE_SCHEMA_V2,
    contractIrId: digest('a'),
    inputDigest: digest('b'),
    corpusDigest: digest('c'),
    adapters: [{
      id: 'typescript-zod',
      language: 'typescript',
      runtime: 'node@22.16.0',
      validator: 'zod@4.5.4',
      toolchain: 'typescript@7.0.2',
      status: 'passed',
      results: [{
        caseId: 'user.invalid.username',
        declaration: 'Example.User',
        verdict: 'rejected',
        inputDigest: digest('d'),
        outputDigest: null,
        errors: [{
          path: '/username',
          code: 'pattern_mismatch',
          params,
        }],
      }],
    }],
  };
}

async function validateAgainstPublishedSchema(instance) {
  const schema = JSON.parse(await readFile(
    new URL('../../schema/runtime-evidence-v2.schema.json', import.meta.url),
    'utf8',
  ));
  const resolver = new SchemaResolver();
  const record = resolver.addDocument(schema, 'runtime-evidence-v2.schema.json');
  return validateInstance({ schema, instance, resolver, base: record.base });
}

test('identifier-shaped caller data is rejected instead of persisted as validation metadata', async () => {
  const marker = 'alice';
  const value = evidence({ value: marker });
  const executable = validateRuntimeEvidence(value);
  const declarative = await validateAgainstPublishedSchema(value);

  assert.ok(executable.findings.some((finding) => finding.ruleId === 'runtime-error-param-invalid'));
  assert.equal(JSON.stringify(executable.findings).includes(marker), false);
  assert.equal(declarative.valid, false);
});

test('bounded non-payload numeric, boolean, and null rule metadata remains admissible', async () => {
  const value = evidence({ minimum: 3, exclusive: false, expected: null });
  const executable = validateRuntimeEvidence(value);
  const declarative = await validateAgainstPublishedSchema(value);

  assert.deepEqual(executable.findings, []);
  assert.equal(declarative.valid, true, JSON.stringify(declarative.errors));
  assert.deepEqual(executable.normalized.adapters[0].results[0].errors[0].params, {
    exclusive: false,
    expected: null,
    minimum: 3,
  });
});
