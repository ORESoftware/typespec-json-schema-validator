import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

const runId = 'a'.repeat(64);
const irId = 'b'.repeat(64);
const revision = 'c'.repeat(40);

function target(language, runtime, evidencePath, required = true) {
  return {
    language,
    runtime,
    required,
    ingress: true,
    egress: true,
    evidence: evidencePath,
  };
}

function evidence(language, runtime, overrides = {}) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language,
    runtime,
    status: 'passed',
    sourceRevision: revision,
    artifactDigest: `sha256:${'d'.repeat(64)}`,
    receiptRunId: runId,
    contractIrId: irId,
    toolchain: { name: `${language}-toolchain`, version: '1.0.0' },
    generator: { name: 'api-docs', version: '1.0.0' },
    validation: { ingress: 'passed', egress: 'passed' },
    ...overrides,
  };
}

function validInput() {
  const rust = target('rust', 'native', 'rust/native.json');
  const go = target('go', 'native', 'go/native.json');
  return {
    report: {
      schema: 'ores.typespec-json-schema-validator.report/v1',
      runId,
      status: 'passed',
      zeroUnexplainedFindings: true,
      findings: [],
      coverage: { differentialInstanceValidation: true },
      differential: {
        summary: { probesEvaluated: 10, divergences: 0, refusals: 0 },
      },
    },
    contractIr: {
      schema: 'ores.typespec-json-schema-validator.contract-ir/v1',
      irId,
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
      declarations: [{ id: 'Domain.Item' }],
      excludedDeclarations: [],
      outOfScopeDeclarations: [],
      admission: {
        receipt: { runId },
        requirements: { differentialInstanceValidation: true },
      },
    },
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 2,
      authorities: {
        typeSpec: 'peer',
        jsonSchema: 'peer',
        generatedWitness: 'evidence_only',
      },
      targets: [rust, go],
    },
    evidenceByPath: new Map([
      [rust.evidence, evidence(rust.language, rust.runtime)],
      [go.evidence, evidence(go.language, go.runtime)],
    ]),
  };
}

function rules(result) {
  return new Set(result.findings.map(({ ruleId }) => ruleId));
}

test('exact complete evidence passes and deep receipt surfaces are frozen', () => {
  const result = verifyLanguageBoundaries(validInput());
  assert.equal(result.status, 'passed');
  assert.equal(result.counts.admittedEvidence, 2);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.binding));
  assert.ok(Object.isFrozen(result.counts));
  assert.ok(Object.isFrozen(result.findings));
});

test('zero probes, missing coverage, divergence, and refusal all stop admission', () => {
  for (const change of [
    (input) => { input.report.differential.summary.probesEvaluated = 0; },
    (input) => { delete input.report.coverage; },
    (input) => { input.report.differential.summary.divergences = 1; },
    (input) => { input.report.differential.summary.refusals = 1; },
  ]) {
    const input = validInput();
    change(input);
    const result = verifyLanguageBoundaries(input);
    assert.equal(result.status, 'stopped_for_evaluation');
    assert.equal(result.counts.admittedEvidence, 0);
    assert.ok(
      rules(result).has('boundary-differential-evidence-incomplete')
      || rules(result).has('boundary-differential-evidence-not-converged'),
    );
  }
});

test('invalid evidence is not reported as admitted', () => {
  const input = validInput();
  input.evidenceByPath.get('rust/native.json').status = 'failed';
  const result = verifyLanguageBoundaries(input);
  assert.equal(result.counts.admittedEvidence, 1);
  assert.ok(rules(result).has('boundary-evidence-not-passed'));
});

test('sparse target arrays fail closed without reading inherited entries', () => {
  const input = validInput();
  const targets = new Array(2);
  targets[1] = input.manifest.targets[1];
  input.manifest.targets = targets;
  const result = verifyLanguageBoundaries(input);
  assert.equal(result.counts.targets, 0);
  assert.ok(rules(result).has('boundary-target-inventory-sparse'));
});

test('partial Contract IR scope cannot authorize runtime promotion', () => {
  for (const change of [
    (input) => { input.contractIr.declarations = []; },
    (input) => { input.contractIr.excludedDeclarations = [{ id: 'Excluded' }]; },
    (input) => { input.contractIr.outOfScopeDeclarations = [{ id: 'Operation' }]; },
  ]) {
    const input = validInput();
    change(input);
    const result = verifyLanguageBoundaries(input);
    assert.equal(result.status, 'stopped_for_evaluation');
    assert.equal(result.counts.admittedEvidence, 0);
  }
});
