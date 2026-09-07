import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  buildContractIr, createContractIr, inventoryTypeSpec, loadSchemaCollection,
  verifyContractIr, verifyContractIrEvidence,
} from '../../src/index.mjs';

const root = resolve(import.meta.dirname, '../..');
const executable = join(root, 'bin/typespec-json-schema-validator.mjs');

test('compiler-backed Contract IR admission binds the exact source-file closure', async (t) => {
  await mkdir(join(root, 'tmp'), { recursive: true });
  const temp = await mkdtemp(join(root, 'tmp/contract-ir-input-closure-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const typespec = join(temp, 'main.tsp');
  const authoredSchema = join(temp, 'authored.schema.json');
  const generatedDir = join(temp, 'generated');
  const generatedSchema = join(generatedDir, 'typespec.generated.schema.json');
  const reportPath = join(temp, 'report.json');
  const irPath = join(temp, 'contract-ir.json');
  await copyFile(join(root, 'test/fixtures/pass/main.tsp'), typespec);
  await copyFile(join(root, 'test/fixtures/pass/authored.schema.json'), authoredSchema);
  const compile = () => {
    const result = spawnSync(process.execPath, [executable, 'check',
      `--typespec=${typespec}`, `--schema=${authoredSchema}`, `--output-dir=${generatedDir}`,
      `--report=${reportPath}`, `--contract-ir=${irPath}`, '--quiet'],
    { cwd: root, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  };
  compile();
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const contractIr = JSON.parse(await readFile(irPath, 'utf8'));
  const options = { report, typespec, authoredSchema, generatedSchema };
  const load = async () => ({
    report,
    typespecInventory: await inventoryTypeSpec(typespec),
    generatedCollection: await loadSchemaCollection(generatedSchema),
    authoredCollection: await loadSchemaCollection(authoredSchema),
  });
  await t.test('all four public admission APIs accept fresh compiler evidence', async () => {
    const evidence = await load();
    assert.deepEqual(createContractIr(evidence), contractIr);
    assert.deepEqual(await buildContractIr(options), contractIr);
    assert.equal(verifyContractIrEvidence({ ...evidence, contractIr }).status, 'passed');
    assert.equal((await verifyContractIr({ ...options, contractIr })).status, 'passed');
  });

  for (const [lane, file, collection] of [
    ['authoredJsonSchema', authoredSchema, 'authoredCollection'],
    ['generatedJsonSchema', generatedSchema, 'generatedCollection'],
  ]) {
    await t.test(`${lane}: formatting-only changes invalidate admission, not schema meaning`, async () => {
      const original = await readFile(file, 'utf8');
      const changed = `${JSON.stringify(JSON.parse(original))}\n\n`;
      assert.notEqual(changed, original);
      await writeFile(file, changed);
      try {
        const evidence = await load();
        assert.equal(evidence[collection].digest, report.inputs[lane].digest);
        assert.notEqual(evidence[collection].documents[0].sha256, report.inputs[lane].files[0].sha256);
        assert.throws(() => createContractIr(evidence), /source-file SHA-256 no longer matches/);
        await assert.rejects(buildContractIr(options), /source-file SHA-256 no longer matches/);
        for (const result of [
          verifyContractIrEvidence({ ...evidence, contractIr }),
          await verifyContractIr({ ...options, contractIr }),
        ]) {
          assert.equal(result.status, 'failed');
          assert.equal(result.admissible, false);
          assert.match(result.error, /source-file SHA-256 no longer matches/);
        }
        assert.equal(await readFile(file, 'utf8'), changed, 'verification must not rewrite a source');
      } finally {
        await writeFile(file, original);
      }
      assert.equal((await verifyContractIr({ ...options, contractIr })).status, 'passed');
    });
  }

  for (const lane of ['typespec', 'generatedJsonSchema', 'authoredJsonSchema']) {
    for (const [label, mutate] of [
      ['missing file', (files) => files.pop()],
      ['duplicate path', (files) => files.push({ ...files[0] })],
      ['incorrect hash', (files) => { files[0].sha256 = '0'.repeat(64); }],
    ]) await t.test(`${lane}: ${label} in receipt cannot authorize a new IR`, async () => {
      const alteredReport = structuredClone(report);
      mutate(alteredReport.inputs[lane].files);
      await assert.rejects(buildContractIr({ ...options, report: alteredReport }), /file evidence|source-file SHA-256/);
      const result = await verifyContractIr({ ...options, report: alteredReport, contractIr });
      assert.equal(result.status, 'failed');
      assert.equal(result.admissible, false);
    });
  }

  await t.test('rerunning parity after a formatting change produces fresh admissible evidence', async () => {
    const original = await readFile(authoredSchema, 'utf8');
    const changed = `${JSON.stringify(JSON.parse(original))}\n\n`;
    await writeFile(authoredSchema, changed);
    compile();
    const freshReport = JSON.parse(await readFile(reportPath, 'utf8'));
    const freshIr = JSON.parse(await readFile(irPath, 'utf8'));
    assert.equal(freshReport.status, 'passed');
    assert.notEqual(freshReport.inputs.authoredJsonSchema.files[0].sha256, report.inputs.authoredJsonSchema.files[0].sha256);
    assert.equal(freshReport.inputs.authoredJsonSchema.digest, report.inputs.authoredJsonSchema.digest);
    assert.equal((await verifyContractIr({ ...options, report: freshReport, contractIr: freshIr })).status, 'passed');
    assert.equal((await verifyContractIr({ ...options, report, contractIr: freshIr })).status, 'failed');
    assert.equal(await readFile(authoredSchema, 'utf8'), changed, 'compilation must not rewrite the authored authority');
  });
});
