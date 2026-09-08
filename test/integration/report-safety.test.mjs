import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { failedReport, REPORT_SCHEMA, writeReport } from '../../src/run.mjs';

const CLI = fileURLToPath(new URL('../../bin/typespec-json-schema-validator.mjs', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-cli-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function cli(cwd, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TSJSV_')));
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

test('the public report writer preserves existing source on failure receipts', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'schema.json');
  const source = '{"type":"object"}\n';
  await writeFile(path, source);
  const report = await failedReport(new Error('fixture failure'));
  await assert.rejects(() => writeReport(path, report), { name: 'UnsafeReportDestinationError' });
  assert.equal(await readFile(path, 'utf8'), source);
  assert.deepEqual(await readdir(root), ['schema.json']);
});

test('CLI parse-error receipt cannot overwrite an existing TypeSpec source', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'main.tsp');
  const source = 'model Account { id: string; }\n';
  await writeFile(path, source);
  const result = cli(root, ['inventory', `--typespec=${path}`, `--report=${path}`, '--unknown-report-test-flag']);
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /could not write failure report/);
  assert.equal(await readFile(path, 'utf8'), source);
});

test('CLI execution-error receipt cannot overwrite an existing authored schema', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'schema.json');
  const source = '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}\n';
  await writeFile(path, source);
  const result = cli(root, ['validate', `--schema=${path}`, `--generated-schema=${join(root, 'missing.json')}`, `--report=${path}`]);
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /could not write failure report/);
  assert.equal(await readFile(path, 'utf8'), source);
});

test('CLI failure receipts still persist and can be replaced at a safe destination', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'reports', 'failure.json');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = cli(root, ['inventory', `--typespec=${join(root, `missing-${attempt}.tsp`)}`, `--report=${path}`, '--unknown-report-test-flag']);
    assert.equal(result.status, 3, result.stderr);
    assert.doesNotMatch(result.stderr, /could not write failure report/);
    const report = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(report.schema, REPORT_SCHEMA);
    assert.equal(report.status, 'failed');
    assert.equal(report.zeroUnexplainedFindings, false);
  }
  assert.deepEqual(await readdir(join(root, 'reports')), ['failure.json']);
});
