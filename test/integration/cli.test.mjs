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
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

test('doctor verifies the installed flags-2-env and TypeSpec toolchain', async () => {
  const result = await run(['doctor']);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'passed');
  assert.equal(payload.flags2env.available, true);
  assert.equal(payload.typespec.available, true);
  assert.equal(payload.jsonSchemaEmitter.available, true);
});

test('check compiles TypeSpec with the official emitter and passes equivalent authored JSON Schema', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-cli-pass-'));
  const reportPath = join(temp, 'report.json');
  const result = await run([
    'check',
    `--typespec=${resolve(fixtures, 'pass/main.tsp')}`,
    `--schema=${resolve(fixtures, 'pass/authored.schema.json')}`,
    `--output-dir=${join(temp, 'generated')}`,
    `--report=${reportPath}`,
    '--quiet',
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.zeroUnexplainedFindings, true);
  assert.equal(report.coverage.sourceMutationCheck, true);
});

test('check fails closed with exit 2 for independently authored schema drift', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-cli-drift-'));
  const reportPath = join(temp, 'report.json');
  const result = await run([
    'check',
    `--typespec=${resolve(fixtures, 'drift/main.tsp')}`,
    `--schema=${resolve(fixtures, 'drift/authored.schema.json')}`,
    `--output-dir=${join(temp, 'generated')}`,
    `--report=${reportPath}`,
    '--quiet',
  ]);
  assert.equal(result.code, 2, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.every((finding) => finding.resolutionState === 'unexplained'));
});

test('unknown CLI flags are rejected by flags-2-env and produce a failed receipt', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-cli-unknown-'));
  const reportPath = join(temp, 'failure.json');
  const result = await run(['doctor', '--not-a-real-flag', `--report=${reportPath}`]);
  assert.equal(result.code, 3);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.context.usageError, true);
});
