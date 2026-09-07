import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const executable = join(root, 'bin/typespec-json-schema-validator.mjs');
const runner = join(root, 'scripts/verify-consumer.mjs');

test('consumer action entrypoint verifies real compiler output and rejects invalid evidence', async (t) => {
  await mkdir(join(root, 'tmp'), { recursive: true });
  const temp = await mkdtemp(join(root, 'tmp/consumer-verification-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const typespec = join(temp, 'main.tsp');
  const authored = join(temp, 'authored.schema.json');
  await copyFile(join(root, 'test/fixtures/pass/main.tsp'), typespec);
  await copyFile(join(root, 'test/fixtures/pass/authored.schema.json'), authored);
  const generatedDir = join(temp, 'generated');
  const generated = join(generatedDir, 'typespec.generated.schema.json');
  const report = join(temp, 'report.json');
  const ir = join(temp, 'contract-ir.json');
  const compilation = spawnSync(process.execPath, [executable, 'check',
    `--typespec=${typespec}`, `--schema=${authored}`, `--output-dir=${generatedDir}`,
    `--report=${report}`, `--contract-ir=${ir}`, '--quiet'],
  { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.equal(compilation.status, 0, compilation.stderr || compilation.stdout);
  const originals = new Map(await Promise.all([typespec, authored, generated, report, ir]
    .map(async (path) => [path, await readFile(path, 'utf8')])));
  const env = { ...process.env, GITHUB_WORKSPACE: root,
    TSJSV_VERIFY_TYPESPEC: typespec, TSJSV_VERIFY_AUTHORED: authored,
    TSJSV_VERIFY_GENERATED: generated, TSJSV_VERIFY_REPORT: report,
    TSJSV_VERIFY_IR: ir, TSJSV_VERIFY_DECLARATIONS: '["Example.Role","Example.User"]' };
  const run = (overrides = {}) => spawnSync(process.execPath, [runner], {
    cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 30000,
  });
  await t.test('real evidence passes', () => {
    const result = run(); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'passed');
  });
  for (const [label, path, transform] of [
    ['tampered IR', ir, (text) => { const x = JSON.parse(text); x.declarations[0].assertionDigest = '0'.repeat(64); return JSON.stringify(x); }],
    ['modified receipt', report, (text) => { const x = JSON.parse(text); x.runId = '0'.repeat(64); return JSON.stringify(x); }],
    ['disabled validation', report, (text) => { const x = JSON.parse(text); x.coverage.differentialInstanceValidation = false; return JSON.stringify(x); }],
    ['stale TypeSpec source', typespec, (text) => text.replace('id: string;', 'id: int32;')],
    ['stale authored source', authored, (text) => { const x = JSON.parse(text); x.$defs.User.properties.id.type = 'number'; return JSON.stringify(x); }],
    ['stale generated witness', generated, (text) => { const x = JSON.parse(text); x.$defs.User.properties.id.type = 'number'; return JSON.stringify(x); }],
  ]) await t.test(`rejects ${label} while green fields remain`, async () => {
    await writeFile(path, transform(originals.get(path)));
    try { const result = run(); assert.equal(result.status, 2, result.stdout || result.stderr); }
    finally { await writeFile(path, originals.get(path)); }
  });
  await t.test('rejects absent artifacts', () => {
    assert.equal(run({ TSJSV_VERIFY_IR: join(temp, 'missing.json') }).status, 2);
  });
  await t.test('rejects partial consumer inventory', () => {
    assert.equal(run({ TSJSV_VERIFY_DECLARATIONS: '["Example.User"]' }).status, 2);
  });
  await t.test('rejects unconfigured consumer inventory', () => {
    assert.equal(run({ TSJSV_VERIFY_DECLARATIONS: '' }).status, 2);
  });
});
