import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORMAL_AUTHORITY,
  FORMAL_MANIFEST_SCHEMA,
  behaviorDigestForFormalVerification,
  formalManifestDigest,
  normalizeFormalManifest,
} from '../../src/formal-verification.mjs';
import { BEHAVIOR_AUTHORITY, BEHAVIOR_CONTRACT_SCHEMA } from '../../src/behavior-contract.mjs';

function behaviorContract() {
  return {
    schema: BEHAVIOR_CONTRACT_SCHEMA,
    authority: BEHAVIOR_AUTHORITY,
    operations: [
      {
        operationId: 'locks.acquire',
        kind: 'algorithm',
        language: 'dafny',
        executable: true,
        inputs: [
          { name: 'resource_id', type: 'string', required: true },
          { name: 'ttl_ms', type: 'uint64', required: true },
        ],
        output: { type: 'AcquireResult', nullable: false },
        requires: ['ttl_ms > 0'],
        ensures: ['result is structurally valid'],
        invariants: ['fencing tokens increase'],
        expression: null,
        algorithm: 'Acquire resource or report contention without violating fencing monotonicity.',
        effects: [{ kind: 'write', resource: 'lock_store' }],
        errors: [],
        deterministic: true,
        idempotent: false,
        pure: false,
      },
    ],
  };
}

function manifest(contract = behaviorContract()) {
  return {
    schema: FORMAL_MANIFEST_SCHEMA,
    authority: FORMAL_AUTHORITY,
    behaviorContractDigest: behaviorDigestForFormalVerification(contract),
    operations: [
      {
        operationId: 'locks.acquire',
        language: 'dafny',
        source: 'formal/locks.dfy',
        module: 'Locks',
        symbol: 'Acquire',
        sourceSha256: `sha256:${'a'.repeat(64)}`,
        verifyIncludedFiles: true,
      },
    ],
  };
}

test('formal manifest is deterministic and binds an exact behavioral authority digest', () => {
  const contract = behaviorContract();
  const normalized = normalizeFormalManifest(manifest(contract));
  assert.equal(normalized.behaviorContractDigest, behaviorDigestForFormalVerification(contract));
  assert.match(formalManifestDigest(normalized), /^sha256:[a-f0-9]{64}$/u);
});

test('formal manifest rejects path traversal, Windows drive paths, and non-Dafny proof sources', () => {
  const traversal = manifest();
  traversal.operations[0].source = '../locks.dfy';
  assert.throws(() => normalizeFormalManifest(traversal), /normalized relative POSIX path/u);

  const windowsDrive = manifest();
  windowsDrive.operations[0].source = 'C:/formal/locks.dfy';
  assert.throws(() => normalizeFormalManifest(windowsDrive), /normalized relative POSIX path/u);

  const wrongExtension = manifest();
  wrongExtension.operations[0].source = 'formal/locks.txt';
  assert.throws(() => normalizeFormalManifest(wrongExtension), /\.dfy file/u);
});

test('formal manifest rejects duplicate proof targets and unpinned source digests', () => {
  const invalid = manifest();
  invalid.operations.push({ ...invalid.operations[0], operationId: 'locks.acquire_again' });
  assert.throws(() => normalizeFormalManifest(invalid), /duplicate source\/module\/symbol/u);

  const missingDigest = manifest();
  missingDigest.operations[0].sourceSha256 = 'latest';
  assert.throws(() => normalizeFormalManifest(missingDigest), /sha256/u);
});
