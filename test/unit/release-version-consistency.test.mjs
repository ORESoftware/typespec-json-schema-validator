import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
const zed = readFileSync(new URL('.zpkg.toml', root), 'utf8');
const packageHeader = zed.match(/^\\[package\\]\\s*\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))/m);
const zedVersion = packageHeader?.[1]?.match(/^version\\s*=\\s*"([^"]+)"\\s*$/m)?.[1];

test('npm manifest, lock root and Zed package release versions agree', () => {
  assert.match(pkg.version, /^\\d+\\.\\d+\\.\\d+$/);
  assert.equal(lock.version, pkg.version, 'npm lock version must match release package');
  assert.equal(lock.packages?.['']?.version, pkg.version, 'npm lock root entry must match');
  assert.equal(zedVersion, pkg.version, 'Zed release manifest must match npm version');
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages?.['']?.name, pkg.name);
});
