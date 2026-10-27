import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));

test('production Undici audit repair is consistently pinned at a patched 6.x version', () => {
  const locked = lock.packages['node_modules/undici'];
  assert.ok(locked, 'expected the production node-gyp Undici dependency');
  assert.equal(locked.version, manifest.overrides?.undici, 'lockfile must match the explicit security override');
  const parts = locked.version.split('.').map(Number);
  assert.equal(parts.length, 3);
  assert.equal(parts[0], 6, 'keep the current supported Undici 6.x major');
  assert.ok(parts[1] > 29 || (parts[1] === 29 && parts[2] >= 1),
    'Undici must contain the October 2026 6.29.1 security fixes');
  assert.equal(locked.resolved, `https://registry.npmjs.org/undici/-/undici-${locked.version}.tgz`);
  assert.match(locked.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(lock.packages['node_modules/node-gyp']?.dependencies?.undici, '^6.25.0');
});
