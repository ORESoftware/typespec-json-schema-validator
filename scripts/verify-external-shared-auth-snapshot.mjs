#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const fixtureRoot = resolve('test/fixtures/external/shared-auth-config');
const consumerRoot = join(fixtureRoot, 'consumer');
const manifest = JSON.parse(await readFile(join(fixtureRoot, 'source-manifest.json'), 'utf8'));

if (manifest.schema !== 'ores.tjsv.external-consumer-snapshot/v1') throw new Error('unsupported external consumer snapshot schema');
if (manifest.sourceRepository !== 'shared-auth/shared-auth-interfaces') throw new Error('unexpected external consumer repository');
if (!/^[0-9a-f]{40}$/.test(manifest.sourceRevision ?? '')) throw new Error('external consumer source revision is not an immutable full SHA');
if (!manifest.fileBlobs || typeof manifest.fileBlobs !== 'object' || Array.isArray(manifest.fileBlobs)) throw new Error('external consumer fileBlobs must be an object');

const canonicalPath = (value) => typeof value === 'string'
  && value.length > 0
  && !isAbsolute(value)
  && !value.includes('\\')
  && !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');

const gitBlobSha = (buffer) => createHash('sha1')
  .update(Buffer.from(`blob ${buffer.length}\0`))
  .update(buffer)
  .digest('hex');

async function listFiles(root, dir = root, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(root, path, out);
    else if (entry.isFile()) out.push(relative(root, path).split(sep).join('/'));
    else throw new Error(`unsupported snapshot filesystem entry: ${path}`);
  }
  return out;
}

const expected = Object.keys(manifest.fileBlobs).sort();
const actual = (await listFiles(consumerRoot)).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`external consumer snapshot file set drifted\nexpected=${JSON.stringify(expected)}\nactual=${JSON.stringify(actual)}`);
}

for (const path of expected) {
  if (!canonicalPath(path)) throw new Error(`noncanonical snapshot path: ${path}`);
  const blob = manifest.fileBlobs[path];
  if (!/^[0-9a-f]{40}$/.test(blob)) throw new Error(`invalid source Git blob id for ${path}`);
  const absolute = resolve(consumerRoot, path);
  if (!absolute.startsWith(`${consumerRoot}${sep}`)) throw new Error(`snapshot path escaped root: ${path}`);
  const bytes = await readFile(absolute);
  const computed = gitBlobSha(bytes);
  if (computed !== blob) throw new Error(`snapshot content drift for ${path}: expected ${blob}, computed ${computed}`);
}

const validPrefix = 'contracts/shared-auth-config/instances/SharedAuthConfigFile/valid/';
const invalidPrefix = 'contracts/shared-auth-config/instances/SharedAuthConfigFile/invalid/';
const validCount = expected.filter((path) => path.startsWith(validPrefix) && path.endsWith('.json')).length;
const invalidCount = expected.filter((path) => path.startsWith(invalidPrefix) && path.endsWith('.json')).length;
if (validCount !== manifest.corpus?.validCount || invalidCount !== manifest.corpus?.invalidCount) {
  throw new Error(`snapshot corpus cardinality drift: valid=${validCount}, invalid=${invalidCount}`);
}

console.log(`Shared Auth external snapshot verified at ${manifest.sourceRevision}: ${expected.length} files, ${validCount} valid / ${invalidCount} invalid fixtures`);
