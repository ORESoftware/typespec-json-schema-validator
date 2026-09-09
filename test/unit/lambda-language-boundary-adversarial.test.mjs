import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

const runId = '1'.repeat(64);
const irId = '2'.repeat(64);
const revision = '3'.repeat(40);

function target(language, runtime) {
  return {
    language,
    runtime,
    required: true,
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

function validInput() {
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
      differential: { summary: { probesEvaluated: 8, divergences: 0, refusals: 0 } },
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
      declarations: [{ id: 'Provider' }, { id: 'Operation' }, { id: 'LambdaCommand' }],
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

function rules(result) {
  return new Set(result.findings.map(({ ruleId }) => ruleId));
}

const attacks = [
  ['unsupported evidence schema', (value) => { value.schema = 'ores.invalid/v1'; }, 'boundary-evidence-schema-invalid'],
  ['non-passed evidence status', (value) => { value.status = 'partial'; }, 'boundary-evidence-not-passed'],
  ['runtime identity substitution', (value) => { value.runtime = 'wasm'; }, 'boundary-evidence-target-mismatch'],
  ['uppercase source revision', (value) => { value.sourceRevision = 'A'.repeat(40); }, 'boundary-source-revision-invalid'],
  ['uppercase artifact digest', (value) => { value.artifactDigest = `sha256:${'A'.repeat(64)}`; }, 'boundary-artifact-digest-invalid'],
  ['blank toolchain version', (value) => { value.toolchain.version = ' '; }, 'boundary-toolchain-identity-missing'],
  ['control character in generator name', (value) => { value.generator.name = 'api\ndocs'; }, 'boundary-generator-identity-missing'],
  ['skipped ingress validation', (value) => { value.validation.ingress = 'skipped'; }, 'boundary-ingress-not-verified'],
  ['skipped egress validation', (value) => { value.validation.egress = 'skipped'; }, 'boundary-egress-not-verified'],
  ['stale parity receipt binding', (value) => { value.receiptRunId = '5'.repeat(64); }, 'boundary-evidence-receipt-mismatch'],
  ['stale Contract IR binding', (value) => { value.contractIrId = '6'.repeat(64); }, 'boundary-evidence-contract-ir-mismatch'],
];

for (const [name, mutate, expectedRule] of attacks) {
  test(`lambda runtime evidence fails closed for ${name}`, () => {
    const input = validInput();
    const rustEvidence = input.evidenceByPath.get('rust/native.json');
    mutate(rustEvidence);

    const result = verifyLanguageBoundaries(input);
    assert.equal(result.status, 'stopped_for_evaluation');
    assert.equal(result.zeroUnexplainedFindings, false);
    assert.equal(result.counts.admittedEvidence, 2);
    assert.ok(rules(result).has(expectedRule), `${expectedRule} missing from ${[...rules(result)].join(', ')}`);
  });
}

test('lambda runtime evidence remains admissible only when all three runtime envelopes are current and exact', () => {
  const result = verifyLanguageBoundaries(validInput());
  assert.equal(result.status, 'passed');
  assert.equal(result.zeroUnexplainedFindings, true);
  assert.equal(result.counts.requiredTargets, 3);
  assert.equal(result.counts.distinctRequiredLanguages, 3);
  assert.equal(result.counts.admittedEvidence, 3);
  assert.equal(result.counts.findings, 0);
});
