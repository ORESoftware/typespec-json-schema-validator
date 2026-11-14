import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import { validateJsonSchemaDocument } from '../../src/json-schema.mjs';

const manifest = JSON.parse(await readFile(
  new URL('../../examples/language-boundaries/manifest.json', import.meta.url),
  'utf8',
));
const manifestSchema = JSON.parse(await readFile(
  new URL('../../schema/language-boundaries.schema.json', import.meta.url),
  'utf8',
));

test('five-runtime example conforms to the current Draft 2020-12 manifest contract', () => {
  assert.deepEqual(
    validateJsonSchemaDocument(manifestSchema, 'schema/language-boundaries.schema.json'),
    [],
  );

  const resolver = new SchemaResolver();
  const record = resolver.addDocument(manifestSchema, 'schema/language-boundaries.schema.json');
  const validation = validateInstance({
    schema: manifestSchema,
    instance: manifest,
    resolver,
    base: record.base,
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test('example requires the five primary language/runtime boundaries', () => {
  assert.equal(manifest.minimumDistinctLanguages, 5);
  assert.deepEqual(
    manifest.targets.map(({ language, runtime }) => `${language}/${runtime}`),
    [
      'rust/native',
      'typescript/node',
      'dart/flutter',
      'go/native',
      'gleam/beam',
    ],
  );
  assert.ok(manifest.targets.every((target) => (
    target.required === true
      && target.ingress === true
      && target.egress === true
      && target.evidence.endsWith('.json')
  )));
  assert.deepEqual(manifest.authorities, {
    typeSpec: 'peer',
    jsonSchema: 'peer',
    generatedWitness: 'evidence_only',
  });
});
