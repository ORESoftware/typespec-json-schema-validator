import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  CONTRACT_IR_SCHEMA,
  CONTRACT_IR_VERIFICATION_SCHEMA,
} from '../../src/contract-ir.mjs';
import {
  RUNTIME_CONFORMANCE_REPORT_SCHEMA,
  RUNTIME_EVIDENCE_SCHEMA,
  compareRuntimeEvidence,
  createRuntimeEvidenceContractBinding,
  validateRuntimeEvidence,
} from '../../src/runtime-conformance/index.mjs';

const RUN_ID = 'a'.repeat(64);
const CORPUS_DIGEST = 'b'.repeat(64);
const RECEIPT_DIGEST = 'c'.repeat(64);
const TYPESPEC_DIGEST = 'd'.repeat(64);
const GENERATED_DIGEST = 'e'.repeat(64);
const AUTHORED_DIGEST = 'f'.repeat(64);

function contractIr(overrides = {}) {
  const body = {
    schema: CONTRACT_IR_SCHEMA,
    status: 'passed',
    admissible: true,
    role: 'downstream-derived-parity-artifact',
    editableAuthority: false,
    authorities: {
      typespec: 'independently-authored',
      jsonSchema: 'independently-authored',
      generatedJsonSchema: 'comparison-evidence-only',
      precedence: 'none',
    },
    admission: {
      receipt: {
        schema: 'ores.typespec-json-schema-validator.report/v1',
        runId: RUN_ID,
        digest: RECEIPT_DIGEST,
        status: 'passed',
        zeroUnexplainedFindings: true,
      },
    },
    provenance: {
      typespec: { digest: TYPESPEC_DIGEST },
      generatedJsonSchema: { digest: GENERATED_DIGEST },
      authoredJsonSchema: { digest: AUTHORED_DIGEST },
    },
    declarations: [{ id: 'Example.User' }],
    excludedDeclarations: [],
    outOfScopeDeclarations: [],
    ...overrides,
  };
  return Object.freeze({
    ...body,
    irId: sha256(canonicalStringify(body)),
  });
}

function verification(ir, overrides = {}) {
  return Object.freeze({
    schema: CONTRACT_IR_VERIFICATION_SCHEMA,
    status: 'passed',
    admissible: true,
    suppliedIrId: ir.irId,
    computedIrId: ir.irId,
    expectedIrId: ir.irId,
    receiptRunId: RUN_ID,
    error: null,
    ...overrides,
  });
}

function evidence(ir, overrides = {}) {
  return {
    schema: RUNTIME_EVIDENCE_SCHEMA,
    contractIrId: ir.irId,
    inputDigest: RUN_ID,
    corpusDigest: CORPUS_DIGEST,
    adapters: [
      {
        id: 'typescript-zod',
        language: 'typescript',
        runtime: 'node@22.16.0',
        validator: 'zod@4.5.4',
        toolchain: 'typescript@7.0.2',
        status: 'passed',
        results: [
          {
            caseId: 'user.valid.basic',
            declaration: 'Example.User',
            verdict: 'accepted',
          },
        ],
      },
    ],
    ...overrides,
  };
}

const expectedCases = Object.freeze([
  Object.freeze({
    id: 'user.valid.basic',
    declaration: 'Example.User',
    expectation: 'accepted',
  }),
]);

function compare(overrides = {}) {
  const ir = overrides.contractIr ?? contractIr();
  const contractIrVerification = Object.hasOwn(overrides, 'contractIrVerification')
    ? overrides.contractIrVerification
    : verification(ir);
  return compareRuntimeEvidence({
    evidence: overrides.evidence ?? evidence(ir),
    contractIr: ir,
    contractIrVerification,
    expectedInputDigest: RUN_ID,
    expectedCorpusDigest: CORPUS_DIGEST,
    expectedCases,
    requiredAdapters: [
      {
        id: 'typescript-zod',
        language: 'typescript',
        validator: 'zod@4.5.4',
      },
    ],
  });
}

test('runtime evidence and runtime decisions have distinct protocol identities', () => {
  const ir = contractIr();
  const normalized = validateRuntimeEvidence(evidence(ir));
  assert.equal(normalized.normalized.schema, RUNTIME_EVIDENCE_SCHEMA);

  const report = compare({ contractIr: ir });
  assert.equal(report.schema, RUNTIME_CONFORMANCE_REPORT_SCHEMA);
  assert.notEqual(report.schema, normalized.normalized.schema);
  assert.equal(report.status, 'passed');
  assert.equal(report.receiptDigest, RECEIPT_DIGEST);
  assert.equal(report.contractIrId, ir.irId);
  assert.equal(report.receiptRunId, RUN_ID);
  assert.equal(Object.isFrozen(report), true);
});

test('an unverified Contract IR decision never retains the receipt digest', () => {
  const ir = contractIr();
  const report = compare({
    contractIr: ir,
    contractIrVerification: verification(ir, {
      status: 'failed',
      admissible: false,
      error: 'secret-looking-verifier-output',
    }),
  });
  assert.equal(report.schema, RUNTIME_CONFORMANCE_REPORT_SCHEMA);
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(report.contractIrVerified, false);
  assert.equal(report.receiptDigest, null);
  assert.doesNotMatch(JSON.stringify(report), /secret-looking-verifier-output/);
});

test('low-level binding exposes only immutable adapter receipt fields', () => {
  const ir = contractIr();
  const binding = createRuntimeEvidenceContractBinding({
    contractIr: ir,
    contractIrVerification: verification(ir),
  });
  assert.deepEqual(binding, {
    contractIrId: ir.irId,
    inputDigest: RUN_ID,
  });
  assert.equal(Object.isFrozen(binding), true);
  assert.deepEqual(Object.keys(binding).sort(), ['contractIrId', 'inputDigest']);
});

test('invalid binding errors contain stable rules but not verifier content', () => {
  const ir = contractIr();
  assert.throws(
    () => createRuntimeEvidenceContractBinding({
      contractIr: ir,
      contractIrVerification: verification(ir, {
        status: 'failed',
        admissible: false,
        expectedIrId: '9'.repeat(64),
        error: 'do-not-leak-this-path-or-secret',
      }),
    }),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.match(error.message, /runtime-contract-ir-verification-failed/);
      assert.doesNotMatch(error.message, /do-not-leak-this-path-or-secret/);
      return true;
    },
  );
});

test('the decision schema is published separately from the evidence schema', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../../package.json', import.meta.url),
    'utf8',
  ));
  assert.equal(
    packageJson.exports['./schema/runtime-conformance-report'],
    './schema/runtime-conformance-report.schema.json',
  );
  assert.equal(
    packageJson.exports['./schema/runtime-evidence'],
    './schema/runtime-evidence.schema.json',
  );

  const schema = JSON.parse(await readFile(
    new URL('../../schema/runtime-conformance-report.schema.json', import.meta.url),
    'utf8',
  ));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(
    schema.properties.schema.const,
    RUNTIME_CONFORMANCE_REPORT_SCHEMA,
  );
  assert.ok(schema.required.includes('receiptDigest'));
  assert.deepEqual(schema.properties.receiptDigest, {
    $ref: '#/$defs/nullableSha256',
  });
});
