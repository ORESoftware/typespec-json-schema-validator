import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('current TypeSpec provenance matches the patched lock and has no waiver', async () => {
  const [provenance, lockfile, packageJson, exceptions] = await Promise.all([
    readJson('security/typespec-runtime-provenance.json'),
    readJson('package-lock.json'),
    readJson('package.json'),
    readJson('security/npm-audit-exceptions.json'),
  ]);
  assert.equal(provenance.schema, 'tjsv-typespec-runtime-provenance/v1');
  assert.equal(provenance.advisory, 'GHSA-2q42-4q24-7rgv');
  assert.equal(provenance.npm_advisory_id, 'npm:1193788');
  assert.equal(provenance.status, 'remediated');
  assert.equal(provenance.audit_policy.production_high_critical_exceptions, 0);
  assert.equal(provenance.audit_policy.lockfile_required, true);
  assert.deepEqual(exceptions.exceptions, []);
  assert.equal(provenance.upstream_fix.pull_request, 11777);
  assert.equal(provenance.upstream_fix.merge_commit, 'e0f67bdf3c5a0875dfa98b475648af37caac71a6');
  assert.equal(provenance.upstream_fix.release_status, 'published_and_pinned');
  const names = new Set();
  for (const expected of provenance.packages) {
    assert.equal(names.has(expected.name), false);
    names.add(expected.name);
    const locked = lockfile.packages['node_modules/' + expected.name];
    assert.ok(locked);
    assert.equal(locked.version, expected.version);
    assert.equal(locked.resolved, expected.resolved);
    assert.equal(locked.integrity, expected.integrity);
  }
  assert.deepEqual([...names].sort(), ['@typespec/asset-emitter', '@typespec/compiler', '@typespec/json-schema'].sort());
  assert.equal(packageJson.dependencies['@typespec/compiler'], '1.17.0');
  assert.equal(packageJson.dependencies['@typespec/json-schema'], '1.17.0');
  assert.equal(packageJson.engines.node, '^22.18.0 || >=24.11.0');
  assert.equal(lockfile.packages[''].version, packageJson.version);
  assert.deepEqual(lockfile.packages[''].dependencies, packageJson.dependencies);
  assert.equal(lockfile.packages[''].engines.node, packageJson.engines.node);
  assert.equal(lockfile.packages['node_modules/@typespec/compiler/node_modules/@babel/code-frame'].version, '8.0.6');
  assert.equal(lockfile.lockfileVersion, 3);
});
