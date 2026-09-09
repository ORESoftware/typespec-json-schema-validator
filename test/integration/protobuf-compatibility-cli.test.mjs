import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { PROTOBUF_PROJECTION_SCHEMA } from '../../src/protobuf-compatibility.mjs';

function projection() {
  return {
    schema: PROTOBUF_PROJECTION_SCHEMA,
    syntax: 'proto3',
    package: 'ores.example.v1',
    messages: [{ name: 'Widget', fields: [{ name: 'id', number: 1, type: 'string', cardinality: 'singular', presence: 'implicit', oneof: null, jsonName: 'id' }], reservedNumbers: [], reservedNames: [] }],
    enums: [],
    services: [],
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(root, extra = {}) {
  return spawnSync(process.execPath, [resolve('scripts/verify-protobuf.mjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TSJSV_PROTOBUF_ROOT: root,
      TSJSV_PROTOBUF_BASELINE: 'baseline.json',
      TSJSV_PROTOBUF_CURRENT: 'current.json',
      TSJSV_PROTOBUF_VERIFICATION: 'evidence/receipt.json',
      TSJSV_QUIET: 'true',
      ...extra,
    },
  });
}

test('verify-protobuf emits passed receipt for compatible projection', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'tsjsv-protobuf-cli-'));
  await writeJson(resolve(root, 'baseline.json'), projection());
  await writeJson(resolve(root, 'current.json'), projection());
  const child = run(root);
  assert.equal(child.status, 0, child.stderr);
  const receipt = JSON.parse(await readFile(resolve(root, 'evidence/receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.admissible, true);
});

test('verify-protobuf stops for a wire breaking change', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'tsjsv-protobuf-cli-'));
  const current = projection();
  current.messages[0].fields[0].type = 'bytes';
  await writeJson(resolve(root, 'baseline.json'), projection());
  await writeJson(resolve(root, 'current.json'), current);
  const child = run(root);
  assert.equal(child.status, 2, child.stderr);
  const receipt = JSON.parse(await readFile(resolve(root, 'evidence/receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.ok(receipt.breakingChanges.some((item) => item.ruleId === 'protobuf-field-type-changed'));
});

test('verify-protobuf fails closed on path traversal and writes a failed receipt in-root', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'tsjsv-protobuf-cli-'));
  await writeJson(resolve(root, 'current.json'), projection());
  const child = run(root, { TSJSV_PROTOBUF_BASELINE: '../baseline.json' });
  assert.equal(child.status, 3);
  const receipt = JSON.parse(await readFile(resolve(root, 'evidence/receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.admissible, false);
});
