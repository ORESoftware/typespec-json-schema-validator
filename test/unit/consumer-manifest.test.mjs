import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CONSUMER_MANIFEST_MAX_BYTES,
  ConsumerManifestError,
  loadConsumerManifestConfiguration,
  validateConsumerManifest,
} from '../../src/consumer-manifest.mjs';
import { parseConsumerManifestToml } from '../../src/consumer-manifest-toml.mjs';

async function workspace(manifest) {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-manifest-'));
  await mkdir(join(root, '.git'));
  await mkdir(join(root, 'contracts'), { recursive: true });
  await mkdir(join(root, 'packages', 'client'), { recursive: true });
  await writeFile(join(root, '.ores-tjsv.toml'), manifest);
  return root;
}

const BASE = `
version = 1
default_contract = "api"

[authority]
typespec = "peer-authority"
json_schema = "peer-authority"

[defaults]
report = ".typespec-json-schema-validator/report.json"
probes = true
max_probes = 72

[[contracts]]
id = "api"
typespec = "contracts/main.tsp"
schema = "contracts/authored.schema.json"
output_dir = ".typespec-json-schema-validator/generated"
`;

test('discovers the consumer manifest to the git boundary and resolves repo-local paths', async () => {
  const root = await workspace(BASE);
  const loaded = loadConsumerManifestConfiguration({ cwd: join(root, 'packages', 'client'), command: 'check' });
  assert.equal(loaded.contractId, 'api');
  assert.equal(loaded.env.TSJSV_TYPESPEC, join(root, 'contracts', 'main.tsp'));
  assert.equal(loaded.env.TSJSV_AUTHORED_SCHEMA, join(root, 'contracts', 'authored.schema.json'));
  assert.equal(loaded.env.TSJSV_MAX_PROBES, 72);
  assert.equal(loaded.env.TSJSV_PROBES, true);
});

test('a single contract is selected without default_contract', async () => {
  const root = await workspace(BASE.replace('default_contract = "api"\n', ''));
  const loaded = loadConsumerManifestConfiguration({ cwd: root, command: 'inventory' });
  assert.equal(loaded.contractId, 'api');
});

test('multiple contracts fail closed unless explicitly selected or defaulted', async () => {
  const root = await workspace(`${BASE.replace('default_contract = "api"\n', '')}
[[contracts]]
id = "admin"
typespec = "contracts/admin.tsp"
schema = "contracts/admin.schema.json"
`);
  assert.throws(
    () => loadConsumerManifestConfiguration({ cwd: root, command: 'check' }),
    (error) => error instanceof ConsumerManifestError && error.message.includes('multiple contracts'),
  );
  assert.throws(
    () => loadConsumerManifestConfiguration({ cwd: root, command: 'check', contractId: '../admin' }),
    /contract selector is not a valid contract identifier/u,
  );
  const selected = loadConsumerManifestConfiguration({ cwd: root, command: 'check', contractId: 'admin' });
  assert.equal(selected.contractId, 'admin');
});

test('authority downgrades, unknown tables, duplicate IDs, executable config, and path escapes are rejected', async () => {
  assert.throws(
    () => validateConsumerManifest(parseConsumerManifestToml(`${BASE}\n[authority2]\nx = 1\n`)),
    /unsupported table/u,
  );
  assert.throws(
    () => validateConsumerManifest(parseConsumerManifestToml(BASE.replace('peer-authority', 'downstream'))),
    /must remain peer-authority/u,
  );
  assert.throws(
    () => validateConsumerManifest(parseConsumerManifestToml(`${BASE}
[[contracts]]
id = "api"
typespec = "contracts/second.tsp"
schema = "contracts/second.schema.json"
`)),
    /duplicate contract id/u,
  );
  assert.throws(
    () => validateConsumerManifest(parseConsumerManifestToml(BASE.replace(
      'report = ".typespec-json-schema-validator/report.json"',
      'report = ".typespec-json-schema-validator/report.json"\ntsp_bin = "tsp"',
    ))),
    /unsupported key tsp_bin/u,
  );
  const root = await workspace(BASE.replace('contracts/main.tsp', '../outside.tsp'));
  assert.throws(
    () => loadConsumerManifestConfiguration({ cwd: root, command: 'check' }),
    /must remain inside/u,
  );
});

test('restricted TOML parser admits BOM input but cannot hide special object keys', () => {
  const parsed = parseConsumerManifestToml(`\uFEFF${BASE}`);
  assert.equal(parsed.version, 1);

  for (const key of ['__proto__', '__section']) {
    const injected = BASE.replace('version = 1', `version = 1\n${key} = "hidden"`);
    assert.throws(
      () => validateConsumerManifest(parseConsumerManifestToml(injected)),
      new RegExp(`unsupported key ${key}`, 'u'),
    );
  }

  assert.throws(
    () => parseConsumerManifestToml("version = 1\nname = 'broken'literal'\n"),
    /invalid TOML literal string/u,
  );
});

test('consumer manifest input is bounded before parsing', async (t) => {
  const root = await workspace(BASE);
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, '.ores-tjsv.toml'),
    `#${'x'.repeat(CONSUMER_MANIFEST_MAX_BYTES)}`,
  );
  assert.throws(
    () => loadConsumerManifestConfiguration({ cwd: root, command: 'check' }),
    /consumer manifest exceeds/u,
  );
});

test('consumer manifest bytes must be valid UTF-8', async (t) => {
  const root = await workspace(BASE);
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '.ores-tjsv.toml'), Buffer.from([0x76, 0x65, 0x72, 0xff, 0x73]));
  assert.throws(
    () => loadConsumerManifestConfiguration({ cwd: root, command: 'check' }),
    /must contain valid UTF-8/u,
  );
});

test('manifest-owned paths cannot escape through an existing symlink ancestor', async (t) => {
  const root = await workspace(BASE.replace(
    'output_dir = ".typespec-json-schema-validator/generated"',
    'output_dir = "escape/generated"',
  ));
  const outside = await mkdtemp(join(tmpdir(), 'tjsv-manifest-outside-'));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]));

  try {
    await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('runner does not permit directory symlinks');
      return;
    }
    throw error;
  }

  assert.throws(
    () => loadConsumerManifestConfiguration({ cwd: root, command: 'check' }),
    /after resolving symlinks/u,
  );
});

test('a dangling manifest symlink fails closed instead of falling through discovery', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-manifest-link-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.git'));
  try {
    await symlink('missing-manifest.toml', join(root, '.ores-tjsv.toml'), 'file');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('runner does not permit file symlinks');
      return;
    }
    throw error;
  }
  assert.throws(
    () => loadConsumerManifestConfiguration({ cwd: root, command: 'check' }),
    /regular, non-symlink/u,
  );
});
