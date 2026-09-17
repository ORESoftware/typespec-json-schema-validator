import assert from 'node:assert/strict';
import { link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadCliConfiguration } from '../../src/cli-config.mjs';
import {
  validateConfigJsonFile,
  validateConfigValue,
} from '../../src/config-instance.mjs';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'enabled'],
  properties: {
    version: { const: 1 },
    enabled: { type: 'boolean' },
  },
};

test('build mode fails closed when a config instance drifts', () => {
  const receipt = validateConfigValue({
    schema,
    instance: { version: 2, enabled: true },
    schemaSource: 'authored.schema.json',
    instanceSource: '.ores-example.toml',
    mode: 'build',
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.mode, 'build');
  assert.ok(receipt.errors.length > 0);
  assert.equal(JSON.stringify(receipt).includes('version\":2'), false);
});

test('runtime mode reports the same drift as a warning', () => {
  const receipt = validateConfigValue({
    schema,
    instance: { version: 2, enabled: true },
    schemaSource: 'authored.schema.json',
    instanceSource: '.ores-example.toml',
    mode: 'runtime',
  });
  assert.equal(receipt.status, 'warning');
  assert.equal(receipt.mode, 'runtime');
  assert.ok(receipt.errors.length > 0);
});

test('valid config passes in both modes', () => {
  for (const mode of ['build', 'runtime']) {
    const receipt = validateConfigValue({
      schema,
      instance: { version: 1, enabled: true },
      mode,
    });
    assert.equal(receipt.status, 'passed');
    assert.deepEqual(receipt.errors, []);
  }
});

test('unsupported authored schema behavior is warning-only at runtime', () => {
  const dynamicSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $dynamicRef: '#node',
  };
  const receipt = validateConfigValue({
    schema: dynamicSchema,
    instance: {},
    mode: 'runtime',
  });
  assert.equal(receipt.status, 'warning');
  assert.ok(receipt.refusal || receipt.schemaFindings.length > 0);
});

test('config CLI is parsed only through the root flags-2-env contract', () => {
  const config = loadCliConfiguration([
    'node',
    'tjsv',
    'config',
    '--schema',
    'authored.schema.json',
    '--instance=-',
    '--mode=runtime',
    '--max-errors=7',
    '--format-assertion',
  ]);
  assert.equal(config.command, 'config');
  assert.equal(config.authoredSchema, 'authored.schema.json');
  assert.equal(config.configInstance, '-');
  assert.equal(config.configMode, 'runtime');
  assert.equal(config.maxErrors, 7);
  assert.equal(config.formatAssertion, true);
});

test('config CLI rejects unknown options and invalid bounds', () => {
  assert.throws(() => loadCliConfiguration([
    'node', 'tjsv', 'config', '--schema', 'a.json', '--validator', 'sh',
  ]), /flags-2-env rejected/u);
  assert.throws(() => loadCliConfiguration([
    'node', 'tjsv', 'config', '--schema', 'a.json', '--max-errors', '257',
  ]), /max-errors/u);
});

test('direct config admission rejects hardlinked schema authority', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const schemaPath = join(root, 'authored.schema.json');
  const aliasPath = join(root, 'alias.schema.json');
  const instancePath = join(root, 'config.json');
  await writeFile(schemaPath, JSON.stringify(schema));
  await link(schemaPath, aliasPath);
  await writeFile(instancePath, JSON.stringify({ version: 1, enabled: true }));
  await assert.rejects(
    validateConfigJsonFile({ schemaPath, instancePath }),
    /must not have multiple hard links/u,
  );
});

test('direct config admission rejects invalid UTF-8 without reflecting bytes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-config-utf8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const schemaPath = join(root, 'authored.schema.json');
  const instancePath = join(root, 'config.json');
  await writeFile(schemaPath, JSON.stringify(schema));
  await writeFile(instancePath, Buffer.from([0xff, 0xfe, 0xfd]));
  await assert.rejects(
    validateConfigJsonFile({ schemaPath, instancePath }),
    /must be valid UTF-8/u,
  );
});
