import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('TypeSpec remediation provenance matches the immutable production lockfile', async () => {
  const [provenance, lockfile, packageJson, exceptions] = await Promise.all([
    readJson('security/typespec-runtime-provenance.json'),
    readJson('package-lock.json'),
    readJson('package.json'),
    readJson('security/npm-audit-exceptions.json'),
  ]);

  assert.equal(provenance.schema, 'tjsv-typespec-runtime-provenance/v1');
  assert.equal(provenance.advisory, 'GHSA-2q42-4q24-7rgv');
  assert.equal(provenance.npm_advisory_id, 'npm:1193788');
  assert.equal(provenance.status, 'patched_release_pinned_pending_consumer_verification');
  assert.equal(provenance.audit_policy.production_high_critical_exceptions, 0);
  assert.equal(provenance.audit_policy.lockfile_required, true);
  assert.equal(exceptions.exceptions.length, 0);
  assert.deepEqual(exceptions.exceptions, [], 'patched release must not carry the expired advisory waiver');
  assert.equal(provenance.upstream_fix.pull_request, 11777);
  assert.equal(
    provenance.upstream_fix.merge_commit,
    'e0f67bdf3c5a0875dfa98b475648af37caac71a6',
  );

  const names = new Set();
  for (const expected of provenance.packages) {
    assert.equal(typeof expected.name, 'string');
    assert.equal(names.has(expected.name), false, `duplicate provenance entry for ${expected.name}`);
    names.add(expected.name);

    const locked = lockfile.packages[`node_modules/${expected.name}`];
    assert.ok(locked, `${expected.name} must be present in package-lock.json`);
    assert.equal(locked.version, expected.version, `${expected.name} version drift`);
    assert.equal(locked.resolved, expected.resolved, `${expected.name} resolved URL drift`);
    assert.equal(locked.integrity, expected.integrity, `${expected.name} integrity drift`);
  }

  assert.deepEqual(
    [...names].sort(),
    ['@typespec/asset-emitter', '@typespec/compiler', '@typespec/json-schema'].sort(),
  );
  assert.equal(packageJson.dependencies['@typespec/compiler'], '1.17.0');
  assert.equal(packageJson.dependencies['@typespec/json-schema'], '1.17.0');
  assert.equal(lockfile.lockfileVersion, 3);
  assert.equal(packageJson.version, lockfile.version, 'npm project version must match lock root');
  assert.equal(packageJson.version, lockfile.packages[''].version, 'root package lock identity drift');
  assert.equal(packageJson.engines.node, '>=22.18.0');
  assert.equal(provenance.upstream_fix.release_status, 'released_1.17.0');
  assert.equal(lockfile.packages[''].dependencies['@typespec/compiler'], '1.17.0');
  assert.equal(lockfile.packages[''].dependencies['@typespec/json-schema'], '1.17.0');
  for (const version of ['@typespec/compiler', '@typespec/json-schema']) {
    const locked = lockfile.packages[`node_modules/${version}`];
    assert.equal(locked.version, '1.17.0');
    assert.match(locked.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  }
});
