import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { loadSchemaCollection, sha256 } from '../../src/index.mjs';
import {
  createProjectionManifest, hashProjectionFiles, verifyProjectionManifestWithCurrentFiles,
} from '../../src/projection-admission/index.mjs';

const root = resolve(import.meta.dirname, '../..');
const executable = join(root, 'bin/typespec-json-schema-validator.mjs');

function assertStopped(result, rule) {
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.admissible, false);
  assert.ok(result.findings.length > 0);
  if (rule) assert.ok(result.findings.some((finding) => finding.ruleId === rule), JSON.stringify(result));
}

test('current-files projection admission verifies real compiler evidence and observed artifacts', async (t) => {
  await mkdir(join(root, 'tmp'), { recursive: true });
  const temp = await mkdtemp(join(root, 'tmp/projection-current-files-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  for (const name of ['main.tsp', 'authored.schema.json']) {
    await copyFile(join(root, 'test/fixtures/pass', name), join(temp, name));
  }
  const compile = () => {
    const result = spawnSync(process.execPath, [executable, 'check',
      `--typespec=${join(temp, 'main.tsp')}`, `--schema=${join(temp, 'authored.schema.json')}`,
      `--output-dir=${join(temp, 'generated')}`, `--report=${join(temp, 'report.json')}`,
      `--contract-ir=${join(temp, 'contract-ir.json')}`, '--quiet'],
    { cwd: root, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  };
  compile();
  const parityReceipt = JSON.parse(await readFile(join(temp, 'report.json'), 'utf8'));
  const contractIr = JSON.parse(await readFile(join(temp, 'contract-ir.json'), 'utf8'));
  const inputPaths = {
    operationInventory: 'operations.json',
    projectionMetadata: 'projection-lock.json',
    emitterConfiguration: 'emitter.json',
  };
  for (const [role, path] of Object.entries(inputPaths)) await writeFile(join(temp, path), JSON.stringify({ fixtureRole: role }));
  await mkdir(join(temp, 'outputs'));
  // An explicit test artifact, not a claim of a production transport emitter.
  await writeFile(join(temp, 'outputs/model.json'), '{"fixture":true}\n');
  const outputFiles = [{ path: 'outputs/model.json', mediaType: 'application/json', projection: 'fixture-json' }];
  const expectedDeclarations = contractIr.declarations.map((declaration) => declaration.id);
  const requiredToolchains = [{ id: 'fixture-emitter', version: '1.0.0', artifactDigest: sha256('test-emitter-identity') }];
  const requiredProjections = ['fixture-json'];
  async function manifestFor(ir, receipt) {
    const observations = await hashProjectionFiles(temp, [
      ...Object.values(inputPaths).map((path) => ({ path })), ...outputFiles,
    ]);
    const files = new Map(observations.map((file) => [file.path, file]));
    return createProjectionManifest({
      contractIr: ir, parityReceipt: receipt,
      expectedSourceDigests: Object.fromEntries(['typespec', 'generatedJsonSchema', 'authoredJsonSchema']
        .map((lane) => [lane, receipt.inputs[lane].digest])),
      inputs: Object.fromEntries(Object.entries(inputPaths).map(([key, path]) => [key, files.get(path)])),
      toolchains: requiredToolchains,
      projections: [{ id: 'fixture-json', emitter: 'fixture-emitter', declarationIds: expectedDeclarations,
        outputPaths: outputFiles.map((file) => file.path), representationDeltaIds: [], runtimeValidatorIds: [] }],
      outputs: outputFiles.map((file) => files.get(file.path)),
    });
  }
  const manifest = await manifestFor(contractIr, parityReceipt);
  const options = { root: temp, manifest, contractIr, parityReceipt, expectedDeclarations,
    typespec: 'main.tsp', authoredSchema: 'authored.schema.json', generatedSchema: 'generated/typespec.generated.schema.json',
    inputPaths, outputFiles, requiredToolchains, requiredProjections };
  const run = (overrides = {}) => verifyProjectionManifestWithCurrentFiles({ ...options, ...overrides });
  await t.test('fresh evidence passes deterministically without mutating caller input', async () => {
    const before = JSON.stringify(options);
    const first = await run();
    assert.equal(first.status, 'passed', JSON.stringify(first));
    assert.equal(first.admissible, true);
    assert.equal(first.contractIrId, contractIr.irId);
    assert.deepEqual(await run(), first);
    assert.equal(JSON.stringify(options), before);
  });
  for (const [label, path, transform, aggregateLane] of [
    ['TypeSpec source', 'main.tsp', (text) => `${text}\n// changed source bytes\n`, null],
    ['authored source formatting', 'authored.schema.json', (text) => `${JSON.stringify(JSON.parse(text))}\n\n`, 'authoredJsonSchema'],
    ['generated witness formatting', options.generatedSchema, (text) => `${JSON.stringify(JSON.parse(text))}\n\n`, 'generatedJsonSchema'],
    ['operation inventory', inputPaths.operationInventory, (text) => `${text}\n`, null],
    ['projection metadata', inputPaths.projectionMetadata, (text) => `${text}\n`, null],
    ['emitter configuration', inputPaths.emitterConfiguration, (text) => `${text}\n`, null],
    ['projection output', outputFiles[0].path, () => '{"fixture":false}\n', null],
  ]) await t.test(`rejects changed ${label} under an unchanged passed manifest`, async () => {
    const file = join(temp, path);
    const original = await readFile(file, 'utf8');
    const changed = transform(original);
    assert.notEqual(changed, original);
    await writeFile(file, changed);
    try {
      if (aggregateLane) assert.equal((await loadSchemaCollection(file)).digest, parityReceipt.inputs[aggregateLane].digest);
      assertStopped(await run());
      assert.equal(await readFile(file, 'utf8'), changed);
    } finally { await writeFile(file, original); }
    assert.equal((await run()).status, 'passed');
  });
  for (const key of ['typespec', 'generatedSchema', 'authoredSchema', 'root', 'inputPaths', 'outputFiles']) {
    await t.test(`refuses missing ${key}; never falls back to receipt/manifest paths`, async () => {
      assertStopped(await run({ [key]: undefined }));
    });
  }
  for (const expected of [undefined, [], ['Example.User'], ['Example.User', 'Example.User']]) {
    await t.test(`requires complete explicit declaration scope ${JSON.stringify(expected)}`, async () => {
      assertStopped(await run({ expectedDeclarations: expected }), 'projection-current-files-contract-invalid');
    });
  }
  for (const key of ['expectedSourceDigests', 'expectedInputs', 'actualOutputs', 'contractIrVerification', 'verifier']) {
    await t.test(`rejects externally supplied observation override ${key}`, async () => {
      assertStopped(await run({ [key]: {} }), 'projection-current-files-configuration-invalid');
    });
  }
  await t.test('requires independently configured toolchains and projections', async () => {
    assertStopped(await run({ requiredToolchains: undefined }));
    assertStopped(await run({ requiredToolchains: [{ ...requiredToolchains[0], artifactDigest: '0'.repeat(64) }] }));
    assertStopped(await run({ requiredProjections: [] }));
  });
  await t.test('rejects tampered IR and receipt without emitting their content', async () => {
    const alteredIr = structuredClone(contractIr); alteredIr.irId = '0'.repeat(64);
    assertStopped(await run({ contractIr: alteredIr }));
    const alteredReceipt = structuredClone(parityReceipt); alteredReceipt.runId = '0'.repeat(64);
    assertStopped(await run({ parityReceipt: alteredReceipt }));
  });
  await t.test('rejects manifest tampering through the existing verifier', async () => {
    const altered = structuredClone(manifest); altered.manifestId = '0'.repeat(64);
    assertStopped(await run({ manifest: altered }), 'projection-manifest-id-mismatch');
  });
  await t.test('refuses missing, unlisted and duplicated output inventory', async () => {
    assertStopped(await run({ outputFiles: [] }));
    assertStopped(await run({ outputFiles: [...outputFiles, ...outputFiles] }));
    await writeFile(join(temp, 'outputs/extra.json'), '{}');
    assertStopped(await run({ outputFiles: [...outputFiles, { ...outputFiles[0], path: 'outputs/extra.json' }] }));
    await rm(join(temp, 'outputs/extra.json'));
    await rename(join(temp, outputFiles[0].path), join(temp, 'saved.json'));
    try { assertStopped(await run()); }
    finally { await rename(join(temp, 'saved.json'), join(temp, outputFiles[0].path)); }
  });
  await t.test('rejects symlinked output ancestors', async () => {
    await rename(join(temp, 'outputs'), join(temp, 'saved-outputs'));
    await symlink(join(temp, 'saved-outputs'), join(temp, 'outputs'), 'dir');
    try { assertStopped(await run(), 'projection-current-files-files-invalid'); }
    finally { await rm(join(temp, 'outputs')); await rename(join(temp, 'saved-outputs'), join(temp, 'outputs')); }
  });
  await t.test('invalid limits fail closed without filesystem exception text', async () => {
    assertStopped(await run({ fileLimits: { maxBytes: NaN } }), 'projection-current-files-files-invalid');
    const stopped = await run({ outputFiles: [{ ...outputFiles[0], path: 'secret-marker-missing.json' }] });
    assertStopped(stopped);
    assert.ok(!JSON.stringify(stopped).includes('secret-marker'));
    assert.ok(!JSON.stringify(stopped).includes(temp));
  });
  await t.test('snapshots caller-controlled objects before asynchronous observation', async () => {
    const copied = structuredClone(options);
    const pending = verifyProjectionManifestWithCurrentFiles(copied);
    copied.contractIr.irId = '0'.repeat(64);
    copied.outputFiles[0].path = '../outside';
    assert.equal((await pending).status, 'passed');
  });
  await t.test('explicit current paths allow relocation of an identical checkout', async () => {
    const relocated = await mkdtemp(join(root, 'tmp/projection-relocated-'));
    t.after(() => rm(relocated, { recursive: true, force: true }));
    await cp(temp, relocated, { recursive: true });
    assert.deepEqual(await run({ root: relocated }), await run());
  });
  await t.test('fresh parity and a fresh manifest recover from a formatting-only source edit', async () => {
    const authored = join(temp, 'authored.schema.json');
    const original = await readFile(authored, 'utf8');
    await writeFile(authored, `${JSON.stringify(JSON.parse(original))}\n\n`);
    assertStopped(await run());
    compile();
    const freshReceipt = JSON.parse(await readFile(join(temp, 'report.json'), 'utf8'));
    const freshIr = JSON.parse(await readFile(join(temp, 'contract-ir.json'), 'utf8'));
    const freshManifest = await manifestFor(freshIr, freshReceipt);
    assert.equal((await run({ contractIr: freshIr, parityReceipt: freshReceipt, manifest: freshManifest })).status, 'passed');
    assertStopped(await run({ contractIr: freshIr, parityReceipt: freshReceipt }));
  });
});

for (const options of [undefined, null, [], 'invalid', { root: '/unused', verifier: () => {} }]) {
  test('malformed current-files requests return bounded deterministic refusals', async () => {
    const result = await verifyProjectionManifestWithCurrentFiles(options);
    assertStopped(result, 'projection-current-files-configuration-invalid');
    assert.deepEqual(await verifyProjectionManifestWithCurrentFiles(options), result);
    assert.equal(result.contractIrId, null);
    assert.ok(Object.isFrozen(result));
  });
}
