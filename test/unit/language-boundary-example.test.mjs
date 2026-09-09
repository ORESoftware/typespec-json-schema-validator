import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(
  new URL('../../examples/language-boundaries/manifest.json', import.meta.url),
  'utf8',
));

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
