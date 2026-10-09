import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');

async function read(path) {
  return readFile(resolve(root, path), 'utf8');
}

test('patched TypeSpec release is pinned and the advisory exception ledger is empty', async () => {
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

  assert.equal(packageJson.dependencies?.['@typespec/compiler'], '1.17.0');
  assert.equal(packageJson.dependencies?.['@typespec/json-schema'], '1.17.0');
  assert.equal(packageJson.engines?.node, '^22.18.0 || >=24.11.0');
  assert.equal(lock.packages?.['node_modules/@typespec/compiler']?.version, '1.17.0');
  assert.equal(lock.packages?.['node_modules/@typespec/compiler']?.integrity, 'sha512-Prj9o2bjoWNS9wJ6sUk532jGm8h2AtpQ/lCFH6dhcywiP7UTj9cJtNlDAHptAS9Irh3YJM2g5D4/7S/u/vcG8Q==');
  assert.equal(lock.packages?.['node_modules/@typespec/json-schema']?.version, '1.17.0');
  assert.equal(lock.packages?.['node_modules/@typespec/asset-emitter']?.version, '0.79.3');
  assert.equal(lock.packages?.['node_modules/@typespec/compiler/node_modules/@babel/code-frame']?.version, '8.0.6');
  assert.equal(lock.packages?.['node_modules/@typespec/compiler/node_modules/@babel/code-frame/node_modules/@babel/helper-validator-identifier']?.version, '8.0.6');
  assert.equal(lock.packages?.['node_modules/@typespec/compiler/node_modules/@babel/code-frame/node_modules/js-tokens']?.version, '10.0.0');
  assert.equal(packageJson.dependencies?.['@typespec/openapi3'], undefined);
  assert.equal(lock.packages?.['node_modules/@typespec/openapi3'], undefined);
  assert.match(emitterText, /import\.meta\.resolve\('@typespec\/json-schema'\)/u);
  assert.match(emitterText, /emit: \[emitterPath\]/u);
  assert.doesNotMatch(emitterText, /@typespec\/openapi3/u);
  assert.match(emitterText, /assertTypeSpecEmitterInputSafe\(entry\)/u);
  assert.match(emitterText, /basename\(bundleId\) !== bundleId/u);
  assert.match(inventoryText, /unsafe-escaped-identifier-path-separator/u);
  assert.deepEqual(exceptionLedger.exceptions, []);
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
