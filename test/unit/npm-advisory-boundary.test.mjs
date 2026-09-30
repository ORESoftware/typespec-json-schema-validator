import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');

async function read(path) {
  return readFile(resolve(root, path), 'utf8');
}

test('temporary GHSA-2q42-4q24-7rgv exception is bounded by the JSON Schema emitter path controls', async () => {
  const [packageText, lockText, emitterText, inventoryText, exceptionText] = await Promise.all([
    read('package.json'),
    read('package-lock.json'),
    read('src/emitter.mjs'),
    read('src/typespec-inventory.mjs'),
    read('security/npm-audit-exceptions.json'),
  ]);
  const packageJson = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  const exceptionLedger = JSON.parse(exceptionText);

  assert.equal(typeof packageJson.dependencies?.['@typespec/compiler'], 'string');
  assert.equal(typeof packageJson.dependencies?.['@typespec/json-schema'], 'string');
  assert.equal(packageJson.dependencies?.['@typespec/openapi3'], undefined);
  assert.equal(lock.packages?.['node_modules/@typespec/openapi3'], undefined);
  assert.match(emitterText, /import\.meta\.resolve\('@typespec\/json-schema'\)/u);
  assert.match(emitterText, /emit: \[emitterPath\]/u);
  assert.doesNotMatch(emitterText, /@typespec\/openapi3/u);
  assert.match(emitterText, /assertTypeSpecEmitterInputSafe\(entry\)/u);
  assert.match(emitterText, /basename\(bundleId\) !== bundleId/u);
  assert.match(inventoryText, /unsafe-escaped-identifier-path-separator/u);
  assert.deepEqual(
    exceptionLedger.exceptions.map(({ advisoryId, package: packageName, expiresAt }) => ({
      advisoryId,
      package: packageName,
      expiresAt,
    })),
    [{
      advisoryId: 'npm:1193788',
      package: '@typespec/compiler',
      expiresAt: '2026-10-14T04:00:00.000Z',
    }],
  );
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
