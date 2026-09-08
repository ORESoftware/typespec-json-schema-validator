import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const draft202012 = 'https://json-schema.org/draft/2020-12/schema';

test('every shipped contract schema has one public package export', async () => {
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  const schemaFiles = (await readdir(resolve(packageRoot, 'schema')))
    .filter((name) => name.endsWith('.schema.json'))
    .sort();

  const schemaExports = Object.entries(packageJson.exports)
    .filter(([specifier]) => specifier.startsWith('./schema/'))
    .sort(([left], [right]) => left.localeCompare(right));

  const exportedFiles = schemaExports
    .map(([, target]) => target.replace('./schema/', ''))
    .sort();
  assert.deepEqual(exportedFiles, schemaFiles);

  for (const [specifier, target] of schemaExports) {
    const publicName = specifier.slice('./schema/'.length);
    assert.equal(target, `./schema/${publicName}.schema.json`);

    const schema = JSON.parse(await readFile(resolve(packageRoot, target), 'utf8'));
    assert.equal(schema.$schema, draft202012, `${target} must declare Draft 2020-12`);
    assert.equal(typeof schema.$id, 'string', `${target} must have a stable $id`);
    assert.doesNotThrow(() => new URL(schema.$id), `${target} must have an absolute $id`);
  }
});
