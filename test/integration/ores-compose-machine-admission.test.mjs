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

  const typeSpec = await readFile(join(contractRoot, 'main.tsp'), 'utf8');
  const authored = JSON.parse(await readFile(join(contractRoot, 'authored.schema.json'), 'utf8'));
  const defs = authored.$defs;

  const ensure = defs.EnsureRequest;
  assert.equal(ensure.additionalProperties, false);
  for (const forbidden of ['runtime', 'network', 'command', 'argv', 'cwd', 'shell', 'backend']) {
    assert.equal(ensure.properties[forbidden], undefined, `EnsureRequest unexpectedly exposes ${forbidden}`);
  }
  const ensureTypeSpec = typeSpec.match(/model\s+EnsureRequest\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  for (const forbidden of ['runtime:', 'network:', 'command:', 'argv:', 'cwd:', 'shell:', 'backend:']) {
    assert.equal(ensureTypeSpec.includes(forbidden), false, `TypeSpec EnsureRequest unexpectedly exposes ${forbidden}`);
  }

  const errorCodes = defs.MachineErrorResponse.properties.code.anyOf.map((entry) => entry.const);
  assert.ok(errorCodes.includes('job_not_found'));
  assert.match(typeSpec, /\|\s*"job_not_found"/);

  const ingressPattern = new RegExp(defs.MachineIngress.properties.authority.pattern);
  assert.equal(ingressPattern.test('127.0.0.1:39123'), true);
  assert.equal(ingressPattern.test('[::1]:39123'), true);
  assert.equal(ingressPattern.test('/tmp/ores-compose/machine.sock'), true);
  assert.equal(ingressPattern.test('10.0.0.9:8080'), false);
  assert.equal(ingressPattern.test('8.8.8.8:53'), false);

  const decimalPattern = '^[1-9][0-9]{0,19}$';
  assert.equal(defs.EnqueueResponse.properties.job_id.pattern, decimalPattern);
  assert.equal(defs.JobStatusResponse.properties.job_id.pattern, decimalPattern);
  assert.equal(defs.ActiveSystem.properties.generation.pattern, decimalPattern);
  assert.equal(defs.MachineErrorResponse.properties.job_id.pattern, decimalPattern);

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
