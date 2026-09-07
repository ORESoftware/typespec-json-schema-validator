import assert from 'node:assert/strict';
import { link, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import { CONTRACT_IR_VERIFICATION_SCHEMA } from '../../src/contract-ir.mjs';
import { PROJECTION_ADMISSION_REPORT_SCHEMA } from '../../src/projection-admission/index.mjs';
import {
  PROJECTION_VERIFICATION_POLICY_SCHEMA,
  PROJECTION_VERIFICATION_RECEIPT_SCHEMA,
  ProjectionVerificationPolicyError,
  UnsafeProjectionVerificationReceiptDestinationError,
  createProjectionVerificationReceipt,
  failedProjectionVerificationReceipt,
  loadProjectionVerificationPolicy,
  normalizeProjectionVerificationPolicy,
  writeProjectionVerificationReceipt,
} from '../../src/projection-verification/index.mjs';
import { loadCliConfiguration } from '../../src/cli-config.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const E = 'e'.repeat(64);

function policy(overrides = {}) {
  return {
    schema: PROJECTION_VERIFICATION_POLICY_SCHEMA,
    inputs: {
      operationInventory: { path: 'operations/api-ir.json' },
      projectionMetadata: { path: 'idl/protobuf.lock.json' },
      emitterConfiguration: { path: 'config/emitter.json' },
    },
    toolchains: [{ id: 'api-docs-protobuf', version: '0.8.0', artifactDigest: A }],
    requiredProjections: ['protobuf'],
    outputs: [{ path: 'generated/accounts.proto', mediaType: 'text/plain', projection: 'protobuf' }],
    approvedDeltas: [],
    runtimeValidators: [],
    ...overrides,
  };
}

function contractIr() {
  return {
    irId: B,
    admission: { receipt: { runId: C } },
    provenance: {
      typespec: { digest: A },
      generatedJsonSchema: { digest: D },
      authoredJsonSchema: { digest: E },
    },
  };
}

function verification(overrides = {}) {
  return {
    schema: CONTRACT_IR_VERIFICATION_SCHEMA,
    status: 'passed',
    admissible: true,
    suppliedIrId: B,
    computedIrId: B,
    expectedIrId: B,
    receiptRunId: C,
    error: null,
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    schema: PROJECTION_ADMISSION_REPORT_SCHEMA,
    status: 'passed',
    admissible: true,
    zeroUnexplainedFindings: true,
    manifestId: A,
    contractIrId: B,
    receiptRunId: C,
    evidenceDigest: D,
    findings: [],
    summary: {
      declarations: 2,
      projections: 1,
      outputs: 1,
      representationDeltas: 0,
      runtimeValidators: 0,
    },
    ...overrides,
  };
}

function receiptDigest(receipt) {
  const { verificationId, ...body } = receipt;
  return sha256(canonicalStringify(body));
}

test('projection verification policy is deterministic and closes its root shape', () => {
  const normalized = normalizeProjectionVerificationPolicy(policy({
    requiredProjections: ['sql', 'protobuf'],
    toolchains: [
      { id: 'sql-emitter', version: '1.0.0', artifactDigest: B },
      { id: 'api-docs-protobuf', version: '0.8.0', artifactDigest: A },
    ],
    outputs: [
      { path: 'generated/schema.sql', mediaType: 'text/plain', projection: 'sql' },
      { path: 'generated/accounts.proto', mediaType: 'text/plain', projection: 'protobuf' },
    ],
  }));
  assert.deepEqual(normalized.requiredProjections, ['protobuf', 'sql']);
  assert.deepEqual(normalized.toolchains.map((item) => item.id), ['api-docs-protobuf', 'sql-emitter']);
  assert.deepEqual(normalized.outputs.map((item) => item.path), [
    'generated/accounts.proto',
    'generated/schema.sql',
  ]);
  assert.throws(
    () => normalizeProjectionVerificationPolicy({ ...policy(), copiedStatus: 'passed' }),
    ProjectionVerificationPolicyError,
  );
});

test('projection verification policy rejects traversal, duplicates, and missing admission scope', () => {
  assert.throws(
    () => normalizeProjectionVerificationPolicy(policy({
      inputs: {
        operationInventory: { path: '../operations.json' },
        projectionMetadata: { path: 'idl/protobuf.lock.json' },
        emitterConfiguration: { path: 'config/emitter.json' },
      },
    })),
    /normalized relative POSIX path/,
  );
  assert.throws(
    () => normalizeProjectionVerificationPolicy(policy({
      outputs: [
        { path: 'generated/accounts.proto', mediaType: 'text/plain', projection: 'protobuf' },
        { path: 'generated/accounts.proto', mediaType: 'text/plain', projection: 'protobuf' },
      ],
    })),
    /output paths must be unique/,
  );
  assert.throws(
    () => normalizeProjectionVerificationPolicy(policy({ requiredProjections: [] })),
    /must not be empty/,
  );
});

test('passed projection verification receipts are compact, deterministic, and self-digesting', () => {
  const first = createProjectionVerificationReceipt({
    report: report(),
    contractIrVerification: verification(),
    contractIr: contractIr(),
  });
  const second = createProjectionVerificationReceipt({
    report: report(),
    contractIrVerification: verification(),
    contractIr: contractIr(),
  });
  assert.equal(first.schema, PROJECTION_VERIFICATION_RECEIPT_SCHEMA);
  assert.equal(first.status, 'passed');
  assert.equal(first.admissible, true);
  assert.deepEqual(first, second);
  assert.equal(first.verificationId, receiptDigest(first));
  assert.deepEqual(first.findingRuleIds, []);
  assert.equal(first.failureCode, null);
  assert.deepEqual(first.sourceDigests, {
    typespec: A,
    generatedJsonSchema: D,
    authoredJsonSchema: E,
  });
});

test('a copied green report with the wrong schema becomes failed evidence', () => {
  const receipt = createProjectionVerificationReceipt({
    report: report({ schema: 'attacker.green/v1' }),
    contractIrVerification: verification(),
    contractIr: contractIr(),
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.admissible, false);
  assert.equal(receipt.failureCode, 'projection-verification-failed');
  assert.equal(receipt.verificationId, receiptDigest(receipt));
});

test('stopped projection evidence retains stable rule identifiers without source text', () => {
  const receipt = createProjectionVerificationReceipt({
    report: report({
      status: 'stopped_for_evaluation',
      admissible: false,
      zeroUnexplainedFindings: false,
      findings: [
        { ruleId: 'projection-output-drift', message: 'secret output bytes differ' },
        { ruleId: 'projection-output-drift', message: 'duplicate' },
        { ruleId: 'projection-toolchain-mismatch', message: 'private tool path' },
      ],
    }),
    contractIrVerification: verification(),
    contractIr: contractIr(),
  });
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.admissible, false);
  assert.deepEqual(receipt.findingRuleIds, [
    'projection-output-drift',
    'projection-toolchain-mismatch',
  ]);
  assert.equal(receipt.failureCode, 'projection-verification-stopped');
  const serialized = canonicalStringify(receipt);
  assert.doesNotMatch(serialized, /secret output bytes|private tool path/u);
});

test('failed projection evidence contains no arbitrary verifier error or source payload', () => {
  const receipt = failedProjectionVerificationReceipt({
    manifest: { manifestId: A, payload: 'raw operation inventory' },
    contractIr: contractIr(),
    parityReceipt: { runId: C, error: 'database url' },
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.admissible, false);
  assert.equal(receipt.failureCode, 'projection-verification-failed');
  assert.equal(receipt.verificationId, receiptDigest(receipt));
  assert.doesNotMatch(canonicalStringify(receipt), /raw operation inventory|database url/u);
});

test('receipt writer creates and safely replaces validator-owned projection evidence', async () => {
  const directory = await mkdir(join(tmpdir(), `tsjsv-projection-${Date.now()}-${Math.random()}`), {
    recursive: true,
  }).then(() => join(tmpdir(), `tsjsv-projection-${Date.now()}-${Math.random()}`));
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'verification.json');
  const first = failedProjectionVerificationReceipt();
  await writeProjectionVerificationReceipt(path, first);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), first);
  const second = createProjectionVerificationReceipt({
    report: report(),
    contractIrVerification: verification(),
    contractIr: contractIr(),
  });
  await writeProjectionVerificationReceipt(path, second);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), second);
  assert.equal((await lstat(path)).nlink, 1);
});

test('receipt writer refuses unrelated files', async () => {
  const directory = join(tmpdir(), `tsjsv-projection-unrelated-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'verification.json');
  await writeFile(path, '{"status":"passed"}\n');
  await assert.rejects(
    writeProjectionVerificationReceipt(path, failedProjectionVerificationReceipt()),
    UnsafeProjectionVerificationReceiptDestinationError,
  );
});

test('receipt writer refuses symbolic-link and multiply linked destinations', async (context) => {
  const directory = join(tmpdir(), `tsjsv-projection-links-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'target.json');
  const symbolic = join(directory, 'symbolic.json');
  const hard = join(directory, 'hard.json');
  const peer = join(directory, 'peer.json');
  await writeProjectionVerificationReceipt(target, failedProjectionVerificationReceipt());
  try {
    await symlink(target, symbolic);
  } catch (error) {
    context.skip(`symbolic links unavailable: ${error.message}`);
    return;
  }
  await assert.rejects(
    writeProjectionVerificationReceipt(symbolic, failedProjectionVerificationReceipt()),
    UnsafeProjectionVerificationReceiptDestinationError,
  );
  await link(target, hard);
  await link(hard, peer);
  await assert.rejects(
    writeProjectionVerificationReceipt(hard, failedProjectionVerificationReceipt()),
    UnsafeProjectionVerificationReceiptDestinationError,
  );
});

test('policy loader refuses links and enforces bounded regular JSON', async (context) => {
  const directory = join(tmpdir(), `tsjsv-projection-policy-${Date.now()}-${Math.random()}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'policy.json');
  const linked = join(directory, 'linked.json');
  await writeFile(path, `${canonicalStringify(policy(), 2)}\n`);
  assert.deepEqual(await loadProjectionVerificationPolicy(path), normalizeProjectionVerificationPolicy(policy()));
  try {
    await symlink(path, linked);
  } catch (error) {
    context.skip(`symbolic links unavailable: ${error.message}`);
    return;
  }
  await assert.rejects(loadProjectionVerificationPolicy(linked), ProjectionVerificationPolicyError);
});

test('flags-2-env parses the verify-projection command and keeps path roles separate', () => {
  const config = loadCliConfiguration([
    'node',
    'tsjsv',
    'verify-projection',
    '--projection-manifest=.contract/manifest.json',
    '--contract-ir=.contract/contract-ir.json',
    '--parity-receipt=.contract/parity.json',
    '--typespec=typespec/main.tsp',
    '--generated-schema=.contract/generated.schema.json',
    '--schema=json-schema',
    '--policy=.contract/policy.json',
    '--input-root=input',
    '--output-root=output',
    '--verification=.contract/verification.json',
  ]);
  assert.equal(config.command, 'verify-projection');
  assert.equal(config.projectionManifest, '.contract/manifest.json');
  assert.equal(config.contractIr, '.contract/contract-ir.json');
  assert.equal(config.parityReceipt, '.contract/parity.json');
  assert.equal(config.typespec, 'typespec/main.tsp');
  assert.equal(config.generatedSchema, '.contract/generated.schema.json');
  assert.equal(config.authoredSchema, 'json-schema');
  assert.equal(config.projectionPolicy, '.contract/policy.json');
  assert.equal(config.inputRoot, 'input');
  assert.equal(config.outputRoot, 'output');
  assert.equal(config.projectionVerification, '.contract/verification.json');
});

test('published projection verification schemas are Draft 2020-12 closed objects', async () => {
  for (const name of [
    'projection-verification-policy.schema.json',
    'projection-verification-receipt.schema.json',
  ]) {
    const schema = JSON.parse(await readFile(new URL(`../../schema/${name}`, import.meta.url), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
  }
});

test('projection action exposes only environment-bound inputs and invokes the canonical CLI', async () => {
  const action = await readFile(new URL('../../actions/verify-projection/action.yml', import.meta.url), 'utf8');
  assert.match(action, /TSJSV_COMMAND: verify-projection/u);
  assert.match(action, /TSJSV_PROJECTION_MANIFEST: \$\{\{ inputs\.projection_manifest \}\}/u);
  assert.match(action, /TSJSV_PROJECTION_POLICY: \$\{\{ inputs\.policy \}\}/u);
  assert.match(action, /bin\/typespec-json-schema-validator\.mjs/u);
  const runBlock = action.slice(action.indexOf('      run: |'));
  assert.doesNotMatch(runBlock, /\$\{\{ inputs\./u);
  assert.doesNotMatch(action, /\beval\b|child_process|execSync|spawnSync/u);
});
