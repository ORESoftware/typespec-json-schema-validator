import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

const runId = 'a'.repeat(64);
const irId = 'b'.repeat(64);
const revision = 'c'.repeat(40);

async function loadManifest() {
  return JSON.parse(await readFile(
    new URL('../../examples/language-boundaries/manifest.json', import.meta.url),
    'utf8',
  ));
}

async function loadManifestSchema() {
  return JSON.parse(await readFile(
    new URL('../../schema/language-boundaries.schema.json', import.meta.url),
    'utf8',
  ));
}

function parityReport() {
  return {
    schema: 'ores.typespec-json-schema-validator.report/v1',
    runId,
    status: 'passed',
    zeroUnexplainedFindings: true,
    findings: [],
    authorities: {
      typespec: {
        authority: 'independently-authored',
        generatedJsonSchemaRole: 'comparison-evidence-only',
      },
      jsonSchema: { authority: 'independently-authored' },
      precedence: 'none',
    },
    coverage: { differentialInstanceValidation: true },
    differential: {
      summary: { probesEvaluated: 25, divergences: 0, refusals: 0 },
    },
  };
}

function contractIr() {
  return {
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
    declarations: [{ id: 'Example.CrossRuntimeContract' }],
    excludedDeclarations: [],
    outOfScopeDeclarations: [],
    admission: {
      receipt: { runId },
      requirements: { differentialInstanceValidation: true },
    },
  };
}

function runtimeEvidence(target, digestNibble) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language: target.language,
    runtime: target.runtime,
    status: 'passed',
    sourceRevision: revision,
    artifactDigest: `sha256:${digestNibble.repeat(64)}`,
    receiptRunId: runId,
    contractIrId: irId,
    toolchain: { name: `${target.language}-toolchain`, version: '1.0.0' },
    generator: { name: 'api-docs', version: '1.0.0' },
    validation: { ingress: 'passed', egress: 'passed' },
  };
}

function evidenceMap(manifest) {
  const digestNibbles = ['1', '2', '3', '4', '5'];
  return new Map(manifest.targets.map((target, index) => [
    target.evidence,
    runtimeEvidence(target, digestNibbles[index]),
  ]));
}

async function validInput() {
  const manifest = await loadManifest();
  return {
    report: parityReport(),
    contractIr: contractIr(),
    manifest,
    evidenceByPath: evidenceMap(manifest),
  };
}

test('five-runtime manifest validates against the published Draft 2020-12 boundary contract', async () => {
  const manifest = await loadManifest();
  const schema = await loadManifestSchema();
  const resolver = new SchemaResolver();
  const record = resolver.addDocument(schema, 'language-boundaries.schema.json');
  const result = validateInstance({ schema, instance: manifest, resolver, base: record.base });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(manifest.minimumDistinctLanguages, 5);
  assert.deepEqual(manifest.targets.map(({ language, runtime }) => `${language}/${runtime}`), [
    'rust/native',
    'typescript/node',
    'dart/flutter',
    'go/native',
    'gleam/beam',
  ]);
});

test('five required languages pass only with exact TJSV parity, Contract IR, and runtime bindings', async () => {
  const input = await validInput();
  const result = verifyLanguageBoundaries(input);

  assert.equal(result.status, 'passed');
  assert.equal(result.zeroUnexplainedFindings, true);
  assert.equal(result.counts.targets, 5);
  assert.equal(result.counts.requiredTargets, 5);
  assert.equal(result.counts.distinctRequiredLanguages, 5);
  assert.equal(result.counts.admittedEvidence, 5);
  assert.equal(result.counts.findings, 0);
  assert.equal(result.binding.parityReceiptRunId, runId);
  assert.equal(result.binding.contractIrId, irId);
  assert.equal(result.binding.typeSpecAuthority, 'peer');
  assert.equal(result.binding.jsonSchemaAuthority, 'peer');
  assert.equal(result.binding.generatedWitnessRole, 'evidence_only');
});

test('one runtime built from another source revision stops five-runtime promotion', async () => {
  const input = await validInput();
  input.evidenceByPath.get('go/native.json').sourceRevision = 'd'.repeat(40);
  const result = verifyLanguageBoundaries(input);

  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((finding) => finding.ruleId === 'boundary-source-revision-mismatch'));
});

test('missing one required runtime receipt cannot be hidden by four passing runtimes', async () => {
  const input = await validInput();
  input.evidenceByPath.delete('gleam/beam.json');
  const result = verifyLanguageBoundaries(input);

  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((finding) => finding.ruleId === 'boundary-required-evidence-missing'));
  assert.equal(result.counts.admittedEvidence, 4);
});

test('symbolic source labels are rejected as immutable cross-runtime evidence', async () => {
  const input = await validInput();
  input.evidenceByPath.get('typescript/node.json').sourceRevision = 'main';
  const result = verifyLanguageBoundaries(input);

  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((finding) => finding.ruleId === 'boundary-source-revision-invalid'));
});
