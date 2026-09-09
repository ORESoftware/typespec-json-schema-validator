import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

const schemaCases = [
  ['language-boundary-manifest', 'ores.typespec-json-schema-validator.language-boundaries/v1'],
  ['language-boundary-evidence', 'ores.typespec-json-schema-validator.language-boundary-evidence/v1'],
  ['language-boundary-verification', 'ores.typespec-json-schema-validator.language-boundary-verification/v1'],
];

test('package exports the boundary verifier and all three versioned schemas', () => {
  assert.deepEqual(packageJson.exports['./language-boundary-verification'], {
    import: './src/language-boundary-verification.mjs',
    types: './src/language-boundary-verification.d.mts',
  });
  for (const [name] of schemaCases) {
    assert.equal(
      packageJson.exports[`./schema/${name}`],
      `./schema/${name}.schema.json`,
    );
  }
});

test('schema documents are Draft 2020-12 and bind their protocol identifiers', async () => {
  for (const [name, protocol] of schemaCases) {
    const schema = JSON.parse(
      await readFile(new URL(`schema/${name}.schema.json`, root), 'utf8'),
    );
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.properties.schema.const, protocol);
    assert.equal(schema.additionalProperties, false);
  }
});

test('published package boundary retains source, schemas, and documentation', () => {
  assert.ok(packageJson.files.includes('src'));
  assert.ok(packageJson.files.includes('schema'));
  assert.ok(packageJson.files.includes('docs'));
});
