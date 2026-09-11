import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('tjsv is canonical while compatibility aliases remain', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin.tjsv, './bin/typespec-json-schema-validator.mjs');
  assert.equal(pkg.bin.tsjsv, pkg.bin.tjsv);
  assert.equal(pkg.bin['typespec-json-schema-validator'], pkg.bin.tjsv);
});

test('Zed retains and binds the package-owned flags contract', async () => {
  const manifest = (await readFile(new URL('../../.zpkg.toml', import.meta.url), 'utf8'))
    .replace(/\r\n?/gu, '\n');
  assert.ok(manifest.includes('[bin]'));
  assert.ok(manifest.includes('tjsv = "bin/typespec-json-schema-validator.mjs"'));
  assert.ok(manifest.includes('[interop.flags-2-env]'));
  assert.ok(manifest.includes('config = ".cli-flags.toml"'));
  assert.ok(manifest.includes('bins = ["tjsv", "tsjsv", "typespec-json-schema-validator"]'));
  assert.ok(manifest.includes('".cli-flags.toml"'));

  const smokeTestLine = manifest
    .split('\n')
    .find((line) => line.startsWith('smoke_test = '));
  assert.equal(
    smokeTestLine,
    'smoke_test = \'node "$ZED_PKG_TEST_TARGET/bin/typespec-json-schema-validator.mjs" doctor --quiet\'',
    'the Zed smoke command must remain a valid TOML literal string',
  );
});
