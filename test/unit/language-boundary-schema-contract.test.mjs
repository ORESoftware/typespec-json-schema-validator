import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

test('boundary schemas are closed Draft 2020-12 contracts with stable identities', async () => {
  const [manifest, evidence, verification] = await Promise.all([
    json('../../schema/language-boundary-manifest.schema.json'),
    json('../../schema/language-boundary-evidence.schema.json'),
    json('../../schema/language-boundary-verification.schema.json'),
  ]);
  for (const schema of [manifest, evidence, verification]) {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
    assert.match(schema.$id, /^https:\/\/schemas\.oresoftware\.com\//u);
  }
  assert.equal(manifest.properties.authorities.properties.typeSpec.const, 'peer');
  assert.equal(manifest.properties.authorities.properties.jsonSchema.const, 'peer');
  assert.equal(manifest.properties.authorities.properties.generatedWitness.const, 'evidence_only');
  assert.equal(evidence.properties.contractIrId.$ref, '#/$defs/digest');
  assert.equal(evidence.properties.receiptRunId.$ref, '#/$defs/digest');
  assert.ok(verification.required.includes('verificationId'));
});

test('package exports code, types, and all boundary schemas', async () => {
  const pkg = await json('../../package.json');
  assert.deepEqual(pkg.exports['./language-boundary-verification'], {
    import: './src/language-boundary-verification.mjs',
    types: './src/language-boundary-verification.d.mts',
  });
  assert.equal(
    pkg.exports['./schema/language-boundary-manifest'],
    './schema/language-boundary-manifest.schema.json',
  );
  assert.equal(
    pkg.exports['./schema/language-boundary-evidence'],
    './schema/language-boundary-evidence.schema.json',
  );
  assert.equal(
    pkg.exports['./schema/language-boundary-verification'],
    './schema/language-boundary-verification.schema.json',
  );
});
