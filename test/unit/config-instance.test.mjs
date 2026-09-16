import assert from 'node:assert/strict';
import test from 'node:test';

import { validateConfigValue } from '../../src/config-instance.mjs';

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
  assert.equal(JSON.stringify(receipt).includes('version":2'), false);
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
