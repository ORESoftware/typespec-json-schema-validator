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

test('pinned action compiler binary is preferred over a caller-workspace compiler', async () => {
  const emitterText = await read('src/emitter.mjs');
  const pinned = emitterText.indexOf("join(MODULE_ROOT, 'node_modules', '.bin', executable)");
  const caller = emitterText.indexOf("join(process.cwd(), 'node_modules', '.bin', executable)");
  assert.ok(pinned >= 0, 'missing module-root compiler candidate');
  assert.ok(caller >= 0, 'missing caller-workspace compatibility candidate');
  assert.ok(pinned < caller, 'caller workspace must not shadow the action lockfile-pinned compiler');
});
