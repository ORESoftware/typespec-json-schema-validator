import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixtures = resolve(packageRoot, 'test/fixtures/pass');

function run(cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

test('tjsv check consumes repository-owned .ores-tjsv.toml without repeated authority flags', async (t) => {
  const root = await mkdtemp(join(packageRoot, 'test', 'tmp-consumer-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'contracts'), { recursive: true });
  await mkdir(join(root, 'evidence'), { recursive: true });
  await copyFile(resolve(fixtures, 'main.tsp'), join(root, 'contracts', 'main.tsp'));
  await copyFile(resolve(fixtures, 'authored.schema.json'), join(root, 'contracts', 'authored.schema.json'));
  await writeFile(join(root, '.ores-tjsv.toml'), [
    'version = 1',
    '',
    '[authority]',
    'typespec = "peer-authority"',
    'json_schema = "peer-authority"',
    '',
    '[defaults]',
    'report = "evidence/report.json"',
    'output_dir = "evidence/generated"',
    '',
    '[[contracts]]',
    'id = "api"',
    'typespec = "contracts/main.tsp"',
    'schema = "contracts/authored.schema.json"',
    '',
  ].join('\n'));

  const result = await run(root, ['check', '--quiet']);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(join(root, 'evidence', 'report.json'), 'utf8'));
  assert.equal(report.status, 'passed');
});
