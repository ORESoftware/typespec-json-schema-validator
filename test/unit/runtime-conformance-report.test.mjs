import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  RUNTIME_CONFORMANCE_REPORT_SCHEMA,
  RUNTIME_EVIDENCE_SCHEMA,
  compareRuntimeEvidence,
  createRuntimeEvidenceContractBinding,
} from '../../src/runtime-conformance/index.mjs';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  CONTRACT_IR_SCHEMA,
  CONTRACT_IR_VERIFICATION_SCHEMA,
} from '../../src/contract-ir.mjs';

const INPUT_DIGEST = 'a'.repeat(64);
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
        runId: INPUT_DIGEST,
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
  return { ...body, irId: sha256(canonicalStringify(body)) };
}

function verification(ir, overrides = {}) {
  return {
    schema: CONTRACT_IR_VERIFICATION_SCHEMA,
    status: 'passed',
    admissible: true,
    suppliedIrId: ir.irId,
    computedIrId: ir.irId,
    expectedIrId: ir.irId,
    receiptRunId: ir.admission.receipt.runId,
    error: null,
    ...overrides,
  };
}

function adapter() {
  return {
    id: 'typescript-zod',
    language: 'typescript',
    runtime: 'node@22.16.0',
    validator: 'zod@4.5.4',
    toolchain: 'typescript@7.0.2',
    status: 'passed',
    results: [
      { caseId: 'user.valid.basic', declaration: 'Example.User', verdict: 'accepted' },
    ],
  };
}

function compare(overrides = {}) {
  const ir = overrides.contractIr ?? contractIr();
  const currentVerification = overrides.contractIrVerification ?? verification(ir);
  const binding = createRuntimeEvidenceContractBinding({
    contractIr: ir,
    contractIrVerification: currentVerification,
  });
  return compareRuntimeEvidence({
    contractIr: ir,
    contractIrVerification: currentVerification,
    evidence: {
      schema: RUNTIME_EVIDENCE_SCHEMA,
      ...binding,
      corpusDigest: CORPUS_DIGEST,
      adapters: [adapter()],
    },
    expectedInputDigest: INPUT_DIGEST,
    expectedCorpusDigest: CORPUS_DIGEST,
    expectedCases: [
      { id: 'user.valid.basic', declaration: 'Example.User', expectation: 'accepted' },
    ],
    requiredAdapters: [
      { id: 'typescript-zod', language: 'typescript', validator: 'zod@4.5.4' },
    ],
    ...overrides,
  });
}

test('creates the minimal exact Contract IR binding for isolated adapters', () => {
  const ir = contractIr();
  assert.deepEqual(
    createRuntimeEvidenceContractBinding({ contractIr: ir, contractIrVerification: verification(ir) }),
    { contractIrId: ir.irId, inputDigest: INPUT_DIGEST },
  );
});

test('runtime evidence and the admission decision use distinct schema identifiers', () => {
  const result = compare();
  assert.notEqual(RUNTIME_CONFORMANCE_REPORT_SCHEMA, RUNTIME_EVIDENCE_SCHEMA);
  assert.equal(result.schema, RUNTIME_CONFORMANCE_REPORT_SCHEMA);
  assert.equal(result.status, 'passed');
  assert.equal(result.contractIrVerified, true);
  assert.equal(result.receiptRunId, INPUT_DIGEST);
  assert.equal(result.receiptDigest, RECEIPT_DIGEST);
  assert.ok(Object.isFrozen(result));
});

test('a failed Contract IR verification cannot expose a trusted receipt digest', () => {
  const ir = contractIr();
  const failedVerification = verification(ir, {
    status: 'failed',
    admissible: false,
    expectedIrId: '9'.repeat(64),
    error: 'sensitive internal verification detail',
  });
  const result = compareRuntimeEvidence({
    contractIr: ir,
    contractIrVerification: failedVerification,
    evidence: {
      schema: RUNTIME_EVIDENCE_SCHEMA,
      contractIrId: ir.irId,
      inputDigest: INPUT_DIGEST,
      corpusDigest: CORPUS_DIGEST,
      adapters: [adapter()],
    },
    expectedInputDigest: INPUT_DIGEST,
    expectedCorpusDigest: CORPUS_DIGEST,
    expectedCases: [
      { id: 'user.valid.basic', declaration: 'Example.User', expectation: 'accepted' },
    ],
    requiredAdapters: ['typescript-zod'],
  });
  assert.equal(result.schema, RUNTIME_CONFORMANCE_REPORT_SCHEMA);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.contractIrVerified, false);
  assert.equal(result.receiptDigest, null);
});

test('binding failures expose bounded rule identifiers instead of verification payloads', () => {
  const ir = contractIr();
  assert.throws(
    () => createRuntimeEvidenceContractBinding({
      contractIr: ir,
      contractIrVerification: verification(ir, {
        status: 'failed',
        admissible: false,
        error: 'https://private.example.invalid/path?token=must-not-leak',
      }),
    }),
    (error) => {
      assert.match(error.message, /runtime-contract-ir-verification-failed/);
      assert.doesNotMatch(error.message, /private\.example|token=|must-not-leak/);
      return true;
    },
  );
});

test('publishes the runtime decision schema through the package surface', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(
    packageJson.exports['./schema/runtime-conformance-report'],
    './schema/runtime-conformance-report.schema.json',
  );
  const schema = JSON.parse(
    await readFile(new URL('../../schema/runtime-conformance-report.schema.json', import.meta.url), 'utf8'),
  );
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schema.const, RUNTIME_CONFORMANCE_REPORT_SCHEMA);
  assert.deepEqual(schema.required.includes('receiptDigest'), true);
});
