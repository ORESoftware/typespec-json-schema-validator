import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  buildContractIr,
  runCheck,
} from '../../src/index.mjs';
import {
  createRuntimeEvidenceBindingAgainstCurrentInputs,
} from '../../src/runtime-conformance/index.mjs';

const packageRoot = resolve(import.meta.dirname, '../..');
const sourceTypeSpec = resolve(packageRoot, 'test/fixtures/pass/main.tsp');
const sourceAuthoredSchema = resolve(packageRoot, 'test/fixtures/pass/authored.schema.json');

async function createParityArtifacts({ authoredSchema = sourceAuthoredSchema } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-runtime-binding-'));
  const generatedSchema = join(directory, 'generated');
  const parityReport = await runCheck({
    typespec: sourceTypeSpec,
    authoredSchema,
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
    authoredSchema,
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

test('current-input binding derives exact minimal adapter receipt fields', async () => {
  const artifacts = await createParityArtifacts();
  try {
    const binding = await createRuntimeEvidenceBindingAgainstCurrentInputs({
      contractIr: artifacts.contractIr,
      parityReport: artifacts.parityReport,
      typespec: sourceTypeSpec,
      generatedSchema: artifacts.generatedSchema,
      authoredSchema: sourceAuthoredSchema,
    });

    assert.deepEqual(binding, {
      contractIrId: artifacts.contractIr.irId,
      inputDigest: artifacts.parityReport.runId,
    });
    assert.equal(Object.isFrozen(binding), true);
    assert.deepEqual(Object.keys(binding).sort(), ['contractIrId', 'inputDigest']);
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});

test('current-input binding rejects authored Schema A drift without disclosing it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-runtime-binding-drift-'));
  const authoredSchema = join(directory, 'authored.schema.json');
  await copyFile(sourceAuthoredSchema, authoredSchema);
  const artifacts = await createParityArtifacts({ authoredSchema });
  try {
    const document = JSON.parse(await readFile(authoredSchema, 'utf8'));
    document.$comment = 'secret-looking-drift-marker';
    await writeFile(authoredSchema, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    await assert.rejects(
      () => createRuntimeEvidenceBindingAgainstCurrentInputs({
        contractIr: artifacts.contractIr,
        parityReport: artifacts.parityReport,
        typespec: sourceTypeSpec,
        generatedSchema: artifacts.generatedSchema,
        authoredSchema,
      }),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.match(error.message, /runtime-contract-ir-verification-failed/);
        assert.doesNotMatch(error.message, /secret-looking-drift-marker/);
        assert.doesNotMatch(error.message, /runtime-binding-drift|authored\.schema\.json/);
        return true;
      },
    );
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('current-input binding rejects a missing source lane with safe diagnostics', async () => {
  const artifacts = await createParityArtifacts();
  try {
    await assert.rejects(
      () => createRuntimeEvidenceBindingAgainstCurrentInputs({
        contractIr: artifacts.contractIr,
        parityReport: artifacts.parityReport,
        typespec: sourceTypeSpec,
        generatedSchema: artifacts.generatedSchema,
        authoredSchema: join(artifacts.directory, 'missing-authority.json'),
      }),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.match(error.message, /runtime-contract-ir-verification-failed/);
        assert.doesNotMatch(error.message, /missing-authority\.json/);
        return true;
      },
    );
  } finally {
    await rm(artifacts.directory, { recursive: true, force: true });
  }
});
