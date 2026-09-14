import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { sha256 } from '../../src/canonical.mjs';
import {
  behaviorDigestForFormalVerification,
  normalizeFormalManifest,
} from '../../src/formal-verification.mjs';

const root = resolve(import.meta.dirname, '../..');

test('formal example pins the exact behavior authority and Dafny source', async () => {
  const [behaviorText, manifestText, dafnyText] = await Promise.all([
    readFile(resolve(root, 'examples/formal-verification/behavior.json'), 'utf8'),
    readFile(resolve(root, 'examples/formal-verification/formal-manifest.json'), 'utf8'),
    readFile(resolve(root, 'examples/formal-verification/formal/locks.dfy'), 'utf8'),
  ]);
  const behavior = JSON.parse(behaviorText);
  const manifest = normalizeFormalManifest(JSON.parse(manifestText));
  assert.equal(manifest.behaviorContractDigest, behaviorDigestForFormalVerification(behavior));
  assert.equal(manifest.operations[0].sourceSha256, `sha256:${sha256(dafnyText)}`);
});
