import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BEHAVIOR_AUTHORITY, BEHAVIOR_CONTRACT_SCHEMA } from '../../src/behavior-contract.mjs';
import { sha256 } from '../../src/canonical.mjs';
import {
  IMPLEMENTATION_PROOF_AUTHORITY,
  IMPLEMENTATION_PROOF_MANIFEST_SCHEMA,
  behaviorDigestForImplementationVerification,
  implementationProofManifestDigest,
  normalizeImplementationProofManifest,
  verifyImplementationProofs,
} from '../../src/implementation-verification.mjs';

function behaviorContract() {
  return {
    schema: BEHAVIOR_CONTRACT_SCHEMA,
    authority: BEHAVIOR_AUTHORITY,
    operations: [
      {
        operationId: 'locks.check_ttl',
        kind: 'algorithm',
        language: 'dafny',
        executable: true,
        inputs: [{ name: 'ttl_ms', type: 'uint64', required: true }],
        output: { type: 'boolean', nullable: false },
        requires: ['ttl_ms >= 0'],
        ensures: ['result <==> ttl_ms > 0'],
        invariants: [],
        expression: null,
        algorithm: 'return ttl_ms > 0',
        effects: [],
        errors: [],
        deterministic: true,
        idempotent: true,
        pure: true,
      },
    ],
  };
}

function manifest(contract, implementationText, proofText, revision = 'a'.repeat(40)) {
  const digest = behaviorDigestForImplementationVerification(contract);
  return {
    schema: IMPLEMENTATION_PROOF_MANIFEST_SCHEMA,
    authority: IMPLEMENTATION_PROOF_AUTHORITY,
    behaviorContractDigest: digest,
    formalVerificationId: `sha256:${'b'.repeat(64)}`,
    repository: 'https://github.com/ORESoftware/example-rust-consumer',
    revision,
    operations: [
      {
        operationId: 'locks.check_ttl',
        language: 'rust',
        implementation: {
          source: 'src/lib.rs',
          sourceSha256: `sha256:${sha256(implementationText)}`,
          symbol: 'check_ttl',
        },
        proofs: [
          {
            tool: 'kani',
            source: 'src/verification.rs',
            sourceSha256: `sha256:${sha256(proofText)}`,
            manifestPath: 'Cargo.toml',
            harness: 'verification::check_ttl_contract',
            package: null,
          },
        ],
      },
    ],
  };
}

test('implementation proof manifest is deterministic and rejects unsafe source paths', () => {
  const contract = behaviorContract();
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = '// proof\n';
  const value = manifest(contract, implementationText, proofText);
  assert.match(implementationProofManifestDigest(value), /^sha256:[a-f0-9]{64}$/u);

  const traversal = structuredClone(value);
  traversal.operations[0].implementation.source = '../src/lib.rs';
  assert.throws(() => normalizeImplementationProofManifest(traversal), /normalized relative POSIX path/u);

  const duplicate = structuredClone(value);
  duplicate.operations.push(structuredClone(duplicate.operations[0]));
  assert.throws(() => normalizeImplementationProofManifest(duplicate), /duplicate operationId/u);
});

test('implementation proof verification binds the passed L3 receipt, exact git revision, proof markers, and Kani result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-l4-'));
  await mkdir(join(root, 'src'), { recursive: true });

  const contract = behaviorContract();
  const behaviorDigest = behaviorDigestForImplementationVerification(contract);
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = [
    `// TJSV_OPERATION_ID: locks.check_ttl`,
    `// TJSV_BEHAVIOR_DIGEST: ${behaviorDigest}`,
    '#[cfg(kani)]',
    'mod verification {',
    '  #[kani::proof]',
    '  fn check_ttl_contract() {}',
    '}',
    '',
  ].join('\n');
  const revision = 'a'.repeat(40);
  const value = manifest(contract, implementationText, proofText, revision);

  await writeFile(join(root, 'src/lib.rs'), implementationText);
  await writeFile(join(root, 'src/verification.rs'), proofText);
  await writeFile(join(root, 'Cargo.toml'), '[package]\nname="example"\nversion="0.1.0"\n');

  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'git' && args[0] === 'rev-parse') {
      return { status: 0, signal: null, stdout: `${revision}\n`, stderr: '' };
    }
    if (command === 'git' && args[0] === 'status') {
      return { status: 0, signal: null, stdout: '', stderr: '' };
    }
    if (command === 'cargo' && args[0] === 'kani' && args[1] === '--version') {
      return { status: 0, signal: null, stdout: 'kani 0.test\n', stderr: '' };
    }
    if (command === 'cargo' && args[0] === 'kani') {
      return { status: 0, signal: null, stdout: 'VERIFICATION:- SUCCESSFUL\n', stderr: '' };
    }
    return { status: 127, signal: null, stdout: '', stderr: 'unexpected command' };
  };

  const receipt = await verifyImplementationProofs({
    root,
    behaviorContract: contract,
    formalReceipt: {
      schema: 'ores.typespec-json-schema-validator.formal-verification-receipt/v1',
      status: 'passed',
      behaviorContractDigest: behaviorDigest,
      verificationId: value.formalVerificationId,
    },
    manifest: value,
    spawn,
  });

  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.assuranceLevel, 'L4');
  assert.equal(receipt.proofRuns.length, 1);
  assert.equal(receipt.proofRuns[0].proofMode, 'model-checking');
  assert.ok(calls.some((call) => call.join(' ').includes('cargo kani --manifest-path Cargo.toml --harness verification::check_ttl_contract')));
});

test('implementation proof verification refuses to promote mismatched L3 evidence or missing digest markers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-l4-negative-'));
  await mkdir(join(root, 'src'), { recursive: true });

  const contract = behaviorContract();
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = '// deliberately missing TJSV binding markers\n';
  const revision = 'a'.repeat(40);
  const value = manifest(contract, implementationText, proofText, revision);

  await writeFile(join(root, 'src/lib.rs'), implementationText);
  await writeFile(join(root, 'src/verification.rs'), proofText);
  await writeFile(join(root, 'Cargo.toml'), '[package]\nname="example"\nversion="0.1.0"\n');

  const spawn = (command, args) => {
    if (command === 'git' && args[0] === 'rev-parse') return { status: 0, signal: null, stdout: `${revision}\n`, stderr: '' };
    if (command === 'git' && args[0] === 'status') return { status: 0, signal: null, stdout: '', stderr: '' };
    if (command === 'cargo' && args[0] === 'kani' && args[1] === '--version') return { status: 0, signal: null, stdout: 'kani\n', stderr: '' };
    return { status: 0, signal: null, stdout: '', stderr: '' };
  };

  const receipt = await verifyImplementationProofs({
    root,
    behaviorContract: contract,
    formalReceipt: {
      status: 'passed',
      behaviorContractDigest: behaviorDigestForImplementationVerification(contract),
      verificationId: `sha256:${'c'.repeat(64)}`,
    },
    manifest: value,
    spawn,
  });

  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.assuranceLevel, null);
  assert.ok(receipt.findings.some((finding) => finding.ruleId === 'implementation-formal-receipt-mismatch'));
  assert.ok(receipt.findings.some((finding) => finding.ruleId === 'implementation-proof-binding-missing'));
});
