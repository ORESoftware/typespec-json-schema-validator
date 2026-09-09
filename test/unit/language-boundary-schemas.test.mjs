import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import { validateJsonSchemaDocument } from '../../src/json-schema.mjs';
import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

async function schema(name) {
  return JSON.parse(await readFile(new URL(`../../schema/${name}`, import.meta.url), 'utf8'));
}

function validate(document, instance, path) {
  const resolver = new SchemaResolver();
  const record = resolver.addDocument(document, path);
  return validateInstance({ schema: document, instance, resolver, base: record.base });
}

test('all three boundary schemas are structurally valid Draft 2020-12 documents', async () => {
  for (const name of [
    'language-boundary-manifest.schema.json',
    'language-boundary-evidence.schema.json',
    'language-boundary-verification.schema.json',
  ]) {
    assert.deepEqual(validateJsonSchemaDocument(await schema(name), name), [], name);
  }
});

test('manifest schema accepts explicit booleans and rejects string substitutes', async () => {
  const document = await schema('language-boundary-manifest.schema.json');
  const manifest = {
    schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
    minimumDistinctLanguages: 2,
    authorities: {
      typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only',
    },
    targets: [{
      language: 'rust', runtime: 'native', required: true,
      ingress: true, egress: true, evidence: 'rust/native.json',
    }],
  };
  assert.equal(validate(document, manifest, 'manifest.schema.json').valid, true);
  assert.equal(validate(document, {
    ...manifest,
    targets: [{ ...manifest.targets[0], required: 'true' }],
  }, 'manifest.schema.json').valid, false);
});

test('evidence schema binds immutable source, artifact, receipt, and Contract IR identities', async () => {
  const document = await schema('language-boundary-evidence.schema.json');
  const evidence = {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language: 'rust',
    runtime: 'native',
    status: 'passed',
    sourceRevision: 'a'.repeat(40),
    artifactDigest: `sha256:${'b'.repeat(64)}`,
    contractIrId: 'c'.repeat(64),
    receiptRunId: 'd'.repeat(64),
    toolchain: { name: 'rustc', version: '1.95.0' },
    generator: { name: 'api-docs', version: '1' },
    validation: { ingress: 'passed', egress: 'passed' },
  };
  assert.equal(validate(document, evidence, 'evidence.schema.json').valid, true);
  assert.equal(validate(document, {
    ...evidence,
    sourceRevision: 'main',
  }, 'evidence.schema.json').valid, false);
});

test('verification schema accepts the deterministic fail-closed receipt', async () => {
  const document = await schema('language-boundary-verification.schema.json');
  const receipt = verifyLanguageBoundaries();
  assert.equal(validate(document, receipt, 'verification.schema.json').valid, true);
});
