import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { buildContractIr, runCheck } from '../../src/index.mjs';
import { verifyLanguageBoundariesAgainstCurrentInputs } from '../../src/language-boundary-current-inputs.mjs';

const packageRoot = resolve(import.meta.dirname, '../..');
const fixtures = resolve(packageRoot, 'test/fixtures');
const sourceTypeSpec = resolve(fixtures, 'pass/main.tsp');
const sourceAuthoredSchema = resolve(fixtures, 'pass/authored.schema.json');
const sourceRevision = '3'.repeat(40);

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

function evidence(language, runtime, artifacts) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language,
    runtime,
    status: 'passed',
    sourceRevision,
    artifactDigest: `sha256:${'4'.repeat(64)}`,
    receiptRunId: artifacts.parityReport.runId,
    contractIrId: artifacts.contractIr.irId,
    toolchain: { name: `${language}-${runtime}`, version: '1.0.0' },
    generator: { name: 'api-docs', version: '1.0.0' },
    validation: { ingress: 'passed', egress: 'passed' },
  };
}

function boundaryInput(artifacts, overrides = {}) {
  const targets = [
    target('rust', 'native'),
    target('typescript', 'node'),
    target('dart', 'flutter'),
  ];
  return {
    typespec: artifacts.typespec ?? sourceTypeSpec,
    generatedSchema: artifacts.generatedSchema,
    authoredSchema: artifacts.authoredSchema,
    report: artifacts.parityReport,
    contractIr: artifacts.contractIr,
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 3,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets,
    },
    evidenceByPath: new Map(targets.map((entry) => [
      entry.evidence,
      evidence(entry.language, entry.runtime, artifacts),
    ])),
    ...overrides,
  };
}

async function parityArtifacts({ typespec = sourceTypeSpec, authoredSchema = sourceAuthoredSchema } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-language-current-inputs-'));
  const generatedSchema = join(directory, 'generated');
  const parityReport = await runCheck({
    typespec,
    authoredSchema,
    outputDir: generatedSchema,
    maxFindings: 250,
    maxProbes: 64,
  });
  assert.equal(parityReport.status, 'passed');
  const contractIr = await buildContractIr({
    report: parityReport,
    typespec,
    generatedSchema,
    authoredSchema,
  });
  assert.equal(contractIr.status, 'passed');
  assert.equal(contractIr.admissible, true);
  return { directory, typespec, generatedSchema, authoredSchema, parityReport, contractIr };
}

function ruleIds(result) {
  return result.findings.map((finding) => finding.ruleId);
}

test('preferred language boundary API verifies the complete current-input chain before runtime evidence', async () => {
  const artifacts = await parityArtifacts();
  try {
    const result = await verifyLanguageBoundariesAgainstCurrentInputs(boundaryInput(artifacts));
    assert.equal(result.status, 'passed');
    assert.equal(result.zeroUnexplainedFindings, true);
    assert.equal(result.counts.requiredTargets, 3);
    assert.equal(result.counts.admittedEvidence, 3);
    assert.deepEqual(result.findings, []);
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});

test('preferred language boundary API rejects a stale authored authority without leaking source data or paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-language-current-stale-'));
  const authoredSchema = join(directory, 'authored.schema.json');
  await copyFile(sourceAuthoredSchema, authoredSchema);
  const artifacts = await parityArtifacts({ authoredSchema });
  try {
    const document = JSON.parse(await readFile(authoredSchema, 'utf8'));
    document.$comment = 'do-not-leak-current-input-marker';
    await writeFile(authoredSchema, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    const result = await verifyLanguageBoundariesAgainstCurrentInputs(boundaryInput(artifacts, { authoredSchema }));
    assert.equal(result.status, 'stopped_for_evaluation');
    assert.equal(result.counts.admittedEvidence, 0);
    assert.ok(ruleIds(result).includes('boundary-current-contract-ir-verification-failed'));
    assert.doesNotMatch(JSON.stringify(result), /do-not-leak-current-input-marker|authored\.schema\.json/);
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('preferred language boundary API rejects byte-stale TypeSpec authority before runtime admission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-language-current-typespec-stale-'));
  const typespec = join(directory, 'main.tsp');
  await copyFile(sourceTypeSpec, typespec);
  const artifacts = await parityArtifacts({ typespec });
  try {
    const source = await readFile(typespec, 'utf8');
    await writeFile(typespec, `${source}\n// do-not-leak-typespec-current-input-marker\n`, 'utf8');

    const result = await verifyLanguageBoundariesAgainstCurrentInputs(boundaryInput(artifacts));
    assert.equal(result.status, 'stopped_for_evaluation');
    assert.equal(result.counts.admittedEvidence, 0);
    assert.ok(ruleIds(result).includes('boundary-current-contract-ir-verification-failed'));
    assert.doesNotMatch(JSON.stringify(result), /do-not-leak-typespec-current-input-marker|main\.tsp/);
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('preferred language boundary API rejects byte-stale generated Schema B before runtime admission', async () => {
  const artifacts = await parityArtifacts();
  try {
    const generatedFiles = (await readdir(artifacts.generatedSchema, { recursive: true }))
      .filter((entry) => entry.endsWith('.json'))
      .sort();
    assert.ok(generatedFiles.length > 0, 'expected compiler-backed generated JSON Schema output');

    const generatedFile = join(artifacts.generatedSchema, generatedFiles[0]);
    const document = JSON.parse(await readFile(generatedFile, 'utf8'));
    document.$comment = 'do-not-leak-generated-schema-current-input-marker';
    await writeFile(generatedFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    const result = await verifyLanguageBoundariesAgainstCurrentInputs(boundaryInput(artifacts));
    assert.equal(result.status, 'stopped_for_evaluation');
    assert.equal(result.counts.admittedEvidence, 0);
    assert.ok(ruleIds(result).includes('boundary-current-contract-ir-verification-failed'));
    assert.doesNotMatch(JSON.stringify(result), /do-not-leak-generated-schema-current-input-marker/);
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});

test('preferred language boundary API rejects a forged retained report before runtime admission', async () => {
  const artifacts = await parityArtifacts();
  try {
    const forged = structuredClone(artifacts.parityReport);
    forged.inputs.authoredJsonSchema.digest = 'f'.repeat(64);
    forged.status = 'passed';
    const result = await verifyLanguageBoundariesAgainstCurrentInputs(boundaryInput(artifacts, { report: forged }));
    assert.equal(result.status, 'stopped_for_evaluation');
    assert.equal(result.counts.admittedEvidence, 0);
    assert.ok(ruleIds(result).includes('boundary-current-contract-ir-verification-failed'));
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});

test('preferred language boundary API rejects tampered Contract IR identity before runtime admission', async () => {
  const artifacts = await parityArtifacts();
  try {
    const tampered = { ...artifacts.contractIr, irId: 'e'.repeat(64) };
    const result = await verifyLanguageBoundariesAgainstCurrentInputs(boundaryInput(artifacts, { contractIr: tampered }));
    assert.equal(result.status, 'stopped_for_evaluation');
    assert.equal(result.counts.admittedEvidence, 0);
    assert.ok(ruleIds(result).includes('boundary-current-contract-ir-verification-failed'));
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});

test('preferred language boundary API delegates runtime receipt/IR mismatch semantics to the pure verifier', async () => {
  const artifacts = await parityArtifacts();
  try {
    const input = boundaryInput(artifacts);
    input.evidenceByPath.get('typescript/node.json').receiptRunId = '9'.repeat(64);
    const result = await verifyLanguageBoundariesAgainstCurrentInputs(input);
    assert.equal(result.status, 'stopped_for_evaluation');
    assert.ok(ruleIds(result).includes('boundary-evidence-receipt-mismatch'));
    assert.ok(!ruleIds(result).includes('boundary-current-contract-ir-verification-failed'));
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});
