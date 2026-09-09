import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { buildContractIr, runCheck } from '../../src/index.mjs';
import { verifyLanguageBoundariesAgainstCurrentInputs } from '../../src/language-boundary-current-inputs.mjs';

const packageRoot = resolve(import.meta.dirname, '../..');
const fixtures = resolve(packageRoot, 'test/fixtures');
const sourceTypeSpec = resolve(fixtures, 'pass/main.tsp');
const sourceAuthoredSchema = resolve(fixtures, 'pass/authored.schema.json');
const sourceRevision = 'c'.repeat(40);

async function loadManifest() {
  return JSON.parse(await readFile(
    resolve(packageRoot, 'examples/language-boundaries/manifest.json'),
    'utf8',
  ));
}

async function parityArtifacts() {
  const directory = await mkdtemp(join(tmpdir(), 'tjsv-five-runtime-current-inputs-'));
  const generatedSchema = join(directory, 'generated');
  const parityReport = await runCheck({
    typespec: sourceTypeSpec,
    authoredSchema: sourceAuthoredSchema,
    outputDir: generatedSchema,
    maxFindings: 250,
    maxProbes: 64,
  });
  assert.equal(parityReport.status, 'passed');
  assert.equal(parityReport.zeroUnexplainedFindings, true);

  const contractIr = await buildContractIr({
    report: parityReport,
    typespec: sourceTypeSpec,
    generatedSchema,
    authoredSchema: sourceAuthoredSchema,
  });
  assert.equal(contractIr.status, 'passed');
  assert.equal(contractIr.admissible, true);

  return {
    directory,
    generatedSchema,
    parityReport,
    contractIr,
  };
}

function runtimeEvidence(target, artifacts, index) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language: target.language,
    runtime: target.runtime,
    status: 'passed',
    sourceRevision,
    artifactDigest: `sha256:${String(index + 1).repeat(64)}`,
    receiptRunId: artifacts.parityReport.runId,
    contractIrId: artifacts.contractIr.irId,
    toolchain: { name: `${target.language}-${target.runtime}`, version: '1.0.0' },
    generator: { name: 'tjsv-five-runtime-example', version: '1.0.0' },
    validation: { ingress: 'passed', egress: 'passed' },
  };
}

async function boundaryInput(artifacts) {
  const manifest = await loadManifest();
  return {
    typespec: sourceTypeSpec,
    generatedSchema: artifacts.generatedSchema,
    authoredSchema: sourceAuthoredSchema,
    report: artifacts.parityReport,
    contractIr: artifacts.contractIr,
    manifest,
    evidenceByPath: new Map(manifest.targets.map((target, index) => [
      target.evidence,
      runtimeEvidence(target, artifacts, index),
    ])),
  };
}

function hasRule(result, ruleId) {
  return result.findings.some((finding) => finding.ruleId === ruleId);
}

test('preferred current-input API admits the complete five-runtime evidence set', async () => {
  const artifacts = await parityArtifacts();
  try {
    const input = await boundaryInput(artifacts);
    const result = await verifyLanguageBoundariesAgainstCurrentInputs(input);

    assert.equal(result.status, 'passed');
    assert.equal(result.zeroUnexplainedFindings, true);
    assert.equal(result.counts.targets, 5);
    assert.equal(result.counts.requiredTargets, 5);
    assert.equal(result.counts.distinctRequiredLanguages, 5);
    assert.equal(result.counts.admittedEvidence, 5);
    assert.deepEqual(result.findings, []);
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});

test('preferred current-input API rejects a stale source revision in one of five runtimes', async () => {
  const artifacts = await parityArtifacts();
  try {
    const input = await boundaryInput(artifacts);
    input.evidenceByPath.get('typescript/node.json').sourceRevision = 'd'.repeat(40);
    const result = await verifyLanguageBoundariesAgainstCurrentInputs(input);

    assert.equal(result.status, 'stopped_for_evaluation');
    assert.ok(hasRule(result, 'boundary-source-revision-mismatch'));
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});

test('preferred current-input API rejects exact parity-receipt and Contract-IR binding drift', async () => {
  const artifacts = await parityArtifacts();
  try {
    const receiptInput = await boundaryInput(artifacts);
    receiptInput.evidenceByPath.get('go/native.json').receiptRunId = '9'.repeat(64);
    const receiptResult = await verifyLanguageBoundariesAgainstCurrentInputs(receiptInput);
    assert.equal(receiptResult.status, 'stopped_for_evaluation');
    assert.ok(hasRule(receiptResult, 'boundary-evidence-receipt-mismatch'));

    const irInput = await boundaryInput(artifacts);
    irInput.evidenceByPath.get('gleam/beam.json').contractIrId = '8'.repeat(64);
    const irResult = await verifyLanguageBoundariesAgainstCurrentInputs(irInput);
    assert.equal(irResult.status, 'stopped_for_evaluation');
    assert.ok(hasRule(irResult, 'boundary-evidence-contract-ir-mismatch'));
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});

test('preferred current-input API requires every mandatory runtime and both validation directions', async () => {
  const artifacts = await parityArtifacts();
  try {
    const missingInput = await boundaryInput(artifacts);
    missingInput.evidenceByPath.delete('gleam/beam.json');
    const missingResult = await verifyLanguageBoundariesAgainstCurrentInputs(missingInput);
    assert.equal(missingResult.status, 'stopped_for_evaluation');
    assert.ok(hasRule(missingResult, 'boundary-required-evidence-missing'));
    assert.equal(missingResult.counts.admittedEvidence, 4);

    const ingressInput = await boundaryInput(artifacts);
    ingressInput.evidenceByPath.get('rust/native.json').validation.ingress = 'failed';
    const ingressResult = await verifyLanguageBoundariesAgainstCurrentInputs(ingressInput);
    assert.equal(ingressResult.status, 'stopped_for_evaluation');
    assert.ok(hasRule(ingressResult, 'boundary-ingress-not-verified'));

    const egressInput = await boundaryInput(artifacts);
    egressInput.evidenceByPath.get('dart/flutter.json').validation.egress = 'failed';
    const egressResult = await verifyLanguageBoundariesAgainstCurrentInputs(egressInput);
    assert.equal(egressResult.status, 'stopped_for_evaluation');
    assert.ok(hasRule(egressResult, 'boundary-egress-not-verified'));
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});
