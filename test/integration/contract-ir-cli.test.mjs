import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixtures = resolve(packageRoot, 'test/fixtures');

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

function checkArgs(fixture, temp, reportPath, contractIrPath, extra = []) {
  return [
    'check',
    `--typespec=${resolve(fixtures, `${fixture}/main.tsp`)}`,
    `--schema=${resolve(fixtures, `${fixture}/authored.schema.json`)}`,
    `--output-dir=${join(temp, 'generated')}`,
    `--report=${reportPath}`,
    `--contract-ir=${contractIrPath}`,
    '--quiet',
    ...extra,
  ];
}

test('check emits digest-bound Contract IR only after a passing exact-input receipt', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-contract-ir-pass-'));
  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  const result = await run(checkArgs('pass', temp, reportPath, contractIrPath));
  assert.equal(result.code, 0, result.stderr || result.stdout);

  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const contractIr = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(contractIr.schema, 'ores.typespec-json-schema-validator.contract-ir/v1');
  assert.equal(contractIr.status, 'passed');
  assert.equal(contractIr.admissible, true);
  assert.equal(contractIr.editableAuthority, false);
  assert.equal(contractIr.admission.receipt.runId, report.runId);
  assert.equal(contractIr.provenance.typespec.digest, report.inputs.typespec.digest);
  assert.equal(contractIr.provenance.generatedJsonSchema.digest, report.inputs.generatedJsonSchema.digest);
  assert.equal(contractIr.provenance.authoredJsonSchema.digest, report.inputs.authoredJsonSchema.digest);
  assert.ok(contractIr.declarations.length > 0);
});

test('a stopped parity run publishes a non-admissible tombstone instead of stale IR', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-contract-ir-tombstone-'));
  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');

  const passing = await run(checkArgs('pass', temp, reportPath, contractIrPath));
  assert.equal(passing.code, 0, passing.stderr || passing.stdout);
  assert.equal(JSON.parse(await readFile(contractIrPath, 'utf8')).admissible, true);

  const stopped = await run(checkArgs('drift', temp, reportPath, contractIrPath));
  assert.equal(stopped.code, 2, stopped.stderr || stopped.stdout);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const contractIr = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(contractIr.status, 'stopped_for_evaluation');
  assert.equal(contractIr.admissible, false);
  assert.equal(contractIr.declarations.length, 0);
  assert.equal(contractIr.admission.receipt.runId, report.runId);
});

test('Contract IR refuses a structurally passing receipt without differential evidence', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-contract-ir-coverage-'));
  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  const result = await run(checkArgs('pass', temp, reportPath, contractIrPath, ['--probes=false']));
  assert.equal(result.code, 3, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const contractIr = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.match(report.error.message, /differential instance validation was not executed/);
  assert.equal(contractIr.status, 'failed');
  assert.equal(contractIr.admissible, false);
});

test('Contract IR flag remains scoped to full check and compare commands', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-contract-ir-scope-'));
  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  const result = await run([
    'validate',
    `--schema=${resolve(fixtures, 'equivalent/authored.schema.json')}`,
    `--generated-schema=${resolve(fixtures, 'equivalent/generated.schema.json')}`,
    `--report=${reportPath}`,
    `--contract-ir=${contractIrPath}`,
    '--quiet',
  ]);
  assert.equal(result.code, 3);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.context.usageError, true);
});
