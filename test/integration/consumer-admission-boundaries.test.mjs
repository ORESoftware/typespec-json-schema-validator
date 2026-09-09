import test from 'node:test';
import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = resolve(root, 'scripts/test-consumer-admission.mjs');
const schemaId = 'ores.typespec-json-schema-validator.consumer-verification-receipt/v1';
const secretSentinel = 'synthetic-private-input-must-not-appear-in-action-output';

function execute(path, args, env) {
  const result = spawnSync(process.execPath, [path, ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, 'a signal or timeout is not a validator verdict');
  return result;
}

function assertRefused(result) {
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), '', 'a failed invocation must not publish a success summary');
  assert.equal(result.stderr.trim(), 'TJSV consumer-admission regression gate failed; no promotion is authorized.');
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secretSentinel));
}

async function assertReceipt(path, status) {
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  const { verificationId, ...body } = receipt;
  assert.equal(receipt.schema, schemaId);
  assert.equal(receipt.status, status);
  assert.equal(receipt.admissible, status === 'passed');
  assert.equal(verificationId, sha256(canonicalStringify(body)));
  assert.equal(receipt.failureCode, status === 'passed' ? null : 'consumer-verification-failed');
  return receipt;
}

async function snapshot(path, files = new Map()) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await snapshot(child, files);
    else {
      assert.ok(entry.isFile(), 'the compiler baseline must contain only regular files');
      files.set(child, await readFile(child));
    }
  }
  return files;
}

test('real compiler admission: hostile evidence, filesystem ownership, and recovery', async (t) => {
  await mkdir(join(root, 'tmp'), { recursive: true });
  const temporary = await mkdtemp(join(root, 'tmp', 'admission-boundaries-'));
  const workspace = join(temporary, 'workspace');
  const typespec = join(workspace, 'authorities', 'typespec', 'main.tsp');
  const authored = join(workspace, 'authorities', 'schema', 'authored.schema.json');
  const report = join(workspace, 'evidence', 'report.json');
  const ir = join(workspace, 'evidence', 'contract-ir.json');
  const generated = join(workspace, 'evidence', 'generated');
  const witness = join(generated, 'typespec.generated.schema.json');
  const verification = join(workspace, 'verification.json');
  const outside = join(temporary, 'outside');
  const sentinel = join(outside, 'sentinel.json');
  const inputPaths = { IR: ir, REPORT: report, TYPESPEC: typespec, AUTHORED: authored, GENERATED: witness };
  const env = { ...process.env, GITHUB_WORKSPACE: workspace,
    TSJSV_VERIFY_IR: ir, TSJSV_VERIFY_REPORT: report, TSJSV_VERIFY_TYPESPEC: typespec,
    TSJSV_VERIFY_AUTHORED: authored, TSJSV_VERIFY_GENERATED: witness,
    TSJSV_VERIFY_DECLARATIONS: '["AdmissionBoundary.Item"]', TSJSV_VERIFY_VERIFICATION: verification };
  const run = (overrides = {}, args = []) => execute(script, args, { ...env, ...overrides });
  try {
    await mkdir(dirname(typespec), { recursive: true });
    await mkdir(dirname(authored), { recursive: true });
    await mkdir(outside);
    await writeFile(sentinel, 'caller-owned outside workspace\n');
    await writeFile(typespec, 'import "@typespec/json-schema";\nusing TypeSpec.JsonSchema;\nnamespace AdmissionBoundary;\n@id("Item")\nmodel Item { id: string; }\n');
    await writeFile(authored, JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: { Item: { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'Item',
        type: 'object', properties: { id: { type: 'string' } }, required: ['id'], unevaluatedProperties: false } },
    }));
    const compiled = execute(resolve(root, 'bin/typespec-json-schema-validator.mjs'), [
      'check', `--typespec=${typespec}`, `--schema=${authored}`, `--report=${report}`,
      `--contract-ir=${ir}`, `--output-dir=${generated}`, '--quiet',
    ], process.env);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const first = run();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(JSON.parse(first.stdout).negativeCasesPassed, 19);
    assert.equal(JSON.parse(first.stdout).positiveChecksPassed, 2);
    const positive = await assertReceipt(verification, 'passed');
    const files = await snapshot(workspace);
    const savedPositive = files.get(verification);
    // Reset only this test's mkdtemp-owned workspace, never a checkout or user file.
    const reset = async () => {
      await rm(workspace, { recursive: true, force: true });
      for (const [path, bytes] of files) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      }
      await writeFile(sentinel, 'caller-owned outside workspace\n');
    };
    const alter = async (path, mutate) => {
      const value = JSON.parse(await readFile(path, 'utf8'));
      mutate(value);
      await writeFile(path, JSON.stringify(value));
    };
    const recover = async () => {
      const result = run();
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(await assertReceipt(verification, 'passed'), positive);
    };

    await t.test('unchanged replay preserves the complete receipt identity', async () => {
      await reset();
      await recover();
      assert.deepEqual(await readFile(verification), savedPositive);
    });

    const mutations = [
      ['malformed IR JSON', () => writeFile(ir, `{${secretSentinel}`)],
      ['malformed report JSON', () => writeFile(report, `{${secretSentinel}`)],
      ['missing IR', () => rm(ir)],
      ['missing report', () => rm(report)],
      ['IR digest substitution', () => alter(ir, (o) => { o.irId = '0'.repeat(64); })],
      ['stale report identity', () => alter(report, (o) => { o.runId = '0'.repeat(64); })],
      ['disabled differential evidence', () => alter(report, (o) => { o.differential.disabled = true; })],
      ['incomplete IR declaration scope', () => alter(ir, (o) => { o.admission.scope.complete = false; })],
      ['changed TypeSpec source', () => writeFile(typespec, `${files.get(typespec)}\nmodel Extra { value: string; }\n`)],
      ['changed authored schema', () => alter(authored, (o) => { o.$defs.Item.properties.id.type = 'number'; })],
      ['changed retained compiler witness', () => writeFile(witness, '{}\n')],
      ['missing TypeSpec source', () => rm(typespec)],
      ['missing authored schema', () => rm(authored)],
      ['missing retained witness', () => rm(witness)],
    ];
    for (const [name, mutate] of mutations) {
      await t.test(`${name}: positive -> failed -> recovered`, async () => {
        await reset();
        await mutate();
        assertRefused(run());
        await assertReceipt(verification, 'failed');
        for (const path of [typespec, authored, ir, report, witness]) await writeFile(path, files.get(path));
        await recover();
      });
    }
    for (const declarations of ['not-json', 'null', '[]', '["AdmissionBoundary.Item","AdmissionBoundary.Item"]',
      '["Other.Item"]', '[1]', '[" AdmissionBoundary.Item"]']) {
      await t.test(`reject consumer scope ${declarations}`, async () => {
        await reset();
        assertRefused(run({ TSJSV_VERIFY_DECLARATIONS: declarations }));
        await assertReceipt(verification, 'failed');
        await recover();
      });
    }
    await t.test('unexpected argv replaces stale passed evidence with a failure', async () => {
      await reset();
      assertRefused(run({}, ['--unexpected']));
      await assertReceipt(verification, 'failed');
      await recover();
    });

    for (const [key, path] of Object.entries(inputPaths)) {
      await t.test(`never overwrite explicitly configured ${key}, even if it looks like an owned receipt`, async () => {
        await reset();
        await writeFile(path, savedPositive);
        assertRefused(run({ TSJSV_VERIFY_VERIFICATION: path }));
        assert.deepEqual(await readFile(path), savedPositive, 'an alias error must not tombstone an input');
      });
    }
    for (const [key, directory] of [['TYPESPEC', dirname(typespec)], ['AUTHORED', dirname(authored)], ['GENERATED', generated]]) {
      await t.test(`do not create output or parent directories inside ${key} input`, async () => {
        await reset();
        const parent = join(directory, 'must-not-create');
        assertRefused(run({ [`TSJSV_VERIFY_${key}`]: directory, TSJSV_VERIFY_VERIFICATION: join(parent, 'receipt.json') }));
        await assert.rejects(lstat(parent), { code: 'ENOENT' });
      });
    }
    for (const key of ['IR', 'REPORT']) {
      await t.test(`refuse multiply linked ${key} evidence`, async () => {
        await reset();
        await link(inputPaths[key], join(workspace, `${key}-alias.json`));
        assertRefused(run());
        await assertReceipt(verification, 'failed');
        assert.deepEqual(await readFile(inputPaths[key]), files.get(inputPaths[key]));
      });
    }
    for (const key of Object.keys(inputPaths)) {
      await t.test(`refuse symlinked ${key} input and preserve target`, async () => {
        await reset();
        const alias = join(workspace, `${key}-link`);
        await symlink(inputPaths[key], alias);
        assertRefused(run({ [`TSJSV_VERIFY_${key}`]: alias }));
        await assertReceipt(verification, 'failed');
        assert.deepEqual(await readFile(inputPaths[key]), files.get(inputPaths[key]));
      });
    }
    await t.test('refuse symlinked input parent', async () => {
      await reset();
      const alias = join(workspace, 'authority-link');
      await symlink(dirname(authored), alias, 'dir');
      assertRefused(run({ TSJSV_VERIFY_AUTHORED: join(alias, 'authored.schema.json') }));
      await assertReceipt(verification, 'failed');
    });
    await t.test('refuse output outside workspace without touching it', async () => {
      await reset();
      assertRefused(run({ TSJSV_VERIFY_VERIFICATION: sentinel }));
      assert.equal(await readFile(sentinel, 'utf8'), 'caller-owned outside workspace\n');
    });
    await t.test('refuse symlinked output parent without touching its target', async () => {
      await reset();
      const alias = join(workspace, 'outside-link');
      await symlink(outside, alias, 'dir');
      assertRefused(run({ TSJSV_VERIFY_VERIFICATION: join(alias, 'new', 'receipt.json') }));
      assert.deepEqual(await readdir(outside), ['sentinel.json']);
    });
    await t.test('refuse output symlink and preserve target', async () => {
      await reset();
      await rm(verification);
      await symlink(sentinel, verification);
      assertRefused(run());
      assert.ok((await lstat(verification)).isSymbolicLink());
      assert.equal(await readFile(sentinel, 'utf8'), 'caller-owned outside workspace\n');
    });
    await t.test('refuse hard-linked output and preserve both names', async () => {
      await reset();
      const alias = join(workspace, 'verification-alias.json');
      await link(verification, alias);
      assertRefused(run());
      assert.deepEqual(await readFile(alias), savedPositive);
      assert.deepEqual(await readFile(verification), savedPositive);
    });
    for (const existing of ['caller-owned text\n', '{broken-json', JSON.stringify({schema: schemaId})]) {
      await t.test('refuse non-owned output without overwriting caller bytes', async () => {
        await reset();
        await writeFile(verification, existing);
        assertRefused(run());
        assert.equal(await readFile(verification, 'utf8'), existing);
      });
    }
    await t.test('refuse directory output without touching its contents', async () => {
      await reset();
      await rm(verification);
      await mkdir(verification);
      await writeFile(join(verification, 'keep'), 'caller-owned');
      assertRefused(run());
      assert.equal(await readFile(join(verification, 'keep'), 'utf8'), 'caller-owned');
    });
    await t.test('a fresh independent nested destination is allowed', async () => {
      await reset();
      const destination = join(workspace, 'new-evidence', 'nested', 'verification.json');
      const result = run({ TSJSV_VERIFY_VERIFICATION: destination });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(await assertReceipt(destination, 'passed'), positive);
      assert.deepEqual(await readdir(dirname(destination)), ['verification.json']);
      for (const path of Object.values(inputPaths)) assert.deepEqual(await readFile(path), files.get(path));
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
