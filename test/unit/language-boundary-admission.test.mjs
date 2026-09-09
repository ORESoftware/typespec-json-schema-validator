import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

const runId = 'a'.repeat(64);
const irId = 'b'.repeat(64);
const revision = 'c'.repeat(40);

function target(language, runtime, evidence, required = true) {
  return { language, runtime, required, ingress: true, egress: true, evidence };
}

function evidence(language, runtime) {
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
      differential: { summary: { divergences: 0 } },
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
      admission: {
        receipt: { runId },
        requirements: { differentialInstanceValidation: true },
      },
    },
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 2,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets: [rust, go],
    },
    evidenceByPath: new Map([
      [rust.evidence, evidence(rust.language, rust.runtime)],
      [go.evidence, evidence(go.language, go.runtime)],
    ]),
  };
}

test('two required runtimes with exact receipt and IR bindings pass deterministically', () => {
  const input = validInput();
  const first = verifyLanguageBoundaries(input);
  const second = verifyLanguageBoundaries(input);
  assert.equal(first.status, 'passed');
  assert.equal(first.zeroUnexplainedFindings, true);
  assert.equal(first.counts.requiredTargets, 2);
  assert.equal(first.counts.distinctRequiredLanguages, 2);
  assert.equal(first.counts.admittedEvidence, 2);
  assert.equal(first.counts.findings, 0);
  assert.equal(first.binding.parityReceiptRunId, runId);
  assert.equal(first.binding.contractIrId, irId);
  assert.equal(first.verificationId, second.verificationId);
});

test('duplicate target identities and evidence reuse fail closed', () => {
  const input = validInput();
  input.manifest.targets[1] = target('rust', 'native', 'rust/native.json');
  const result = verifyLanguageBoundaries(input);
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-target-duplicate'));
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-evidence-reused'));
  assert.equal(result.status, 'stopped_for_evaluation');
});

test('only required languages count toward the configured minimum', () => {
  const input = validInput();
  input.manifest.minimumDistinctLanguages = 3;
  input.manifest.targets.push(target('dart', 'flutter', 'dart/flutter.json', false));
  const result = verifyLanguageBoundaries(input);
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-required-language-count-insufficient'));
  assert.ok(!result.findings.some((entry) => entry.ruleId === 'boundary-required-evidence-missing' && entry.pointer.endsWith('/2/evidence')));
});

test('generated evidence can never promote itself into an authority', () => {
  const input = validInput();
  input.manifest.authorities.generatedWitness = 'peer';
  const result = verifyLanguageBoundaries(input);
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-authority-model-invalid'));
});

test('stale receipt and Contract IR identities are rejected even when status says passed', () => {
  const input = validInput();
  const stale = input.evidenceByPath.get('rust/native.json');
  stale.receiptRunId = 'e'.repeat(64);
  stale.contractIrId = 'f'.repeat(64);
  const result = verifyLanguageBoundaries(input);
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-evidence-receipt-mismatch'));
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-evidence-contract-ir-mismatch'));
});

test('a Contract IR tied to another parity receipt cannot admit runtime artifacts', () => {
  const input = validInput();
  input.contractIr.admission.receipt.runId = 'e'.repeat(64);
  const result = verifyLanguageBoundaries(input);
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-contract-ir-receipt-mismatch'));
});

test('disabled differential validation stops cross-runtime promotion', () => {
  const input = validInput();
  input.report.differential = { disabled: true };
  const result = verifyLanguageBoundaries(input);
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-differential-validation-disabled'));
});
