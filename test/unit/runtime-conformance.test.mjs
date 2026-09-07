import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_IR_SCHEMA,
  CONTRACT_IR_VERIFICATION_SCHEMA,
  RUNTIME_CONFORMANCE_REPORT_SCHEMA,
  RUNTIME_EVIDENCE_SCHEMA,
  compareRuntimeEvidence,
  createRuntimeEvidenceContractBinding,
  loadRuntimeEvidence,
  validateRuntimeEvidence,
} from '../../src/runtime-conformance/index.mjs';
import {
  CONTRACT_IR_SCHEMA as ROOT_CONTRACT_IR_SCHEMA,
  CONTRACT_IR_VERIFICATION_SCHEMA as ROOT_CONTRACT_IR_VERIFICATION_SCHEMA,
} from '../../src/contract-ir.mjs';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const INPUT_DIGEST = 'a'.repeat(64);
const CORPUS_DIGEST = 'b'.repeat(64);
const PARITY_RUN_ID = 'c'.repeat(64);
const PARITY_DIGEST = 'd'.repeat(64);

const CONTRACT_IR_BODY = {
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
      runId: PARITY_RUN_ID,
      digest: PARITY_DIGEST,
      status: 'passed',
      zeroUnexplainedFindings: true,
    },
  },
  declarations: [],
  excludedDeclarations: [],
  outOfScopeDeclarations: [],
};
const CONTRACT_IR = Object.freeze({
  ...CONTRACT_IR_BODY,
  irId: sha256(canonicalStringify(CONTRACT_IR_BODY)),
});

const contractIrVerification = (overrides = {}) => ({
  schema: CONTRACT_IR_VERIFICATION_SCHEMA,
  status: 'passed',
  admissible: true,
  suppliedIrId: CONTRACT_IR.irId,
  computedIrId: CONTRACT_IR.irId,
  expectedIrId: CONTRACT_IR.irId,
  receiptRunId: PARITY_RUN_ID,
  error: null,
  ...overrides,
});

const contractBinding = (overrides = {}) => ({
  ...createRuntimeEvidenceContractBinding({
    contractIr: CONTRACT_IR,
    contractIrVerification: contractIrVerification(),
  }),
  ...overrides,
});

const cases = [
  { id: 'user.valid.basic', declaration: 'Example.User', expectation: 'accepted' },
  { id: 'user.invalid.missing-id', declaration: 'Example.User', expectation: 'rejected' },
];

const adapter = (overrides = {}) => ({
  id: 'typescript-zod',
  language: 'typescript',
  runtime: 'node@22.16.0',
  validator: 'zod@4.5.4',
  toolchain: 'typescript@7.0.2',
  status: 'passed',
  results: [
    { caseId: 'user.valid.basic', declaration: 'Example.User', verdict: 'accepted' },
    { caseId: 'user.invalid.missing-id', declaration: 'Example.User', verdict: 'rejected' },
  ],
  ...overrides,
});

const evidence = (overrides = {}) => ({
  schema: RUNTIME_EVIDENCE_SCHEMA,
  contractIr: contractBinding(),
  inputDigest: INPUT_DIGEST,
  corpusDigest: CORPUS_DIGEST,
  adapters: [adapter()],
  ...overrides,
});

const compare = (overrides = {}) => compareRuntimeEvidence({
  evidence: evidence(),
  contractIr: CONTRACT_IR,
  contractIrVerification: contractIrVerification(),
  expectedInputDigest: INPUT_DIGEST,
  expectedCorpusDigest: CORPUS_DIGEST,
  expectedCases: cases,
  requiredAdapters: [{ id: 'typescript-zod', language: 'typescript', validator: 'zod@4.5.4' }],
  ...overrides,
});

function ruleIds(result) {
  return result.findings.map((finding) => finding.ruleId);
}

test('runtime schema constants remain aligned with the root Contract IR API', () => {
  assert.equal(CONTRACT_IR_SCHEMA, ROOT_CONTRACT_IR_SCHEMA);
  assert.equal(CONTRACT_IR_VERIFICATION_SCHEMA, ROOT_CONTRACT_IR_VERIFICATION_SCHEMA);
});

test('builds a compact binding only from a self-consistent admitted Contract IR', () => {
  assert.deepEqual(contractBinding(), {
    schema: CONTRACT_IR_SCHEMA,
    irId: CONTRACT_IR.irId,
    parityReceipt: { runId: PARITY_RUN_ID, digest: PARITY_DIGEST },
  });
});

test('passes exact-input evidence when every required adapter executes every case', () => {
  const result = compare();
  assert.equal(result.schema, RUNTIME_CONFORMANCE_REPORT_SCHEMA);
  assert.equal(result.status, 'passed');
  assert.equal(result.zeroUnexplainedFindings, true);
  assert.equal(result.findingCount, 0);
  assert.equal(result.summary.expectedCases, 2);
  assert.equal(result.summary.passedAdapters, 1);
  assert.equal(result.summary.contractBindingVerified, true);
  assert.equal(result.contractIrId, CONTRACT_IR.irId);
  assert.equal(result.parityReceiptRunId, PARITY_RUN_ID);
  assert.equal(result.parityReceiptDigest, PARITY_DIGEST);
  assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.match(result.expectedCaseDigest, /^[a-f0-9]{64}$/);
});

test('normalization makes evidence and findings deterministic', () => {
  const reordered = evidence({
    adapters: [adapter({ results: [...adapter().results].reverse() })],
  });
  const first = compare();
  const second = compare({ evidence: reordered });
  assert.equal(first.evidenceDigest, second.evidenceDigest);
  assert.deepEqual(first.findings, second.findings);
});

test('fails closed when the evidence schema id is missing', () => {
  const result = compare({ evidence: evidence({ schema: undefined }) });
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(ruleIds(result).includes('runtime-evidence-schema-mismatch'));
});

test('fails closed when runtime evidence names a different Contract IR', () => {
  const result = compare({
    evidence: evidence({ contractIr: contractBinding({ irId: 'e'.repeat(64) }) }),
  });
  assert.ok(ruleIds(result).includes('runtime-contract-ir-id-mismatch'));
});

test('fails closed when runtime evidence names a different parity receipt', () => {
  const result = compare({
    evidence: evidence({
      contractIr: contractBinding({
        parityReceipt: { runId: 'e'.repeat(64), digest: 'f'.repeat(64) },
      }),
    }),
  });
  assert.ok(ruleIds(result).includes('runtime-parity-receipt-run-id-mismatch'));
  assert.ok(ruleIds(result).includes('runtime-parity-receipt-digest-mismatch'));
});

test('fails closed when the trusted Contract IR verification is not current and passed', () => {
  const result = compare({
    contractIrVerification: contractIrVerification({
      status: 'failed',
      admissible: false,
      error: 'source digest changed',
    }),
  });
  assert.ok(ruleIds(result).includes('runtime-contract-ir-not-admissible'));
  assert.equal(result.summary.contractBindingVerified, false);
  assert.equal(result.contractIrId, null);
});

test('refuses a tampered Contract IR even when a copied verification claims success', () => {
  const tampered = { ...CONTRACT_IR, declarations: [{ id: 'tampered' }] };
  assert.throws(
    () => createRuntimeEvidenceContractBinding({
      contractIr: tampered,
      contractIrVerification: contractIrVerification(),
    }),
    /canonical artifact body/,
  );
});

test('refuses verification identities that do not bind the supplied Contract IR', () => {
  assert.throws(
    () => createRuntimeEvidenceContractBinding({
      contractIr: CONTRACT_IR,
      contractIrVerification: contractIrVerification({ expectedIrId: 'f'.repeat(64) }),
    }),
    /expectedIrId/,
  );
});

test('fails closed on stale generated-validator input evidence', () => {
  const result = compare({ evidence: evidence({ inputDigest: 'c'.repeat(64) }) });
  assert.ok(ruleIds(result).includes('runtime-input-digest-mismatch'));
});

test('fails closed on stale corpus evidence', () => {
  const result = compare({ evidence: evidence({ corpusDigest: 'c'.repeat(64) }) });
  assert.ok(ruleIds(result).includes('runtime-corpus-digest-mismatch'));
});

test('rejects malformed digests rather than normalizing them', () => {
  const result = compare({ evidence: evidence({ inputDigest: 'A'.repeat(64), corpusDigest: 'nope' }) });
  assert.equal(ruleIds(result).filter((rule) => rule === 'runtime-evidence-invalid-digest').length, 2);
});

test('rejects malformed Contract IR binding digests', () => {
  const result = compare({
    evidence: evidence({
      contractIr: {
        schema: CONTRACT_IR_SCHEMA,
        irId: 'BAD',
        parityReceipt: { runId: 'also-bad', digest: null },
      },
    }),
  });
  assert.equal(ruleIds(result).filter((rule) => rule === 'runtime-evidence-invalid-digest').length, 3);
});

test('rejects malformed trusted expected digests', () => {
  const result = compare({ expectedInputDigest: '', expectedCorpusDigest: null });
  assert.ok(ruleIds(result).includes('runtime-expected-input-digest-invalid'));
  assert.ok(ruleIds(result).includes('runtime-expected-corpus-digest-invalid'));
});

test('fails when a required adapter is missing', () => {
  const result = compare({ requiredAdapters: ['rust-serde'] });
  assert.ok(ruleIds(result).includes('runtime-required-adapter-missing'));
});

test('checks required adapter language and validator identity', () => {
  const result = compare({
    requiredAdapters: [{ id: 'typescript-zod', language: 'rust', validator: 'serde' }],
  });
  assert.equal(ruleIds(result).filter((rule) => rule === 'runtime-required-adapter-identity-mismatch').length, 2);
});

test('a failed adapter is never accepted even when its verdicts match', () => {
  const result = compare({ evidence: evidence({ adapters: [adapter({ status: 'failed' })] }) });
  assert.ok(ruleIds(result).includes('runtime-adapter-failed'));
});

test('skipped and unsupported adapters are explicit non-execution findings', () => {
  for (const status of ['skipped', 'unsupported']) {
    const result = compare({ evidence: evidence({ adapters: [adapter({ status })] }) });
    assert.ok(ruleIds(result).includes('runtime-adapter-not-executed'));
  }
});

test('missing cases stop admission', () => {
  const result = compare({
    evidence: evidence({ adapters: [adapter({ results: [adapter().results[0]] })] }),
  });
  assert.ok(ruleIds(result).includes('runtime-case-missing'));
});

test('unknown extra cases stop admission', () => {
  const result = compare({
    evidence: evidence({
      adapters: [adapter({
        results: [...adapter().results, {
          caseId: 'user.extra',
          declaration: 'Example.User',
          verdict: 'accepted',
        }],
      })],
    }),
  });
  assert.ok(ruleIds(result).includes('runtime-case-extra'));
});

test('declaration identity drift is reported independently from verdicts', () => {
  const results = adapter().results.map((item) => ({ ...item }));
  results[0].declaration = 'Wrong.User';
  const result = compare({ evidence: evidence({ adapters: [adapter({ results })] }) });
  assert.ok(ruleIds(result).includes('runtime-case-declaration-mismatch'));
});

test('accepted versus rejected drift is reported', () => {
  const results = adapter().results.map((item) => ({ ...item }));
  results[1].verdict = 'accepted';
  const result = compare({ evidence: evidence({ adapters: [adapter({ results })] }) });
  assert.ok(ruleIds(result).includes('runtime-case-verdict-mismatch'));
});

test('error verdicts are not treated as schema rejection', () => {
  const results = adapter().results.map((item) => ({ ...item }));
  results[1].verdict = 'error';
  const result = compare({ evidence: evidence({ adapters: [adapter({ results })] }) });
  assert.ok(ruleIds(result).includes('runtime-case-error'));
  assert.ok(!ruleIds(result).includes('runtime-case-verdict-mismatch'));
});

test('skipped and unsupported case verdicts are not treated as schema rejection', () => {
  for (const verdict of ['skipped', 'unsupported']) {
    const results = adapter().results.map((item) => ({ ...item }));
    results[1].verdict = verdict;
    const result = compare({ evidence: evidence({ adapters: [adapter({ results })] }) });
    assert.ok(ruleIds(result).includes('runtime-case-not-executed'));
  }
});

test('cross-adapter verdict divergence gets a dedicated finding', () => {
  const rustResults = adapter().results.map((item) => ({ ...item }));
  rustResults[0].verdict = 'rejected';
  const result = compare({
    evidence: evidence({
      adapters: [
        adapter(),
        adapter({
          id: 'rust-serde',
          language: 'rust',
          runtime: 'rust@1.98.0',
          validator: 'serde@1',
          toolchain: 'cargo@1.98.0',
          results: rustResults,
        }),
      ],
    }),
    requiredAdapters: ['typescript-zod', 'rust-serde'],
  });
  assert.ok(ruleIds(result).includes('runtime-adapter-verdict-divergence'));
});

test('duplicate adapters and duplicate case results are rejected', () => {
  const duplicatedResults = [...adapter().results, { ...adapter().results[0] }];
  const result = compare({
    evidence: evidence({ adapters: [adapter({ results: duplicatedResults }), adapter()] }),
  });
  assert.ok(ruleIds(result).includes('runtime-adapter-duplicate'));
  assert.ok(ruleIds(result).includes('runtime-result-duplicate'));
});

test('duplicate trusted cases and required adapters are rejected', () => {
  const result = compare({
    expectedCases: [...cases, { ...cases[0] }],
    requiredAdapters: ['typescript-zod', 'typescript-zod'],
  });
  assert.ok(ruleIds(result).includes('runtime-corpus-case-duplicate'));
  assert.ok(ruleIds(result).includes('runtime-required-adapter-duplicate'));
});

test('malformed evidence and adapter metadata return findings instead of throwing', () => {
  const invalid = validateRuntimeEvidence({
    schema: RUNTIME_EVIDENCE_SCHEMA,
    contractIr: contractBinding(),
    inputDigest: INPUT_DIGEST,
    corpusDigest: CORPUS_DIGEST,
    adapters: [{ id: 'Bad ID', status: 'maybe', results: {} }],
  });
  assert.equal(invalid.normalized.adapters.length, 0);
  assert.ok(ruleIds(invalid).includes('runtime-adapter-id-invalid'));
});

test('control characters in metadata are rejected to prevent log injection', () => {
  const result = compare({
    evidence: evidence({ adapters: [adapter({ toolchain: 'node@22\nsecret-looking-output' })] }),
  });
  assert.ok(ruleIds(result).includes('runtime-adapter-metadata-invalid'));
});

test('adapter and result limits are enforced with bounded processing', () => {
  const validation = validateRuntimeEvidence(evidence({ adapters: [adapter(), adapter({ id: 'rust-serde' })] }), {
    maxAdapters: 1,
    maxResultsPerAdapter: 1,
  });
  assert.ok(ruleIds(validation).includes('runtime-adapter-limit-exceeded'));
  assert.ok(ruleIds(validation).includes('runtime-adapter-result-limit-exceeded'));
  assert.equal(validation.normalized.adapters.length, 1);
  assert.equal(validation.normalized.adapters[0].results.length, 1);
});

test('trusted processing limits must be positive safe integers', () => {
  assert.throws(() => validateRuntimeEvidence(evidence(), { maxAdapters: 0 }), /maxAdapters/);
  assert.throws(() => validateRuntimeEvidence(evidence(), { maxResultsPerAdapter: -1 }), /maxResultsPerAdapter/);
  assert.throws(() => compare({ maxFindings: 0 }), /maxFindings/);
});

test('empty adapter evidence and an empty trusted corpus fail closed', () => {
  const noAdapters = compare({ evidence: evidence({ adapters: [] }), requiredAdapters: [] });
  assert.ok(ruleIds(noAdapters).includes('runtime-evidence-adapters-empty'));

  const noCases = compare({
    evidence: evidence({ adapters: [adapter({ results: [] })] }),
    expectedCases: [],
    requiredAdapters: ['typescript-zod'],
  });
  assert.ok(ruleIds(noCases).includes('runtime-corpus-empty'));
});

test('finding output is truncated deterministically without hiding total count', () => {
  const result = compare({
    evidence: evidence({ adapters: [] }),
    requiredAdapters: ['typescript-zod', 'rust-serde', 'dart-freezed'],
    maxFindings: 2,
  });
  assert.equal(result.findings.length, 2);
  assert.equal(result.truncated, true);
  assert.ok(result.findingCount > result.findings.length);
});

test('runtime evidence normalization discards untrusted logs and arbitrary contract fields', () => {
  const validation = validateRuntimeEvidence(evidence({
    stdout: 'token-like output',
    contractIr: {
      ...contractBinding(),
      arbitrary: { secret: true },
      parityReceipt: { ...contractBinding().parityReceipt, stdout: 'not retained' },
    },
    adapters: [adapter({ stdout: 'more output', arbitrary: { secret: true } })],
  }));
  assert.equal('stdout' in validation.normalized, false);
  assert.equal('arbitrary' in validation.normalized.contractIr, false);
  assert.equal('stdout' in validation.normalized.contractIr.parityReceipt, false);
  assert.equal('stdout' in validation.normalized.adapters[0], false);
  assert.equal('arbitrary' in validation.normalized.adapters[0], false);
});

test('package exports publish the runtime API and both schemas', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(packageJson.exports['./runtime-conformance'], {
    import: './src/runtime-conformance/index.mjs',
    types: './src/runtime-conformance/index.d.mts',
  });
  assert.equal(packageJson.exports['./schema/runtime-evidence'], './schema/runtime-evidence.schema.json');
  assert.equal(
    packageJson.exports['./schema/runtime-conformance-report'],
    './schema/runtime-conformance-report.schema.json',
  );
});

test('loadRuntimeEvidence parses JSON without executing adapter output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-runtime-'));
  const path = join(directory, 'evidence.json');
  try {
    await writeFile(path, JSON.stringify(evidence()), 'utf8');
    assert.deepEqual(await loadRuntimeEvidence(path), evidence());
    await writeFile(path, '{not-json', 'utf8');
    await assert.rejects(() => loadRuntimeEvidence(path), /invalid runtime evidence JSON/);
    await writeFile(path, JSON.stringify(evidence()), 'utf8');
    await assert.rejects(() => loadRuntimeEvidence(path, { maxBytes: 1 }), /exceeds 1 bytes/);
    await assert.rejects(() => loadRuntimeEvidence(path, { maxBytes: 0 }), /positive safe integer/);
    const link = join(directory, 'evidence-link.json');
    await symlink(path, link);
    await assert.rejects(() => loadRuntimeEvidence(link), /regular non-symbolic-link file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
