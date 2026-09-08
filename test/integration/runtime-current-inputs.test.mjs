import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  buildContractIr,
  canonicalStringify,
  runCheck,
  sha256,
} from '../../src/index.mjs';
import {
  RUNTIME_EVIDENCE_SCHEMA,
  verifyRuntimeEvidenceAgainstCurrentInputs,
} from '../../src/runtime-conformance/index.mjs';

const packageRoot = resolve(import.meta.dirname, '../..');
const fixtures = resolve(packageRoot, 'test/fixtures');
const sourceTypeSpec = resolve(fixtures, 'pass/main.tsp');
const sourceAuthoredSchema = resolve(fixtures, 'pass/authored.schema.json');

const expectedCases = Object.freeze([
  Object.freeze({
    id: 'user.valid.basic',
    declaration: 'Example.User',
    expectation: 'accepted',
  }),
  Object.freeze({
    id: 'user.invalid.missing-id',
    declaration: 'Example.User',
    expectation: 'rejected',
  }),
]);
const corpusDigest = sha256(canonicalStringify(expectedCases));

function runtimeEvidence(contractIr, parityReport) {
  return {
    schema: RUNTIME_EVIDENCE_SCHEMA,
    contractIrId: contractIr.irId,
    inputDigest: parityReport.runId,
    corpusDigest,
    adapters: [
      {
        id: 'typescript-zod',
        language: 'typescript',
        runtime: 'node@22.16.0',
        validator: 'zod@4.5.4',
        toolchain: 'typescript@7.0.2',
        status: 'passed',
        results: [
          {
            caseId: 'user.valid.basic',
            declaration: 'Example.User',
            verdict: 'accepted',
          },
          {
            caseId: 'user.invalid.missing-id',
            declaration: 'Example.User',
            verdict: 'rejected',
          },
        ],
      },
    ],
  };
}

async function parityArtifacts({ typespec = sourceTypeSpec, authoredSchema = sourceAuthoredSchema } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-current-input-runtime-'));
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
  assert.ok(contractIr.declarations.some((declaration) => declaration.id === 'Example.User'));
  return { directory, generatedSchema, parityReport, contractIr };
}

function ruleIds(report) {
  return report.findings.map((finding) => finding.ruleId);
}

test('preferred runtime API verifies the complete current-input parity chain', async () => {
  const artifacts = await parityArtifacts();
  try {
    const report = await verifyRuntimeEvidenceAgainstCurrentInputs({
      evidence: runtimeEvidence(artifacts.contractIr, artifacts.parityReport),
      contractIr: artifacts.contractIr,
      parityReport: artifacts.parityReport,
      typespec: sourceTypeSpec,
      generatedSchema: artifacts.generatedSchema,
      authoredSchema: sourceAuthoredSchema,
      expectedCorpusDigest: corpusDigest,
      expectedCases,
      requiredAdapters: [
        {
          id: 'typescript-zod',
          language: 'typescript',
          validator: 'zod@4.5.4',
        },
      ],
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.zeroUnexplainedFindings, true);
    assert.equal(report.contractIrVerified, true);
    assert.equal(report.contractIrId, artifacts.contractIr.irId);
    assert.equal(report.receiptRunId, artifacts.parityReport.runId);
    assert.deepEqual(report.findings, []);
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});

test('preferred runtime API rejects evidence after authored Schema A changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-current-input-stale-'));
  const authoredSchema = join(directory, 'authored.schema.json');
  await copyFile(sourceAuthoredSchema, authoredSchema);
  const artifacts = await parityArtifacts({ authoredSchema });
  try {
    const document = JSON.parse(await readFile(authoredSchema, 'utf8'));
    document.$defs.User.properties.displayName.maxLength = 120;
    await writeFile(authoredSchema, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    const report = await verifyRuntimeEvidenceAgainstCurrentInputs({
      evidence: runtimeEvidence(artifacts.contractIr, artifacts.parityReport),
      contractIr: artifacts.contractIr,
      parityReport: artifacts.parityReport,
      typespec: sourceTypeSpec,
      generatedSchema: artifacts.generatedSchema,
      authoredSchema,
      expectedCorpusDigest: corpusDigest,
      expectedCases,
      requiredAdapters: ['typescript-zod'],
    });

    assert.equal(report.status, 'stopped_for_evaluation');
    assert.equal(report.contractIrVerified, false);
    assert.ok(ruleIds(report).includes('runtime-contract-ir-verification-failed'));
    assert.doesNotMatch(JSON.stringify(report), /maxLength|120|tsjsv-current-input-stale/);
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('preferred runtime API fails closed when a current input cannot be loaded', async () => {
  const artifacts = await parityArtifacts();
  try {
    const missing = join(artifacts.directory, 'missing-authored.schema.json');
    const report = await verifyRuntimeEvidenceAgainstCurrentInputs({
      evidence: runtimeEvidence(artifacts.contractIr, artifacts.parityReport),
      contractIr: artifacts.contractIr,
      parityReport: artifacts.parityReport,
      typespec: sourceTypeSpec,
      generatedSchema: artifacts.generatedSchema,
      authoredSchema: missing,
      expectedCorpusDigest: corpusDigest,
      expectedCases,
      requiredAdapters: ['typescript-zod'],
    });

    assert.equal(report.status, 'stopped_for_evaluation');
    assert.equal(report.contractIrVerified, false);
    assert.ok(ruleIds(report).includes('runtime-contract-ir-verification-failed'));
    assert.doesNotMatch(JSON.stringify(report), /missing-authored\.schema\.json/);
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});
