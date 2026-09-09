import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { PROTOBUF_PROJECTION_SCHEMA } from '../../src/protobuf-compatibility.mjs';

function projection() {
  return {
    schema: PROTOBUF_PROJECTION_SCHEMA,
    syntax: 'proto3',
    package: 'ores.reservations.v1',
    messages: [{
      name: 'Record',
      fields: [],
      reservedNumbers: [9],
      reservedNames: ['legacy_field'],
    }],
    enums: [{
      name: 'State',
      values: [{ name: 'STATE_UNSPECIFIED', number: 0 }],
      reservedNumbers: [3],
      reservedNames: ['STATE_DELETED'],
    }],
    services: [],
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

test('verify-protobuf emits durable breaking evidence when old reservations disappear', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'tsjsv-protobuf-reservations-'));
  const baseline = projection();
  const current = structuredClone(baseline);
  current.messages[0].reservedNumbers = [];
  current.messages[0].reservedNames = [];
  current.enums[0].reservedNumbers = [];
  current.enums[0].reservedNames = [];
  await writeJson(resolve(root, 'baseline.json'), baseline);
  await writeJson(resolve(root, 'current.json'), current);

  const child = spawnSync(process.execPath, [resolve('scripts/verify-protobuf.mjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TSJSV_PROTOBUF_ROOT: root,
      TSJSV_PROTOBUF_BASELINE: 'baseline.json',
      TSJSV_PROTOBUF_CURRENT: 'current.json',
      TSJSV_PROTOBUF_VERIFICATION: 'evidence/receipt.json',
      TSJSV_QUIET: 'true',
    },
  });
  assert.equal(child.status, 2, child.stderr);

  const receipt = JSON.parse(await readFile(resolve(root, 'evidence/receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.admissible, false);
  assert.equal(receipt.failureCode, 'protobuf-breaking-change-detected');
  assert.deepEqual(
    new Set(receipt.breakingChanges.map((finding) => finding.ruleId)),
    new Set([
      'protobuf-reserved-field-number-unreserved',
      'protobuf-reserved-field-name-unreserved',
      'protobuf-reserved-enum-number-unreserved',
      'protobuf-reserved-enum-name-unreserved',
    ]),
  );
});
