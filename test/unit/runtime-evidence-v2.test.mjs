import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNTIME_EVIDENCE_SCHEMA,
  RUNTIME_EVIDENCE_SCHEMA_V2,
  compareRuntimeEvidence,
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
const ACCEPTED_INPUT = '1'.repeat(64);
const ACCEPTED_OUTPUT = '2'.repeat(64);
const REJECTED_INPUT = '3'.repeat(64);
const cases = [
  {
    id: 'user.valid.basic',
    declaration: 'Example.User',
    expectation: 'accepted',
    inputDigest: ACCEPTED_INPUT,
  },
  {
    id: 'user.invalid.missing-id',
    declaration: 'Example.User',
    expectation: 'rejected',
    inputDigest: REJECTED_INPUT,
  },
];

function contractIr() {
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
  };
  return { ...body, irId: sha256(canonicalStringify(body)) };
}

function verification(ir) {
  return {
    schema: CONTRACT_IR_VERIFICATION_SCHEMA,
    status: 'passed',
    admissible: true,
    suppliedIrId: ir.irId,
    computedIrId: ir.irId,
    expectedIrId: ir.irId,
    receiptRunId: INPUT_DIGEST,
    error: null,
  };
}

const accepted = (overrides = {}) => ({
  caseId: 'user.valid.basic',
  declaration: 'Example.User',
  verdict: 'accepted',
  inputDigest: ACCEPTED_INPUT,
  outputDigest: ACCEPTED_OUTPUT,
  errors: [],
  ...overrides,
});

const rejected = (overrides = {}) => ({
  caseId: 'user.invalid.missing-id',
  declaration: 'Example.User',
  verdict: 'rejected',
  inputDigest: REJECTED_INPUT,
  outputDigest: null,
  errors: [{ path: '/id', code: 'required', params: {} }],
  ...overrides,
});

const adapter = (id, overrides = {}) => ({
  id,
  language: id.startsWith('rust') ? 'rust' : 'typescript',
  runtime: id.startsWith('rust') ? 'rust@1.98.0' : 'node@22.16.0',
  validator: id.startsWith('rust') ? 'serde@1.0.228' : 'zod@4.5.4',
  toolchain: id.startsWith('rust') ? 'cargo@1.98.0' : 'typescript@7.0.2',
  status: 'passed',
  results: [accepted(), rejected()],
  ...overrides,
});

function evidence(adapters, overrides = {}) {
  const ir = contractIr();
  return {
    schema: RUNTIME_EVIDENCE_SCHEMA_V2,
    contractIrId: ir.irId,
    inputDigest: INPUT_DIGEST,
    corpusDigest: CORPUS_DIGEST,
    adapters,
    ...overrides,
  };
}

function compare(runtimeEvidence, overrides = {}) {
  const ir = contractIr();
  return compareRuntimeEvidence({
    evidence: runtimeEvidence ?? evidence([adapter('typescript-zod'), adapter('rust-serde')], { contractIrId: ir.irId }),
    contractIr: ir,
    contractIrVerification: verification(ir),
    expectedInputDigest: INPUT_DIGEST,
    expectedCorpusDigest: CORPUS_DIGEST,
    expectedCases: cases,
    requiredAdapters: ['typescript-zod', 'rust-serde'],
    requiredEvidenceSchema: RUNTIME_EVIDENCE_SCHEMA_V2,
    ...overrides,
  });
}

const rules = (report) => report.findings.map((finding) => finding.ruleId);

test('v2 admits matching semantic output and stable validation-error evidence', () => {
  const ir = contractIr();
  const report = compare(evidence([adapter('typescript-zod'), adapter('rust-serde')], { contractIrId: ir.irId }));
  assert.equal(report.status, 'passed');
  assert.equal(report.evidenceSchema, RUNTIME_EVIDENCE_SCHEMA_V2);
  assert.equal(report.findingCount, 0);
});

test('v1 remains compatible but cannot satisfy a v2-required assurance profile', () => {
  const ir = contractIr();
  const v1 = {
    schema: RUNTIME_EVIDENCE_SCHEMA,
    contractIrId: ir.irId,
    inputDigest: INPUT_DIGEST,
    corpusDigest: CORPUS_DIGEST,
    adapters: [{
      id: 'typescript-zod', language: 'typescript', runtime: 'node@22.16.0',
      validator: 'zod@4.5.4', toolchain: 'typescript@7.0.2', status: 'passed',
      results: cases.map((item) => ({
        caseId: item.id, declaration: item.declaration, verdict: item.expectation,
      })),
    }],
  };
  const compatible = compareRuntimeEvidence({
    evidence: v1,
    contractIr: ir,
    contractIrVerification: verification(ir),
    expectedInputDigest: INPUT_DIGEST,
    expectedCorpusDigest: CORPUS_DIGEST,
    expectedCases: cases,
    requiredAdapters: ['typescript-zod'],
  });
  assert.equal(compatible.status, 'passed');

  const stronger = compareRuntimeEvidence({
    evidence: v1,
    contractIr: ir,
    contractIrVerification: verification(ir),
    expectedInputDigest: INPUT_DIGEST,
    expectedCorpusDigest: CORPUS_DIGEST,
    expectedCases: cases,
    requiredAdapters: ['typescript-zod'],
    requiredEvidenceSchema: RUNTIME_EVIDENCE_SCHEMA_V2,
  });
  assert.equal(stronger.status, 'stopped_for_evaluation');
  assert.ok(rules(stronger).includes('runtime-evidence-required-schema-mismatch'));
});

test('v2 requires trusted expected-case input digests even when inferred from evidence', () => {
  const ir = contractIr();
  const unboundCases = cases.map(({ inputDigest: _inputDigest, ...value }) => value);
  const report = compare(
    evidence([adapter('typescript-zod'), adapter('rust-serde')], { contractIrId: ir.irId }),
    {
      expectedCases: unboundCases,
      requiredEvidenceSchema: undefined,
    },
  );
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.ok(rules(report).includes('runtime-corpus-case-input-digest-invalid'));
});

test('matching wrong input digests cannot collude past trusted corpus binding', () => {
  const ir = contractIr();
  const colludingResults = [
    accepted({ inputDigest: '7'.repeat(64) }),
    rejected({ inputDigest: '8'.repeat(64) }),
  ];
  const report = compare(evidence([
    adapter('typescript-zod', { results: colludingResults }),
    adapter('rust-serde', { results: colludingResults }),
  ], { contractIrId: ir.irId }));
  const ids = rules(report);
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.ok(ids.includes('runtime-case-input-digest-mismatch'));
  assert.ok(!ids.includes('runtime-adapter-input-digest-divergence'));
});

test('same accepted verdict with different canonical outputs stops evaluation', () => {
  const rustResults = [accepted({ outputDigest: '4'.repeat(64) }), rejected()];
  const ir = contractIr();
  const report = compare(evidence([
    adapter('typescript-zod'),
    adapter('rust-serde', { results: rustResults }),
  ], { contractIrId: ir.irId }));
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.ok(rules(report).includes('runtime-adapter-output-divergence'));
  assert.ok(!rules(report).includes('runtime-adapter-verdict-divergence'));
});

test('stable validation error divergence is detected without raw rejected values', () => {
  const rustResults = [accepted(), rejected({
    errors: [{ path: '/id', code: 'missing', params: {} }],
  })];
  const ir = contractIr();
  const report = compare(evidence([
    adapter('typescript-zod'),
    adapter('rust-serde', { results: rustResults }),
  ], { contractIrId: ir.irId }));
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.ok(rules(report).includes('runtime-adapter-error-divergence'));
});

test('per-case input digest divergence is independently visible', () => {
  const rustResults = [accepted({ inputDigest: '5'.repeat(64) }), rejected()];
  const ir = contractIr();
  const report = compare(evidence([
    adapter('typescript-zod'),
    adapter('rust-serde', { results: rustResults }),
  ], { contractIrId: ir.irId }));
  assert.ok(rules(report).includes('runtime-adapter-input-digest-divergence'));
  assert.ok(rules(report).includes('runtime-case-input-digest-mismatch'));
});

test('v2 rejects payload-like error params and inconsistent verdict fields', () => {
  const badRejected = rejected({
    outputDigest: '6'.repeat(64),
    errors: [{ path: '/email', code: 'format_email', params: { value: 'alice@example.com' } }],
  });
  const badAccepted = accepted({
    errors: [{ path: '/id', code: 'unexpected', params: {} }],
  });
  const ir = contractIr();
  const report = compare(evidence([
    adapter('typescript-zod', { results: [badAccepted, badRejected] }),
    adapter('rust-serde'),
  ], { contractIrId: ir.irId }));
  const ids = rules(report);
  assert.ok(ids.includes('runtime-error-param-invalid'));
  assert.ok(ids.includes('runtime-result-nonaccepted-output-digest-not-null'));
  assert.ok(ids.includes('runtime-result-accepted-errors-not-empty'));
});

test('identifier-shaped rejected data cannot hide in error params', () => {
  const ir = contractIr();
  const bad = rejected({
    errors: [{ path: '/username', code: 'pattern', params: { value: 'alice' } }],
  });
  const report = compare(evidence([
    adapter('typescript-zod', { results: [accepted(), bad] }),
    adapter('rust-serde'),
  ], { contractIrId: ir.irId }));
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.ok(rules(report).includes('runtime-error-param-invalid'));
  assert.equal(JSON.stringify(report.findings).includes('alice'), false);
});

test('invalid comparison options are shape-redacted rather than echoed', () => {
  const marker = 'secret-looking-runtime-option';
  const report = compare(undefined, {
    requiredEvidenceSchema: marker,
    expectedInputDigest: marker,
    expectedCorpusDigest: marker,
  });
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.ok(rules(report).includes('runtime-required-evidence-schema-invalid'));
  assert.ok(rules(report).includes('runtime-expected-input-digest-invalid'));
  assert.ok(rules(report).includes('runtime-expected-corpus-digest-invalid'));
  assert.equal(JSON.stringify(report.findings).includes(marker), false);
});

test('stable error normalization makes semantically identical error order deterministic', () => {
  const errorsA = [
    { path: '/name', code: 'min_length', params: { minimum: 2 } },
    { path: '/id', code: 'required', params: {} },
  ];
  const errorsB = [...errorsA].reverse().map((entry) => ({
    code: entry.code,
    params: Object.fromEntries(Object.entries(entry.params).reverse()),
    path: entry.path,
  }));
  const ir = contractIr();
  const first = compare(evidence([
    adapter('typescript-zod', { results: [accepted(), rejected({ errors: errorsA })] }),
    adapter('rust-serde', { results: [accepted(), rejected({ errors: errorsB })] }),
  ], { contractIrId: ir.irId }));
  assert.equal(first.status, 'passed');

  const second = compare(evidence([
    adapter('rust-serde', { results: [accepted(), rejected({ errors: errorsB })] }),
    adapter('typescript-zod', { results: [accepted(), rejected({ errors: errorsA })] }),
  ], { contractIrId: ir.irId }));
  assert.equal(second.status, 'passed');
  assert.equal(first.evidenceDigest, second.evidenceDigest);
});
