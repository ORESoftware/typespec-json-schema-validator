import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
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
quiet = true

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
  assert.equal(loaded.env.TSJSV_QUIET, true);
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
  const selected = loadConsumerManifestConfiguration({ cwd: root, command: 'check', contractId: 'admin' });
  assert.equal(selected.contractId, 'admin');
});

test('authority downgrades, unknown tables, duplicate IDs, invalid booleans, executable config, and path escapes are rejected', async () => {
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
    () => validateConsumerManifest(parseConsumerManifestToml(BASE.replace('quiet = true', 'quiet = "yes"'))),
    /defaults\.quiet must be a boolean/u,
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
