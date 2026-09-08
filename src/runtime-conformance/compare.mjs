import { canonicalStringify, sha256 } from '../canonical.mjs';
import {
  DIGEST_PATTERN,
  RUNTIME_EVIDENCE_SCHEMA,
  positiveSafeInteger,
} from './constants.mjs';
import { validateContractIrBinding } from './contract-ir-binding.mjs';
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

function compareCorpusToContractIr(corpus, binding, findings) {
  if (!binding.verified) return;
  for (let index = 0; index < corpus.length; index += 1) {
    const expected = corpus[index];
    if (!binding.declarationIds.has(expected.declaration)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-corpus-declaration-not-admitted',
        declaration: expected.declaration,
        pointer: `#/expectedCases/${index}/declaration`,
        message: `trusted runtime case ${expected.id} targets a declaration not admitted by Contract IR`,
        left: expected.declaration,
        right: 'an admitted Contract IR declaration id',
      }));
    }
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
  const corpus = normalizeExpectedCases(expectedCases, findings);
  const required = normalizeRequiredAdapters(requiredAdapters, findings);
  const validated = validateRuntimeEvidence(evidence, { maxAdapters, maxResultsPerAdapter });
  findings.push(...validated.findings);

  if (!DIGEST_PATTERN.test(expectedInputDigest ?? '')) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-expected-input-digest-invalid',
      pointer: '#/expectedInputDigest',
      message: 'expectedInputDigest must be the lowercase SHA-256 runId from the trusted parity receipt',
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

  const binding = validateContractIrBinding({
    contractIr,
    contractIrVerification,
    expectedInputDigest,
    findings,
  });
  compareCorpusToContractIr(corpus, binding, findings);

  const normalized = validated.normalized;
  if (normalized) {
    if (binding.irId && normalized.contractIrId !== binding.irId) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-contract-ir-id-mismatch',
        pointer: '#/contractIrId',
        message: 'runtime evidence was emitted for a different Contract IR',
        left: normalized.contractIrId,
        right: binding.irId,
      }));
    }
    if (normalized.inputDigest !== expectedInputDigest) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-input-digest-mismatch',
        pointer: '#/inputDigest',
        message: 'runtime evidence is not bound to the requested parity receipt and authority/configuration closure',
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
    schema: RUNTIME_EVIDENCE_SCHEMA,
    status,
    zeroUnexplainedFindings: findingCount === 0,
    findings: Object.freeze(sorted),
    findingCount,
    truncated: findingCount > maxFindings,
    contractIrId: binding.irId,
    contractIrVerified: binding.verified,
    receiptRunId: binding.receiptRunId,
    evidenceDigest: normalized ? sha256(canonicalStringify(normalized)) : null,
    expectedCaseDigest: sha256(canonicalStringify(corpus)),
    summary: Object.freeze({
      expectedCases: corpus.length,
      requiredAdapters: required.length,
      observedAdapters: normalized?.adapters.length ?? 0,
      passedAdapters: normalized?.adapters.filter((adapter) => adapter.status === 'passed').length ?? 0,
    }),
  });
}
