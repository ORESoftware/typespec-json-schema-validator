import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNTIME_EVIDENCE_SCHEMA,
  compareRuntimeEvidence,
  loadRuntimeEvidence,
  validateRuntimeEvidence,
} from '../../src/runtime-conformance/index.mjs';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  CONTRACT_IR_SCHEMA,
  CONTRACT_IR_VERIFICATION_SCHEMA,
} from '../../src/contract-ir.mjs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const INPUT_DIGEST = 'a'.repeat(64);
const CORPUS_DIGEST = 'b'.repeat(64);
const RECEIPT_DIGEST = 'c'.repeat(64);
const TYPESPEC_DIGEST = 'd'.repeat(64);
const GENERATED_DIGEST = 'e'.repeat(64);
const AUTHORED_DIGEST = 'f'.repeat(64);
const cases = [
  { id: 'user.valid.basic', declaration: 'Example.User', expectation: 'accepted' },
  { id: 'user.invalid.missing-id', declaration: 'Example.User', expectation: 'rejected' },
];

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

function contractIrVerification(ir, overrides = {}) {
  return {
    schema: CONTRACT_IR_VERIFICATION_SCHEMA,
    status: 'passed',
    admissible: true,
    suppliedIrId: ir.irId,
    computedIrId: ir.irId,
    expectedIrId: ir.irId,
    receiptRunId: ir.admission?.receipt?.runId ?? null,
    error: null,
    ...overrides,
  };
}

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

const evidence = (overrides = {}) => {
  const ir = contractIr();
  return {
    schema: RUNTIME_EVIDENCE_SCHEMA,
    contractIrId: ir.irId,
    inputDigest: INPUT_DIGEST,
    corpusDigest: CORPUS_DIGEST,
    adapters: [adapter()],
    ...overrides,
  };
};

function compare(overrides = {}) {
  const ir = overrides.contractIr ?? contractIr();
  const verification = Object.hasOwn(overrides, 'contractIrVerification')
    ? overrides.contractIrVerification
    : contractIrVerification(ir);
  const runtimeEvidence = overrides.evidence
    ?? evidence({ contractIrId: ir.irId });
  return compareRuntimeEvidence({
    evidence: runtimeEvidence,
    contractIr: ir,
    contractIrVerification: verification,
    expectedInputDigest: INPUT_DIGEST,
    expectedCorpusDigest: CORPUS_DIGEST,
    expectedCases: cases,
    requiredAdapters: [{ id: 'typescript-zod', language: 'typescript', validator: 'zod@4.5.4' }],
    ...overrides,
    evidence: runtimeEvidence,
    contractIr: ir,
    contractIrVerification: verification,
  });
}

function ruleIds(result) {
  return result.findings.map((finding) => finding.ruleId);
}

test('passes exact-input evidence bound to a freshly verified Contract IR', () => {
  const result = compare();
  assert.equal(result.status, 'passed');
  assert.equal(result.zeroUnexplainedFindings, true);
  assert.equal(result.findingCount, 0);
  assert.equal(result.summary.expectedCases, 2);
  assert.equal(result.summary.passedAdapters, 1);
  assert.equal(result.contractIrVerified, true);
  assert.equal(result.contractIrId, contractIr().irId);
  assert.equal(result.receiptRunId, INPUT_DIGEST);
  assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.match(result.expectedCaseDigest, /^[a-f0-9]{64}$/);
});

test('normalization makes evidence and findings deterministic', () => {
  const ir = contractIr();
  const reordered = evidence({
    contractIrId: ir.irId,
    adapters: [adapter({ results: [...adapter().results].reverse() })],
  });
  const first = compare({ contractIr: ir });
  const second = compare({ contractIr: ir, evidence: reordered });
  assert.equal(first.evidenceDigest, second.evidenceDigest);
  assert.deepEqual(first.findings, second.findings);
});

test('fails closed when the evidence schema id is missing', () => {
  const result = compare({ evidence: evidence({ schema: undefined }) });
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(ruleIds(result).includes('runtime-evidence-schema-mismatch'));
});

test('requires runtime evidence to name the exact Contract IR', () => {
  const missing = compare({ evidence: evidence({ contractIrId: undefined }) });
  assert.ok(ruleIds(missing).includes('runtime-evidence-invalid-digest'));

  const mismatched = compare({ evidence: evidence({ contractIrId: '9'.repeat(64) }) });
  assert.ok(ruleIds(mismatched).includes('runtime-contract-ir-id-mismatch'));
});

test('rejects a tampered Contract IR self-digest', () => {
  const ir = contractIr();
  ir.declarations = [{ id: 'Example.User' }, { id: 'Example.Secret' }];
  const result = compare({ contractIr: ir });
  assert.ok(ruleIds(result).includes('runtime-contract-ir-self-digest-mismatch'));
  assert.equal(result.contractIrVerified, false);
});

test('rejects stopped or non-admissible Contract IR even with a valid self-digest', () => {
  const ir = contractIr({ status: 'stopped_for_evaluation', admissible: false });
  const result = compare({
    contractIr: ir,
    contractIrVerification: contractIrVerification(ir, {
      status: 'failed',
      admissible: false,
    }),
  });
  assert.ok(ruleIds(result).includes('runtime-contract-ir-not-admissible'));
  assert.ok(ruleIds(result).includes('runtime-contract-ir-verification-failed'));
});

test('requires a fresh Contract IR verification over the current inputs', () => {
  const missing = compare({ contractIrVerification: undefined });
  assert.ok(ruleIds(missing).includes('runtime-contract-ir-verification-missing'));

  const ir = contractIr();
  const stale = compare({
    contractIr: ir,
    contractIrVerification: contractIrVerification(ir, {
      expectedIrId: '9'.repeat(64),
      receiptRunId: '8'.repeat(64),
    }),
  });
  assert.ok(ruleIds(stale).includes('runtime-contract-ir-verification-failed'));
});

test('binds the Contract IR parity receipt to expectedInputDigest', () => {
  const wrongRun = '7'.repeat(64);
  const ir = contractIr({
    admission: {
      receipt: {
        schema: 'ores.typespec-json-schema-validator.report/v1',
        runId: wrongRun,
        digest: RECEIPT_DIGEST,
        status: 'passed',
        zeroUnexplainedFindings: true,
      },
    },
  });
  const result = compare({ contractIr: ir });
  assert.ok(ruleIds(result).includes('runtime-contract-ir-input-digest-mismatch'));
});

test('rejects missing or malformed Contract IR source-lane provenance', () => {
  const ir = contractIr({
    provenance: {
      typespec: { digest: 'not-a-digest' },
      generatedJsonSchema: { digest: GENERATED_DIGEST },
      authoredJsonSchema: { digest: AUTHORED_DIGEST },
    },
  });
  const result = compare({ contractIr: ir });
  assert.ok(ruleIds(result).includes('runtime-contract-ir-provenance-invalid'));
});

test('trusted cases may target only Contract IR-admitted declarations', () => {
  const otherCases = [
    { id: 'other.valid', declaration: 'Example.Other', expectation: 'accepted' },
  ];
  const result = compare({
    expectedCases: otherCases,
    evidence: evidence({
      adapters: [adapter({
        results: [{ caseId: 'other.valid', declaration: 'Example.Other', verdict: 'accepted' }],
      })],
    }),
  });
  assert.ok(ruleIds(result).includes('runtime-corpus-declaration-not-admitted'));
});

test('fails closed on stale authority input evidence', () => {
  const result = compare({ evidence: evidence({ inputDigest: 'c'.repeat(64) }) });
  assert.ok(ruleIds(result).includes('runtime-input-digest-mismatch'));
});

test('fails closed on stale corpus evidence', () => {
  const result = compare({ evidence: evidence({ corpusDigest: 'c'.repeat(64) }) });
  assert.ok(ruleIds(result).includes('runtime-corpus-digest-mismatch'));
});

test('rejects malformed digests rather than normalizing them', () => {
  const result = compare({
    evidence: evidence({ inputDigest: 'A'.repeat(64), corpusDigest: 'nope' }),
  });
  assert.equal(ruleIds(result).filter((rule) => rule === 'runtime-evidence-invalid-digest').length, 2);
});

test('rejects malformed trusted expected digests', () => {
  const result = compare({ expectedInputDigest: '', expectedCorpusDigest: null });
  assert.ok(ruleIds(result).includes('runtime-expected-input-digest-invalid'));
  assert.ok(ruleIds(result).includes('runtime-expected-corpus-digest-invalid'));
});

test('fails when a required adapter is missing', () => {
  const result = compare({
    requiredAdapters: ['rust-serde'],
  });
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
    contractIrId: contractIr().irId,
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
  const validation = validateRuntimeEvidence(evidence({
    adapters: [adapter(), adapter({ id: 'rust-serde' })],
  }), {
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

test('runtime evidence normalization discards untrusted stdout and arbitrary fields', () => {
  const validation = validateRuntimeEvidence(evidence({
    stdout: 'token-like output',
    adapters: [adapter({ stdout: 'more output', arbitrary: { secret: true } })],
  }));
  assert.equal('stdout' in validation.normalized, false);
  assert.equal('stdout' in validation.normalized.adapters[0], false);
  assert.equal('arbitrary' in validation.normalized.adapters[0], false);
});

test('Contract IR verification failures do not echo arbitrary error content', () => {
  const ir = contractIr();
  const result = compare({
    contractIr: ir,
    contractIrVerification: contractIrVerification(ir, {
      status: 'failed',
      admissible: false,
      error: 'secret-looking-path-or-value',
    }),
  });
  const rendered = JSON.stringify(result.findings);
  assert.ok(ruleIds(result).includes('runtime-contract-ir-verification-failed'));
  assert.doesNotMatch(rendered, /secret-looking-path-or-value/);
});

test('package exports publish the runtime API and evidence schema', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(packageJson.exports['./runtime-conformance'], {
    import: './src/runtime-conformance/index.mjs',
    types: './src/runtime-conformance/index.d.mts',
  });
  assert.equal(
    packageJson.exports['./schema/runtime-evidence'],
    './schema/runtime-evidence.schema.json',
  );
});

test('runtime evidence schema requires the Contract IR self-digest', async () => {
  const schema = JSON.parse(await readFile(
    new URL('../../schema/runtime-evidence.schema.json', import.meta.url),
    'utf8',
  ));
  assert.ok(schema.required.includes('contractIrId'));
  assert.deepEqual(schema.properties.contractIrId, { $ref: '#/$defs/sha256' });
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
