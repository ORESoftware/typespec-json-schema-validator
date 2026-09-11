import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.TS_ADAPTER_MODULE;
if (!modulePath) throw new Error('TS_ADAPTER_MODULE is required');
const { parseSharedAuthConfig } = await import(pathToFileURL(modulePath));

const base = new URL('../../instances/SharedAuthConfigFile/', import.meta.url);

async function fixtureNames(kind) {
  const directory = new URL(`${kind}/`, base);
  return (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => `${kind}/${name}`);
}

const valid = await fixtureNames('valid');
const invalid = await fixtureNames('invalid');
assert.ok(valid.length > 0, 'TJSV corpus must contain valid fixtures');
assert.ok(invalid.length > 0, 'TJSV corpus must contain invalid fixtures');

for (const fixture of valid) {
  const raw = await readFile(new URL(fixture, base), 'utf8');
  const original = JSON.parse(raw);
  const parsed = parseSharedAuthConfig(original);
  const emitted = JSON.parse(JSON.stringify(parsed));
  assert.deepEqual(emitted, original, `${fixture} egress must preserve the admitted wire shape`);
  const reparsed = parseSharedAuthConfig(emitted);
  assert.deepEqual(reparsed, parsed, `${fixture} must survive TypeScript egress and ingress`);
}

for (const fixture of invalid) {
  const raw = await readFile(new URL(fixture, base), 'utf8');
  assert.throws(
    () => parseSharedAuthConfig(JSON.parse(raw)),
    undefined,
    `${fixture} must be rejected by the TypeScript runtime adapter`,
  );
}

console.log(`TypeScript shared-auth config evidence passed: ${valid.length} valid / ${invalid.length} invalid fixtures`);
