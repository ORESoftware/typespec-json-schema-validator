import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { JSON_SCHEMA_DRAFT_2020_12 } from '../../src/json-schema.mjs';

const cli = resolve(import.meta.dirname, '../../bin/typespec-json-schema-validator.mjs');

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

test('static reference-scope drift stops the CLI and writes a non-admissible IR tombstone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-scope-admission-'));
  const typespec = join(root, 'main.tsp');
  const generated = join(root, 'generated.json');
  const authored = join(root, 'authored.json');
  const reportPath = join(root, 'report.json');
  const irPath = join(root, 'ir.json');
  // Compare mode intentionally accepts saved emitter evidence. These small
  // synthetic snapshots isolate the resource-boundary bug from compilation.
  await writeFile(typespec, 'namespace Demo; scalar Value extends string; model Payload { value: Value; }\n');
  const witness = {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/root.json',
    $defs: {
      Value: { type: 'string' },
      Payload: {
        type: 'object', properties: { value: { $ref: '#/$defs/Value' } }, required: ['value'],
        $defs: { Value: { type: 'integer' } },
      },
    },
  };
  await writeJson(generated, witness);
  const independent = structuredClone(witness);
  independent.$defs.Payload.$id = 'nested.json';
  await writeJson(authored, independent);
  const paths = [typespec, generated, authored];
  const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
  const result = spawnSync(process.execPath, [cli, 'compare', '--typespec', typespec,
    '--schema', authored, '--generated-schema', generated, '--probes=false',
    '--report', reportPath, '--contract-ir', irPath, '--quiet'], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.ok(report.findings.some(({ ruleId, pointer }) => ruleId === 'generated-authored-semantic-mismatch' && pointer.endsWith('/properties/value/$ref')));
  const ir = JSON.parse(await readFile(irPath, 'utf8'));
  assert.equal(ir.admissible, false);
  assert.deepEqual(ir.declarations, []);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, 'utf8'))), before);
});

test('cyclic instance evaluation produces CLI refusal evidence instead of a passed receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-cycle-admission-'));
  const generated = join(root, 'generated.json');
  const authored = join(root, 'authored.json');
  const reportPath = join(root, 'report.json');
  const schema = { $schema: JSON_SCHEMA_DRAFT_2020_12, $defs: { Loop: { not: { $ref: '#/$defs/Loop' } } } };
  await writeJson(generated, schema);
  await writeJson(authored, schema);
  const result = spawnSync(process.execPath, [cli, 'validate', '--schema', authored,
    '--generated-schema', generated, '--report', reportPath, '--quiet'], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(report.differential.summary.agreements, 0);
  assert.ok(report.differential.summary.refusals > 0);
  assert.ok(report.findings.every(({ ruleId }) => ruleId === 'differential-validation-refused'));
});
