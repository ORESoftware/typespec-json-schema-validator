import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');

async function read(path) {
  return readFile(resolve(root, path), 'utf8');
}

test('temporary GHSA-2q42-4q24-7rgv exception excludes the vulnerable OpenAPI3 emitter path', async () => {
  const [packageText, lockText, emitterText] = await Promise.all([
    read('package.json'),
    read('package-lock.json'),
    read('src/emitter.mjs'),
  ]);
  const packageJson = JSON.parse(packageText);
  const lock = JSON.parse(lockText);

  assert.equal(typeof packageJson.dependencies?.['@typespec/compiler'], 'string');
  assert.equal(typeof packageJson.dependencies?.['@typespec/json-schema'], 'string');
  assert.equal(packageJson.dependencies?.['@typespec/openapi3'], undefined);
  assert.equal(lock.packages?.['node_modules/@typespec/openapi3'], undefined);
  assert.match(emitterText, /import\.meta\.resolve\('@typespec\/json-schema'\)/u);
  assert.match(emitterText, /emit: \[emitterPath\]/u);
  assert.doesNotMatch(emitterText, /@typespec\/openapi3/u);
});

test('default compiler CLI is coupled to the pinned emitter dependency tree', async () => {
  const emitterText = await read('src/emitter.mjs');

  assert.match(
    emitterText,
    /export function resolveCompilerCliForEmitter\(resolvedEmitterPath = resolveJsonSchemaEmitter\(\)\)/u,
  );
  assert.match(
    emitterText,
    /const compilerPath = resolveCompilerForEmitter\(resolvedEmitterPath\);/u,
  );
  assert.match(
    emitterText,
    /return join\(compilerRoot, 'node_modules', '@typespec', 'compiler', 'cmd', 'tsp\.js'\);/u,
  );
  assert.match(emitterText, /return resolveCompilerCliForEmitter\(\);/u);
  assert.doesNotMatch(
    emitterText,
    /join\(process\.cwd\(\), 'node_modules', '\.bin', executable\)/u,
    'consumer workspace must not influence the default TypeSpec compiler selection',
  );
});
