import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

const runId = '1'.repeat(64);
const irId = '2'.repeat(64);
const revision = '3'.repeat(40);

function target(language, runtime, required = true) {
  return {
    language,
    runtime,
    required,
    ingress: true,
    egress: true,
    evidence: `${language}/${runtime}.json`,
  };
}

function evidence(language, runtime) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language,
    runtime,
    status: 'passed',
    sourceRevision: revision,
    artifactDigest: `sha256:${'4'.repeat(64)}`,
    receiptRunId: runId,
    contractIrId: irId,
    toolchain: { name: `${language}-${runtime}`, version: '1.0.0' },
    generator: { name: 'api-docs', version: '1.0.0' },
    validation: { ingress: 'passed', egress: 'passed' },
  };
}

function input() {
  const targets = [
    target('rust', 'native'),
    target('typescript', 'node'),
    target('dart', 'flutter'),
  ];
  return {
    report: {
      schema: 'ores.typespec-json-schema-validator.report/v1',
      runId,
      status: 'passed',
      zeroUnexplainedFindings: true,
      findings: [],
      coverage: { differentialInstanceValidation: true },
      differential: {
        summary: { probesEvaluated: 2, divergences: 0, refusals: 0 },
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
      declarations: [
        { id: 'Ores.LambdaRuntimeFixture.Provider' },
        { id: 'Ores.LambdaRuntimeFixture.Operation' },
        { id: 'Ores.LambdaRuntimeFixture.LambdaCommand' },
      ],
      excludedDeclarations: [],
      outOfScopeDeclarations: [],
      admission: {
        receipt: { runId },
        requirements: { differentialInstanceValidation: true },
      },
    },
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 3,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets,
    },
    evidenceByPath: new Map(targets.map((entry) => [entry.evidence, evidence(entry.language, entry.runtime)])),
  };
}

test('lambda contracts can require Rust, TypeScript/Node, and Dart/Flutter evidence together', () => {
  const result = verifyLanguageBoundaries(input());
  assert.equal(result.status, 'passed');
  assert.equal(result.zeroUnexplainedFindings, true);
  assert.equal(result.counts.requiredTargets, 3);
  assert.equal(result.counts.distinctRequiredLanguages, 3);
  assert.equal(result.counts.admittedEvidence, 3);
  assert.equal(result.counts.findings, 0);
});

test('missing Dart/Flutter lambda evidence stops cross-runtime promotion', () => {
  const value = input();
  value.evidenceByPath.delete('dart/flutter.json');
  const result = verifyLanguageBoundaries(value);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.zeroUnexplainedFindings, false);
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-required-evidence-missing'));
});

test('stale TypeScript/Node lambda evidence cannot claim the current Contract IR', () => {
  const value = input();
  value.evidenceByPath.get('typescript/node.json').contractIrId = '5'.repeat(64);
  const result = verifyLanguageBoundaries(value);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-evidence-contract-ir-mismatch'));
});

test('required Lambda runtime evidence from different source revisions cannot be combined', () => {
  const value = input();
  value.evidenceByPath.get('dart/flutter.json').sourceRevision = '6'.repeat(40);
  const result = verifyLanguageBoundaries(value);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.zeroUnexplainedFindings, false);
  assert.equal(result.counts.admittedEvidence, 2);
  assert.ok(result.findings.some((entry) => (
    entry.ruleId === 'boundary-source-revision-mismatch'
      && entry.pointer === '#/evidence/2/sourceRevision'
  )));
});

test('supplied optional Lambda evidence must use the same source revision as required runtimes', () => {
  const value = input();
  const optional = target('go', 'native', false);
  const optionalEvidence = evidence(optional.language, optional.runtime);
  optionalEvidence.sourceRevision = '7'.repeat(40);
  value.manifest.targets.push(optional);
  value.evidenceByPath.set(optional.evidence, optionalEvidence);

  const result = verifyLanguageBoundaries(value);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.counts.requiredTargets, 3);
  assert.equal(result.counts.admittedEvidence, 3);
  assert.ok(result.findings.some((entry) => (
    entry.ruleId === 'boundary-source-revision-mismatch'
      && entry.pointer === '#/evidence/3/sourceRevision'
  )));
});
