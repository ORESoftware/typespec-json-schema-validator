import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixture = resolve(packageRoot, 'test/fixtures/grpc-control');

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: packageRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

function checkArgs(temp, schemaPath, contractIrPath = join(temp, 'contract-ir.json')) {
  return [
    'check',
    `--typespec=${resolve(fixture, 'main.tsp')}`,
    `--schema=${schemaPath}`,
    `--instances=${resolve(fixture, 'instances')}`,
    `--output-dir=${join(temp, 'generated')}`,
    `--report=${join(temp, 'report.json')}`,
    `--contract-ir=${contractIrPath}`,
    '--max-findings=100',
    '--quiet',
  ];
}

async function assertStoppedForDrift(mutator, prefix) {
  const temp = await mkdtemp(join(tmpdir(), prefix));
  const authored = JSON.parse(await readFile(resolve(fixture, 'authored.schema.json'), 'utf8'));
  mutator(authored);
  const driftSchemaPath = join(temp, 'authored-drift.schema.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  await writeFile(driftSchemaPath, `${JSON.stringify(authored, null, 2)}\n`);

  const result = await run(checkArgs(temp, driftSchemaPath, contractIrPath));
  assert.equal(result.code, 2, result.stderr || result.stdout);

  const report = JSON.parse(await readFile(join(temp, 'report.json'), 'utf8'));
  assert.equal(report.schema, 'ores.typespec-json-schema-validator.report/v1');
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(report.zeroUnexplainedFindings, false);
  assert.ok(report.findings.length > 0);

  const ir = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(ir.schema, 'ores.typespec-json-schema-validator.contract-ir/v1');
  assert.equal(ir.status, 'stopped_for_evaluation');
  assert.equal(ir.admissible, false);
  assert.deepEqual(ir.declarations, []);
  assert.equal(ir.admission.receipt.runId, report.runId);
}

test('real-world gRPC control authorities produce clean differential and Contract IR evidence', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tjsv-grpc-control-'));
  const contractIrPath = join(temp, 'contract-ir.json');
  const result = await run(checkArgs(temp, resolve(fixture, 'authored.schema.json'), contractIrPath));

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const report = JSON.parse(await readFile(join(temp, 'report.json'), 'utf8'));
  assert.equal(report.schema, 'ores.typespec-json-schema-validator.report/v1');
  assert.equal(report.status, 'passed');
  assert.equal(report.zeroUnexplainedFindings, true);
  assert.deepEqual(report.findings, []);
  assert.ok(report.differential.summary.probesEvaluated > 0);
  assert.ok(report.differential.summary.corpusInstances >= 10);
  assert.equal(report.differential.summary.divergences, 0);
  assert.equal(report.differential.summary.refusals, 0);

  const ir = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(ir.schema, 'ores.typespec-json-schema-validator.contract-ir/v1');
  assert.equal(ir.status, 'passed');
  assert.equal(ir.admissible, true);
  assert.deepEqual(
    ir.declarations.map((declaration) => declaration.names.authoredJsonSchema).sort(),
    ['CheckTargetSummary', 'DatabaseTarget', 'Drift', 'DriftKind', 'WitnessSummary'].sort(),
  );
});

test('gRPC control enum drift stops promotion and emits only a non-admissible Contract IR tombstone', async () => {
  await assertStoppedForDrift((authored) => {
    authored.$defs.DriftKind.enum = authored.$defs.DriftKind.enum.filter(
      (value) => value !== 'DRIFT_KIND_CONTRACT_MISMATCH',
    );
  }, 'tjsv-grpc-control-enum-drift-');
});

test('gRPC control requiredness drift stops promotion and emits only a non-admissible Contract IR tombstone', async () => {
  await assertStoppedForDrift((authored) => {
    authored.$defs.Drift.required = authored.$defs.Drift.required.filter((name) => name !== 'actual');
  }, 'tjsv-grpc-control-required-drift-');
});
