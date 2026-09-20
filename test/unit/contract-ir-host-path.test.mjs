import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildContractIr } from '../../src/contract-ir.mjs';
import { runCheck } from '../../src/run.mjs';

const fixtures = resolve(import.meta.dirname, '../fixtures');

test('Contract IR identity excludes host-only receipt diagnostics', async () => {
  const fixture = resolve(fixtures, 'pass');
  const typespec = resolve(fixture, 'main.tsp');
  const authoredSchema = resolve(fixture, 'authored.schema.json');
  const tspBin = resolve(import.meta.dirname, '../helpers/fake-tsp.mjs');
  const outputDir = await mkdtemp(join(tmpdir(), 'tjsv-contract-ir-host-'));
  const report = await runCheck({
    typespec, authoredSchema, outputDir,
    bundleId: 'typespec.generated.schema.json',
    maxFindings: 250, tspBin, int64Strategy: 'string',
    sealObjectSchemas: true, polymorphicModelsStrategy: 'oneOf',
  });
  assert.equal(report.status, 'passed');
  const generatedSchema = report.inputs.generatedJsonSchema.input;
  const linux = await buildContractIr({ report, typespec, generatedSchema, authoredSchema });

  const macReport = structuredClone(report);
  macReport.configuration.emitterOptions['emitter-output-dir'] = '/Users/runner/work/_temp/witness';
  macReport.configuration.executionMode = 'pinned-compiler-fallback';
  if (macReport.configuration.differential) {
    macReport.configuration.differential.instanceCorpus = '/Users/runner/work/_temp/instances';
  }
  if (macReport.toolchain?.typespecCompiler) {
    macReport.toolchain.typespecCompiler.command = '/Users/runner/work/repo/node_modules/@typespec/compiler/cmd/tsp.js';
  }
  const mac = await buildContractIr({ report: macReport, typespec, generatedSchema, authoredSchema });

  assert.equal(macReport.runId, report.runId, 'diagnostic mutation must not forge a new semantic receipt');
  assert.equal(linux.irId, mac.irId, 'Contract IR must not inherit host paths or execution mechanism');
  assert.deepEqual(linux.toolchain, mac.toolchain);
  assert.deepEqual(linux.configuration, mac.configuration);
  assert.equal(linux.admission.receipt.digest, mac.admission.receipt.digest);

  const semantic = structuredClone(report);
  semantic.configuration.emitterOptions['seal-object-schemas'] = 'false';
  const changed = await buildContractIr({ report: semantic, typespec, generatedSchema, authoredSchema });
  assert.notEqual(linux.irId, changed.irId, 'semantic emitter options remain IR identity-bearing');
});
