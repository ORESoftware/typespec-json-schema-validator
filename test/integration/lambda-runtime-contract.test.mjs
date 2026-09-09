import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixture = resolve(packageRoot, 'test/fixtures/lambda-runtime-contract');

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
    '--quiet',
  ];
}

test('lambda provider and operation peers admit Contract IR with differential fixtures', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-lambda-runtime-'));
  const contractIrPath = join(temp, 'contract-ir.json');
  const result = await run(checkArgs(temp, resolve(fixture, 'authored.schema.json'), contractIrPath));

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(join(temp, 'report.json'), 'utf8'));
  const contractIr = JSON.parse(await readFile(contractIrPath, 'utf8'));

  assert.equal(report.status, 'passed');
  assert.equal(report.zeroUnexplainedFindings, true);
  assert.equal(report.coverage.differentialInstanceValidation, true);
  assert.equal(report.differential.summary.corpusInstances, 2);
  assert.equal(report.differential.summary.divergences, 0);
  assert.equal(contractIr.status, 'passed');
  assert.equal(contractIr.admissible, true);
  assert.equal(contractIr.authorities.typespec, 'independently-authored');
  assert.equal(contractIr.authorities.jsonSchema, 'independently-authored');
  assert.equal(contractIr.authorities.generatedJsonSchema, 'comparison-evidence-only');
  assert.equal(contractIr.authorities.precedence, 'none');
  assert.equal(contractIr.declarations.length, 3);
});

test('lambda enum drift fails closed and emits only a non-admissible Contract IR tombstone', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-lambda-drift-'));
  const source = JSON.parse(await readFile(resolve(fixture, 'authored.schema.json'), 'utf8'));
  source.$defs.Provider.enum = source.$defs.Provider.enum.filter((value) => value !== 'cloudflare-workers');
  const driftSchema = join(temp, 'authored-drift.schema.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  await writeFile(driftSchema, `${JSON.stringify(source, null, 2)}\n`);

  const result = await run(checkArgs(temp, driftSchema, contractIrPath));
  assert.equal(result.code, 2, result.stderr || result.stdout);

  const report = JSON.parse(await readFile(join(temp, 'report.json'), 'utf8'));
  const contractIr = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(report.zeroUnexplainedFindings, false);
  assert.ok(report.findings.length > 0);
  assert.equal(contractIr.status, 'stopped_for_evaluation');
  assert.equal(contractIr.admissible, false);
  assert.equal(contractIr.declarations.length, 0);
  assert.equal(contractIr.admission.receipt.runId, report.runId);
});
