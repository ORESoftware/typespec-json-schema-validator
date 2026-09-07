import { canonicalStringify, sha256 } from '../canonical.mjs';
import {
  DIGEST_PATTERN,
  RUNTIME_CONFORMANCE_REPORT_SCHEMA,
  positiveSafeInteger,
} from './constants.mjs';
import {
  resolveTrustedRuntimeEvidenceContractBinding,
} from './contract-ir-binding.mjs';
import { makeRuntimeFinding, sortRuntimeFindings } from './findings.mjs';
import {
  normalizeExpectedCases,
  normalizeRequiredAdapters,
  validateRuntimeEvidence,
} from './normalize.mjs';

function compareAdapter(adapter, expectedById, findings) {
  if (adapter.status !== 'passed') {
    findings.push(makeRuntimeFinding({
      ruleId: adapter.status === 'failed' ? 'runtime-adapter-failed' : 'runtime-adapter-not-executed',
      pointer: `#/adapters/${adapter.id}/status`,
      message: `adapter ${adapter.id} did not provide passed runtime evidence`,
      left: adapter.status,
      right: 'passed',
    }));
  }

  const actualById = new Map(adapter.results.map((result) => [result.caseId, result]));
  for (const expected of expectedById.values()) {
    const actual = actualById.get(expected.id);
    if (!actual) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-case-missing',
        declaration: expected.declaration,
        pointer: `#/adapters/${adapter.id}/results`,
        message: `adapter ${adapter.id} did not execute required case ${expected.id}`,
        left: undefined,
        right: expected,
      }));
      continue;
    }
    if (actual.declaration !== expected.declaration) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-case-declaration-mismatch',
        declaration: expected.declaration,
        pointer: `#/adapters/${adapter.id}/results/${actual.caseId}/declaration`,
        message: `adapter ${adapter.id} case ${expected.id} is bound to the wrong declaration`,
        left: actual.declaration,
        right: expected.declaration,
      }));
    }
    if (actual.verdict === 'error') {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-case-error',
        declaration: expected.declaration,
        pointer: `#/adapters/${adapter.id}/results/${actual.caseId}/verdict`,
        message: `adapter ${adapter.id} errored while executing case ${expected.id}`,
        left: actual.verdict,
        right: expected.expectation,
      }));
    } else if (actual.verdict === 'skipped' || actual.verdict === 'unsupported') {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-case-not-executed',
        declaration: expected.declaration,
        pointer: `#/adapters/${adapter.id}/results/${actual.caseId}/verdict`,
        message: `adapter ${adapter.id} did not execute case ${expected.id}`,
        left: actual.verdict,
        right: expected.expectation,
      }));
    } else if (actual.verdict !== expected.expectation) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-case-verdict-mismatch',
        declaration: expected.declaration,
        pointer: `#/adapters/${adapter.id}/results/${actual.caseId}/verdict`,
        message: `adapter ${adapter.id} disagrees with the trusted expectation for case ${expected.id}`,
        left: actual.verdict,
        right: expected.expectation,
      }));
    }
  }
  for (const actual of adapter.results) {
    if (!expectedById.has(actual.caseId)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-case-extra',
        declaration: actual.declaration,
        pointer: `#/adapters/${adapter.id}/results/${actual.caseId}`,
        message: `adapter ${adapter.id} reported unknown case ${actual.caseId}`,
        left: actual,
        right: undefined,
      }));
    }
  }
}

function compareAdapters(adapters, expectedById, findings) {
  for (const expected of expectedById.values()) {
    const verdicts = new Map();
    for (const adapter of adapters) {
      const result = adapter.results.find((item) => item.caseId === expected.id);
      if (result && (result.verdict === 'accepted' || result.verdict === 'rejected')) {
        verdicts.set(adapter.id, result.verdict);
      }
    }
    if (new Set(verdicts.values()).size > 1) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-adapter-verdict-divergence',
        declaration: expected.declaration,
        pointer: `#/cases/${expected.id}`,
        message: `runtime adapters disagree on case ${expected.id}`,
        left: Object.fromEntries([...verdicts.entries()].sort(([left], [right]) => left.localeCompare(right))),
        right: expected.expectation,
      }));
    }
  }
}

function compareContractBinding(actual, expected, findings) {
  if (!actual || !expected) return;
  if (actual.schema !== expected.schema) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-contract-schema-mismatch',
      pointer: '#/contractIr/schema',
      message: 'runtime evidence targets a different Contract IR schema',
      left: actual.schema,
      right: expected.schema,
    }));
  }
  if (actual.irId !== expected.irId) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-contract-ir-id-mismatch',
      pointer: '#/contractIr/irId',
      message: 'runtime evidence was not produced from the exact verified Contract IR',
      left: actual.irId,
      right: expected.irId,
    }));
  }
  if (actual.parityReceipt.runId !== expected.parityReceipt.runId) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-parity-receipt-run-id-mismatch',
      pointer: '#/contractIr/parityReceipt/runId',
      message: 'runtime evidence targets a different parity receipt run',
      left: actual.parityReceipt.runId,
      right: expected.parityReceipt.runId,
    }));
  }
  if (actual.parityReceipt.digest !== expected.parityReceipt.digest) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-parity-receipt-digest-mismatch',
      pointer: '#/contractIr/parityReceipt/digest',
      message: 'runtime evidence targets a different canonical parity receipt',
      left: actual.parityReceipt.digest,
      right: expected.parityReceipt.digest,
    }));
  }
}

export function compareRuntimeEvidence({
  evidence,
  contractIr,
  contractIrVerification,
  expectedInputDigest,
  expectedCorpusDigest,
  expectedCases,
  requiredAdapters = [],
  maxFindings = 250,
  maxAdapters = 64,
  maxResultsPerAdapter = 100_000,
}) {
  maxFindings = positiveSafeInteger(maxFindings, 'maxFindings');
  maxAdapters = positiveSafeInteger(maxAdapters, 'maxAdapters');
  maxResultsPerAdapter = positiveSafeInteger(maxResultsPerAdapter, 'maxResultsPerAdapter');
  const findings = [];
  const trustedContractBinding = resolveTrustedRuntimeEvidenceContractBinding(
    { contractIr, contractIrVerification },
    findings,
  );
  const corpus = normalizeExpectedCases(expectedCases, findings);
  const required = normalizeRequiredAdapters(requiredAdapters, findings);
  const validated = validateRuntimeEvidence(evidence, { maxAdapters, maxResultsPerAdapter });
  findings.push(...validated.findings);

  if (!DIGEST_PATTERN.test(expectedInputDigest ?? '')) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-expected-input-digest-invalid',
      pointer: '#/expectedInputDigest',
      message: 'expectedInputDigest must be a lowercase SHA-256 digest from the trusted runtime input closure',
      left: expectedInputDigest,
      right: '64 lowercase hexadecimal characters',
    }));
  }
  if (!DIGEST_PATTERN.test(expectedCorpusDigest ?? '')) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-expected-corpus-digest-invalid',
      pointer: '#/expectedCorpusDigest',
      message: 'expectedCorpusDigest must be a lowercase SHA-256 digest from the trusted corpus loader',
      left: expectedCorpusDigest,
      right: '64 lowercase hexadecimal characters',
    }));
  }

  const normalized = validated.normalized;
  if (normalized) {
    compareContractBinding(normalized.contractIr, trustedContractBinding, findings);
    if (normalized.inputDigest !== expectedInputDigest) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-input-digest-mismatch',
        pointer: '#/inputDigest',
        message: 'runtime evidence is not bound to the requested generated-validator/configuration closure',
        left: normalized.inputDigest,
        right: expectedInputDigest,
      }));
    }
    if (normalized.corpusDigest !== expectedCorpusDigest) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-corpus-digest-mismatch',
        pointer: '#/corpusDigest',
        message: 'runtime evidence is not bound to the requested instance corpus',
        left: normalized.corpusDigest,
        right: expectedCorpusDigest,
      }));
    }

    const adaptersById = new Map(normalized.adapters.map((adapter) => [adapter.id, adapter]));
    for (const descriptor of required) {
      const adapter = adaptersById.get(descriptor.id);
      if (!adapter) {
        findings.push(makeRuntimeFinding({
          ruleId: 'runtime-required-adapter-missing',
          pointer: '#/adapters',
          message: `required runtime adapter ${descriptor.id} is missing`,
          left: undefined,
          right: descriptor,
        }));
        continue;
      }
      for (const field of ['language', 'validator']) {
        if (descriptor[field] !== undefined && adapter[field] !== descriptor[field]) {
          findings.push(makeRuntimeFinding({
            ruleId: 'runtime-required-adapter-identity-mismatch',
            pointer: `#/adapters/${adapter.id}/${field}`,
            message: `runtime adapter ${adapter.id} does not match the required ${field}`,
            left: adapter[field],
            right: descriptor[field],
          }));
        }
      }
    }

    const expectedById = new Map(corpus.map((item) => [item.id, item]));
    for (const adapter of normalized.adapters) compareAdapter(adapter, expectedById, findings);
    compareAdapters(normalized.adapters, expectedById, findings);
  }

  const findingCount = findings.length;
  const sorted = sortRuntimeFindings(findings).slice(0, maxFindings);
  const status = findingCount === 0 ? 'passed' : 'stopped_for_evaluation';
  return Object.freeze({
    schema: RUNTIME_CONFORMANCE_REPORT_SCHEMA,
    status,
    zeroUnexplainedFindings: findingCount === 0,
    findings: Object.freeze(sorted),
    findingCount,
    truncated: findingCount > maxFindings,
    evidenceDigest: normalized ? sha256(canonicalStringify(normalized)) : null,
    expectedCaseDigest: sha256(canonicalStringify(corpus)),
    contractIrId: trustedContractBinding?.irId ?? null,
    parityReceiptRunId: trustedContractBinding?.parityReceipt.runId ?? null,
    parityReceiptDigest: trustedContractBinding?.parityReceipt.digest ?? null,
    summary: Object.freeze({
      expectedCases: corpus.length,
      requiredAdapters: required.length,
      observedAdapters: normalized?.adapters.length ?? 0,
      passedAdapters: normalized?.adapters.filter((adapter) => adapter.status === 'passed').length ?? 0,
      contractBindingVerified: trustedContractBinding !== null,
    }),
  });
}
