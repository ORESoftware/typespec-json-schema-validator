import assert from 'node:assert/strict';
import { mkdtemp, readFile, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { WIT_PROJECTION_SCHEMA } from '../../src/wit-compatibility.mjs';

function projection() {
  return {
    schema: WIT_PROJECTION_SCHEMA,
    package: 'ores:example@1.0.0',
    interfaces: [{
      name: 'client',
      types: [{ name: 'status', kind: 'enum', shape: 'enum{ok,error}' }],
      functions: [{ name: 'send', async: false, params: [{ name: 'payload', type: 'list<u8>' }], results: [] }],
    }],
    worlds: [{ name: 'sdk', imports: [], exports: [{ name: 'client', kind: 'interface', target: 'client' }] }],
  };
}

function run(root, mode = 'strict') {
  return spawnSync(process.execPath, [
    resolve('bin/typespec-json-schema-validator.mjs'),
    'verify-wit',
    '--baseline', resolve(root, 'baseline.json'),
    '--current', resolve(root, 'current.json'),
    '--verification', resolve(root, 'receipt.json'),
    '--mode', mode,
    '--quiet=true',
  ], { encoding: 'utf8', env: process.env });
}

test('verify-wit CLI emits a passed receipt', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'tsjsv-wit-cli-'));
  await writeFile(resolve(root, 'baseline.json'), JSON.stringify(projection()));
  await writeFile(resolve(root, 'current.json'), JSON.stringify(projection()));
  const child = run(root);
  assert.equal(child.status, 0, child.stderr);
  const receipt = JSON.parse(await readFile(resolve(root, 'receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.mode, 'strict');
});

test('verify-wit CLI stops for a changed closed WIT type', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'tsjsv-wit-cli-'));
  const current = projection();
  current.interfaces[0].types[0].shape = 'enum{ok,error,retry}';
  await writeFile(resolve(root, 'baseline.json'), JSON.stringify(projection()));
  await writeFile(resolve(root, 'current.json'), JSON.stringify(current));
  const child = run(root);
  assert.equal(child.status, 2, child.stderr);
  const receipt = JSON.parse(await readFile(resolve(root, 'receipt.json'), 'utf8'));
  assert.ok(receipt.breakingChanges.some((item) => item.ruleId === 'wit-type-changed'));
});


test('verify-wit CLI rejects oversized projection files before JSON parsing', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'tsjsv-wit-cli-'));
  await writeFile(resolve(root, 'baseline.json'), JSON.stringify(projection()));
  await writeFile(resolve(root, 'current.json'), '{}');
  await truncate(resolve(root, 'current.json'), (16 * 1024 * 1024) + 1);
  const child = run(root);
  assert.notEqual(child.status, 0);
  const receipt = JSON.parse(await readFile(resolve(root, 'receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.failureCode, 'wit-compatibility-verification-failed');
});
