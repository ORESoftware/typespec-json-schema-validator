import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { UnsafeReportDestinationError, writeReportFile } from '../../src/report-file.mjs';

const SCHEMA = 'ores.typespec-json-schema-validator.report/v1';
const receipt = (status = 'passed', id = 'a') => ({
  schema: SCHEMA,
  runId: id.repeat(64),
  status,
  zeroUnexplainedFindings: status === 'passed',
  findings: [],
});
const bytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-report-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function publish(path, value = receipt()) {
  return writeReportFile(path, bytes(value), SCHEMA);
}

async function assertPreserved(path, expected) {
  assert.equal(await readFile(path, 'utf8'), expected);
}

async function assertNoScratch(root) {
  assert.deepEqual((await readdir(root)).filter((name) => name.startsWith('.tsjsv-report-')), []);
}

test('creates a complete receipt in a new nested directory', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'reports', 'report.json');
  assert.equal(await publish(path), resolve(path));
  await assertPreserved(path, bytes(receipt()));
  assert.equal((await lstat(path)).nlink, 1);
  await assertNoScratch(join(root, 'reports'));
});

test('replaces passed, stopped, and failed receipts without stale trailing bytes', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'report.json');
  for (const [index, status] of ['passed', 'stopped_for_evaluation', 'failed', 'passed'].entries()) {
    const value = { ...receipt(status, String(index)), extra: 'x'.repeat(100 - index * 20) };
    await publish(path, value);
    await assertPreserved(path, bytes(value));
    assert.equal((await lstat(path)).nlink, 1);
  }
  await assertNoScratch(root);
});

for (const [name, original] of [
  ['TypeSpec source', 'model Account { id: string; }\n'],
  ['authored JSON Schema', '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}\n'],
  ['mapping or corpus JSON', '{"declarations":[],"cases":[]}\n'],
  ['malformed JSON', '{"private":"SENTINEL-NOT-FOR-LOGS"'],
  ['empty file', ''],
  ['schema-only lookalike', bytes({ schema: SCHEMA })],
  ['unknown receipt version', bytes({ ...receipt(), schema: `${SCHEMA}-unknown` })],
]) {
  test(`preserves an existing ${name} for both success and failure reports`, async (t) => {
    const root = await fixture(t);
    const path = join(root, 'source');
    await writeFile(path, original);
    for (const status of ['passed', 'failed']) {
      await assert.rejects(() => publish(path, receipt(status)), (error) => {
        assert.ok(error instanceof UnsafeReportDestinationError);
        assert.ok(!error.message.includes('SENTINEL-NOT-FOR-LOGS'));
        return true;
      });
      await assertPreserved(path, original);
    }
    await assertNoScratch(root);
  });
}

test('rejects a symlink to a source and leaves its target and link intact', async (t) => {
  const root = await fixture(t);
  const target = join(root, 'source.json');
  const alias = join(root, 'report.json');
  await writeFile(target, '{"type":"string"}\n');
  await symlink(target, alias);
  await assert.rejects(() => publish(alias), UnsafeReportDestinationError);
  assert.ok((await lstat(alias)).isSymbolicLink());
  await assertPreserved(target, '{"type":"string"}\n');
  await assertNoScratch(root);
});

test('rejects dangling symlinks rather than creating their targets', async (t) => {
  const root = await fixture(t);
  const target = join(root, 'missing.json');
  const alias = join(root, 'report.json');
  await symlink(target, alias);
  await assert.rejects(() => publish(alias), UnsafeReportDestinationError);
  await assert.rejects(() => lstat(target), { code: 'ENOENT' });
  assert.ok((await lstat(alias)).isSymbolicLink());
});

test('rejects hard-linked receipts and preserves every alias', async (t) => {
  const root = await fixture(t);
  const target = join(root, 'original.json');
  const alias = join(root, 'report.json');
  const original = bytes(receipt());
  await writeFile(target, original);
  await link(target, alias);
  await assert.rejects(() => publish(alias, receipt('failed')), UnsafeReportDestinationError);
  await assertPreserved(target, original);
  await assertPreserved(alias, original);
  assert.equal((await lstat(target)).nlink, 2);
  await assertNoScratch(root);
});

test('rejects a directory without touching its children', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'report.json');
  await mkdir(path);
  await writeFile(join(path, 'source.tsp'), 'model Keep {}\n');
  await assert.rejects(() => publish(path), UnsafeReportDestinationError);
  await assertPreserved(join(path, 'source.tsp'), 'model Keep {}\n');
  await assertNoScratch(root);
});

test('rejects malformed new receipts before creating directories or replacing a valid receipt', async (t) => {
  const root = await fixture(t);
  const existing = join(root, 'report.json');
  await publish(existing);
  for (const text of ['not JSON', '{}', bytes({ ...receipt(), runId: 'invalid' })]) {
    await assert.rejects(() => writeReportFile(existing, text, SCHEMA), TypeError);
    await assertPreserved(existing, bytes(receipt()));
    await assert.rejects(() => writeReportFile(join(root, 'absent', 'report.json'), text, SCHEMA), TypeError);
  }
  await assert.rejects(() => lstat(join(root, 'absent')), { code: 'ENOENT' });
  await assertNoScratch(root);
});

test('serialization failure preserves the previous receipt', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'report.json');
  await publish(path);
  const cyclic = receipt();
  cyclic.self = cyclic;
  await assert.rejects(() => publish(path, cyclic), TypeError);
  await assertPreserved(path, bytes(receipt()));
  await assertNoScratch(root);
});

test('concurrent first writers never publish partial JSON or overwrite unrelated files', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'report.json');
  const outcomes = await Promise.allSettled([
    publish(path, receipt('passed', 'a')),
    publish(path, receipt('failed', 'b')),
  ]);
  assert.ok(outcomes.some((outcome) => outcome.status === 'fulfilled'));
  const actual = JSON.parse(await readFile(path, 'utf8'));
  assert.ok(actual.runId === 'a'.repeat(64) || actual.runId === 'b'.repeat(64));
  assert.equal(actual.schema, SCHEMA);
  assert.equal((await lstat(path)).nlink, 1);
  await assertNoScratch(root);
});
