import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BEHAVIOR_AUTHORITY, BEHAVIOR_CONTRACT_SCHEMA } from '../../src/behavior-contract.mjs';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  IMPLEMENTATION_PROOF_AUTHORITY,
  IMPLEMENTATION_PROOF_MANIFEST_SCHEMA,
  behaviorDigestForImplementationVerification,
  implementationProofManifestDigest,
  normalizeImplementationProofManifest,
  verifyImplementationProofs,
} from '../../src/implementation-verification.mjs';

function digest(value = '') {
  return `sha256:${sha256(value)}`;
}

function commandEvidence(value = '') {
  return {
    exitCode: 0,
    signal: null,
    stdoutSha256: digest(value),
    stderrSha256: digest(''),
  };
}

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

function formalReceipt(contract, overrides = {}) {
  const body = {
    schema: 'ores.typespec-json-schema-validator.formal-verification-receipt/v1',
    status: 'passed',
    authority: 'independently-authored-formal-authority',
    behaviorContractDigest: behaviorDigestForImplementationVerification(contract),
    formalManifestDigest: `sha256:${'d'.repeat(64)}`,
    bindings: [{ operationId: 'locks.check_ttl', qualifiedName: 'check_ttl' }],
    dafny: {
      executable: 'dafny',
      available: true,
      versionProbe: commandEvidence('dafny 4.test'),
    },
    proofRuns: [{
      source: 'formal/locks.dfy',
      operationIds: ['locks.check_ttl'],
      ...commandEvidence('verified'),
    }],
    findings: [],
    ...overrides,
  };
  return {
    ...body,
    verificationId: `sha256:${sha256(canonicalStringify(body))}`,
  };
}

function manifest(contract, receipt, implementationText, proofText, revision = 'a'.repeat(40)) {
  return {
    schema: IMPLEMENTATION_PROOF_MANIFEST_SCHEMA,
    authority: IMPLEMENTATION_PROOF_AUTHORITY,
    behaviorContractDigest: behaviorDigestForImplementationVerification(contract),
    formalVerificationId: receipt.verificationId,
    repository: 'https://github.com/ORESoftware/example-rust-consumer',
    revision,
    operations: [
      {
        operationId: 'locks.check_ttl',
        language: 'rust',
        implementation: {
          source: 'src/lib.rs',
          sourceSha256: digest(implementationText),
          symbol: 'check_ttl',
        },
        proofs: [
          {
            tool: 'kani',
            source: 'src/verification.rs',
            sourceSha256: digest(proofText),
            manifestPath: 'Cargo.toml',
            harness: 'verification::check_ttl_contract',
            package: null,
          },
        ],
      },
    ],
  };
}

function kaniProofText(contract, implementationText, harness = 'check_ttl_contract') {
  const behaviorDigest = behaviorDigestForImplementationVerification(contract);
  return [
    '// TJSV_OPERATION_ID: locks.check_ttl',
    `// TJSV_BEHAVIOR_DIGEST: ${behaviorDigest}`,
    `// TJSV_IMPLEMENTATION_SHA256: ${digest(implementationText)}`,
    '#[cfg(kani)]',
    'mod verification {',
    '  #[kani::proof]',
    `  fn ${harness}() {}`,
    '}',
    '',
  ].join('\n');
}

function successfulSpawn(revision, calls = []) {
  return (command, args) => {
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
    if (command === 'verus' && args[0] === '--version') {
      return { status: 0, signal: null, stdout: 'verus test\n', stderr: '' };
    }
    if (command === 'verus') {
      return { status: 0, signal: null, stdout: 'verification results:: 1 verified\n', stderr: '' };
    }
    return { status: 127, signal: null, stdout: '', stderr: 'unexpected command' };
  };
}

async function writeFixture(root, implementationText, proofText) {
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/lib.rs'), implementationText);
  await writeFile(join(root, 'src/verification.rs'), proofText);
  await writeFile(join(root, 'Cargo.toml'), '[package]\nname="example"\nversion="0.1.0"\n');
}

test('implementation proof manifest is deterministic and rejects unsafe or ambiguous targets', () => {
  const contract = behaviorContract();
  const receipt = formalReceipt(contract);
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = kaniProofText(contract, implementationText);
  const value = manifest(contract, receipt, implementationText, proofText);
  assert.match(implementationProofManifestDigest(value), /^sha256:[a-f0-9]{64}$/u);

  const traversal = structuredClone(value);
  traversal.operations[0].implementation.source = '../src/lib.rs';
  assert.throws(() => normalizeImplementationProofManifest(traversal), /normalized relative POSIX path/u);

  const duplicate = structuredClone(value);
  duplicate.operations.push(structuredClone(duplicate.operations[0]));
  assert.throws(() => normalizeImplementationProofManifest(duplicate), /duplicate operationId/u);

  const detachedVerus = structuredClone(value);
  detachedVerus.operations[0].proofs = [{
    tool: 'verus',
    source: 'verification/model.rs',
    sourceSha256: digest('model'),
  }];
  assert.throws(() => normalizeImplementationProofManifest(detachedVerus), /exact pinned implementation source/u);
});

test('implementation proof verification binds exact L3 evidence, revision, source digests, markers, harness, and Kani result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-l4-'));
  const contract = behaviorContract();
  const receipt = formalReceipt(contract);
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = kaniProofText(contract, implementationText);
  const revision = 'a'.repeat(40);
  const value = manifest(contract, receipt, implementationText, proofText, revision);
  await writeFixture(root, implementationText, proofText);

  const calls = [];
  const result = await verifyImplementationProofs({
    root,
    behaviorContract: contract,
    formalReceipt: receipt,
    manifest: value,
    spawn: successfulSpawn(revision, calls),
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.assuranceLevel, 'L4');
  assert.deepEqual(result.findings, []);
  assert.equal(result.proofRuns.length, 1);
  assert.equal(result.proofRuns[0].proofMode, 'model-checking');
  assert.ok(calls.some((call) => call.join(' ').includes('cargo kani --manifest-path Cargo.toml --harness verification::check_ttl_contract')));
});

test('tampered or mismatched L3 receipts cannot promote L4 evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-l4-l3-'));
  const contract = behaviorContract();
  const receipt = formalReceipt(contract);
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = kaniProofText(contract, implementationText);
  const revision = 'a'.repeat(40);
  const value = manifest(contract, receipt, implementationText, proofText, revision);
  await writeFixture(root, implementationText, proofText);

  const tampered = structuredClone(receipt);
  tampered.dafny.executable = 'not-the-original-dafny';
  const result = await verifyImplementationProofs({
    root,
    behaviorContract: contract,
    formalReceipt: tampered,
    manifest: value,
    spawn: successfulSpawn(revision),
  });
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((finding) => finding.ruleId === 'implementation-formal-receipt-digest-mismatch'));

  const wrongId = structuredClone(receipt);
  wrongId.verificationId = `sha256:${'c'.repeat(64)}`;
  const mismatch = await verifyImplementationProofs({
    root,
    behaviorContract: contract,
    formalReceipt: wrongId,
    manifest: value,
    spawn: successfulSpawn(revision),
  });
  assert.ok(mismatch.findings.some((finding) => finding.ruleId === 'implementation-formal-receipt-mismatch'));
});

test('missing L3 binding or successful Dafny coverage is fail-closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-l4-coverage-'));
  const contract = behaviorContract();
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = kaniProofText(contract, implementationText);
  const revision = 'a'.repeat(40);

  const missingBindingReceipt = formalReceipt(contract, { bindings: [] });
  const value = manifest(contract, missingBindingReceipt, implementationText, proofText, revision);
  await writeFixture(root, implementationText, proofText);
  const missingBinding = await verifyImplementationProofs({
    root,
    behaviorContract: contract,
    formalReceipt: missingBindingReceipt,
    manifest: value,
    spawn: successfulSpawn(revision),
  });
  assert.ok(missingBinding.findings.some((finding) => finding.ruleId === 'implementation-l3-binding-missing'));

  const missingProofReceipt = formalReceipt(contract, { proofRuns: [] });
  const value2 = manifest(contract, missingProofReceipt, implementationText, proofText, revision);
  const missingProof = await verifyImplementationProofs({
    root,
    behaviorContract: contract,
    formalReceipt: missingProofReceipt,
    manifest: value2,
    spawn: successfulSpawn(revision),
  });
  assert.ok(missingProof.findings.some((finding) => finding.ruleId === 'implementation-l3-proof-missing'));
});

test('revision mismatch and dirty checkout are independent fail-closed findings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-l4-git-'));
  const contract = behaviorContract();
  const receipt = formalReceipt(contract);
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = kaniProofText(contract, implementationText);
  const revision = 'a'.repeat(40);
  const value = manifest(contract, receipt, implementationText, proofText, revision);
  await writeFixture(root, implementationText, proofText);

  const spawn = (command, args) => {
    if (command === 'git' && args[0] === 'rev-parse') return { status: 0, signal: null, stdout: `${'b'.repeat(40)}\n`, stderr: '' };
    if (command === 'git' && args[0] === 'status') return { status: 0, signal: null, stdout: '?? scratch.txt\n', stderr: '' };
    return successfulSpawn(revision)(command, args);
  };
  const result = await verifyImplementationProofs({ root, behaviorContract: contract, formalReceipt: receipt, manifest: value, spawn });
  assert.ok(result.findings.some((finding) => finding.ruleId === 'implementation-revision-mismatch'));
  assert.ok(result.findings.some((finding) => finding.ruleId === 'implementation-working-tree-dirty'));
});

test('proof bindings include implementation digest and the named Kani harness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-l4-kani-'));
  const contract = behaviorContract();
  const receipt = formalReceipt(contract);
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const revision = 'a'.repeat(40);

  const missingDigestText = kaniProofText(contract, implementationText).replace(/^.*TJSV_IMPLEMENTATION_SHA256.*\n/mu, '');
  const missingDigestManifest = manifest(contract, receipt, implementationText, missingDigestText, revision);
  await writeFixture(root, implementationText, missingDigestText);
  const missingDigest = await verifyImplementationProofs({
    root,
    behaviorContract: contract,
    formalReceipt: receipt,
    manifest: missingDigestManifest,
    spawn: successfulSpawn(revision),
  });
  assert.ok(missingDigest.findings.some((finding) => finding.ruleId === 'implementation-proof-binding-missing'));

  const wrongHarnessText = kaniProofText(contract, implementationText, 'different_harness');
  const wrongHarnessManifest = manifest(contract, receipt, implementationText, wrongHarnessText, revision);
  await writeFixture(root, implementationText, wrongHarnessText);
  const wrongHarness = await verifyImplementationProofs({
    root,
    behaviorContract: contract,
    formalReceipt: receipt,
    manifest: wrongHarnessManifest,
    spawn: successfulSpawn(revision),
  });
  assert.ok(wrongHarness.findings.some((finding) => finding.ruleId === 'implementation-kani-harness-missing'));
});

test('unavailable or failed proof tools are fail-closed and do not claim L4', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-l4-tools-'));
  const contract = behaviorContract();
  const receipt = formalReceipt(contract);
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = kaniProofText(contract, implementationText);
  const revision = 'a'.repeat(40);
  const value = manifest(contract, receipt, implementationText, proofText, revision);
  await writeFixture(root, implementationText, proofText);

  const unavailableSpawn = (command, args) => {
    if (command === 'cargo') return { status: null, signal: null, stdout: '', stderr: '', error: new Error('ENOENT') };
    return successfulSpawn(revision)(command, args);
  };
  const unavailable = await verifyImplementationProofs({ root, behaviorContract: contract, formalReceipt: receipt, manifest: value, spawn: unavailableSpawn });
  assert.equal(unavailable.assuranceLevel, null);
  assert.ok(unavailable.findings.some((finding) => finding.ruleId === 'implementation-kani-unavailable'));

  const failedSpawn = (command, args) => {
    if (command === 'cargo' && args[0] === 'kani' && args[1] !== '--version') {
      return { status: 1, signal: null, stdout: '', stderr: 'verification failed' };
    }
    return successfulSpawn(revision)(command, args);
  };
  const failed = await verifyImplementationProofs({ root, behaviorContract: contract, formalReceipt: receipt, manifest: value, spawn: failedSpawn });
  assert.ok(failed.findings.some((finding) => finding.ruleId === 'implementation-proof-failed'));
});

test('timeout is bounded before any proof tool executes', async () => {
  const contract = behaviorContract();
  const receipt = formalReceipt(contract);
  const implementationText = 'pub fn check_ttl(ttl_ms: u64) -> bool { ttl_ms > 0 }\n';
  const proofText = kaniProofText(contract, implementationText);
  const value = manifest(contract, receipt, implementationText, proofText);
  await assert.rejects(
    verifyImplementationProofs({ behaviorContract: contract, formalReceipt: receipt, manifest: value, timeoutMs: 0 }),
    /timeoutMs must be a safe integer/u,
  );
  await assert.rejects(
    verifyImplementationProofs({ behaviorContract: contract, formalReceipt: receipt, manifest: value, timeoutMs: Number.MAX_SAFE_INTEGER }),
    /timeoutMs must be a safe integer/u,
  );
});
