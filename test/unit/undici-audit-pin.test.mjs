import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));

const PATCHED_UNDICI = '6.29.1';
const EXPECTED_INTEGRITY = 'sha512-EvRlUt/QqAEvXdQeRMYUfwOQsfzpDztykrG2owGEE/rBOBoYv9uF39ZzsNDh4lTFHhTr2XOZjKkYgueD12ZmGA==';

function assertPatchedUndiciClosure(packageJson, packageLock) {
  assert.equal(packageJson.overrides?.undici, PATCHED_UNDICI,
    'manifest must explicitly override transitive Undici with the approved patched version');
  assert.equal(packageLock.lockfileVersion, 3);
  const undiciEntries = Object.entries(packageLock.packages ?? {}).filter(([path]) =>
    path === 'node_modules/undici' || path.endsWith('/node_modules/undici'));
  assert.ok(undiciEntries.length > 0, 'must find the production node-gyp Undici dependency');

  for (const [path, dependency] of undiciEntries) {
    assert.equal(dependency.version, PATCHED_UNDICI, `${path}: vulnerable or unreviewed Undici version`);
    assert.equal(dependency.resolved,
      `https://registry.npmjs.org/undici/-/undici-${PATCHED_UNDICI}.tgz`,
      `${path}: package must resolve to the reviewed npm registry tarball`);
    assert.equal(dependency.integrity, EXPECTED_INTEGRITY,
      `${path}: integrity must equal the registry-published, reviewed SHA-512 digest`);
  }
  assert.equal(packageLock.packages['node_modules/node-gyp']?.dependencies?.undici, '^6.25.0',
    'review the transitive dependency authority again if node-gyp changes');
}

test('production Undici lock and override use approved patched version and tarball digest', () => {
  assertPatchedUndiciClosure(manifest, lock);
});

test('reject a manifest override downgrade or removal', () => {
  for (const override of ['6.28.1', undefined]) {
    const altered = structuredClone(manifest);
    if (override) altered.overrides.undici = override;
    else delete altered.overrides.undici;
    assert.throws(() => assertPatchedUndiciClosure(altered, lock), /override|patched version/);
  }
});

test('reject a vulnerable nested Undici copy even when the root package is patched', () => {
  const altered = structuredClone(lock);
  altered.packages['node_modules/sample/node_modules/undici'] = {
    ...altered.packages['node_modules/undici'], version: '6.28.1',
  };
  assert.throws(() => assertPatchedUndiciClosure(manifest, altered), /vulnerable or unreviewed/);
});

test('reject altered tarball location or digest', () => {
  const badUrl = structuredClone(lock);
  badUrl.packages['node_modules/undici'].resolved = 'https://example.invalid/undici.tgz';
  assert.throws(() => assertPatchedUndiciClosure(manifest, badUrl), /registry tarball/);

  const badDigest = structuredClone(lock);
  badDigest.packages['node_modules/undici'].integrity = 'sha512-AAAA';
  assert.throws(() => assertPatchedUndiciClosure(manifest, badDigest), /registry-published/);
});
