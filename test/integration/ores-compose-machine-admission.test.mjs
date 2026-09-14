import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const ORES_INTERFACES_SHA = '9ff7362dca43455b84a5dc7eb56ee7d2347f8170';
const ORES_INTERFACES_URL = 'https://github.com/ORESoftware/ores-interfaces.git';

function run(program, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd ?? packageRoot,
      env: options.env ?? process.env,
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

async function checkoutPinnedAuthority(root) {
  const source = join(root, 'ores-interfaces');
  let result = await run('git', ['init', source]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  result = await run('git', ['remote', 'add', 'origin', ORES_INTERFACES_URL], { cwd: source });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  result = await run('git', ['fetch', '--depth=1', 'origin', ORES_INTERFACES_SHA], { cwd: source });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  result = await run('git', ['checkout', '--detach', ORES_INTERFACES_SHA], { cwd: source });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  result = await run('git', ['rev-parse', 'HEAD'], { cwd: source });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), ORES_INTERFACES_SHA);
  return source;
}

test('ores-compose machine v1 is executable peer-authority contract evidence', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tjsv-ores-compose-machine-'));
  const source = await checkoutPinnedAuthority(temp);
  const contractRoot = join(source, 'contracts/ores-compose-machine/v1');

  const config = JSON.parse(await readFile(join(contractRoot, 'contracts.config.json'), 'utf8'));
  assert.equal(config.typespec, 'main.tsp');
  assert.equal(config.jsonSchema, 'authored.schema.json');

  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  const generatedDir = join(temp, 'generated');
  const result = await run(process.execPath, [
    executable,
    'check',
    `--typespec=${join(contractRoot, 'main.tsp')}`,
    `--schema=${join(contractRoot, 'authored.schema.json')}`,
    `--instances=${join(contractRoot, 'instances')}`,
    `--output-dir=${generatedDir}`,
    `--report=${reportPath}`,
    `--contract-ir=${contractIrPath}`,
    '--quiet',
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);

  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.zeroUnexplainedFindings, true);
  assert.equal(report.coverage.differentialInstanceValidation, true);
  assert.ok(report.differential.summary.corpusInstances > 0, 'the real machine corpus must execute');
  assert.equal(report.differential.summary.divergences, 0);
  assert.equal(report.counts.differentialFindings, 0);

  const contractIr = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(typeof contractIr, 'object');
  assert.ok(contractIr !== null);
});
