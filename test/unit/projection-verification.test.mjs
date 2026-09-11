import assert from 'node:assert/strict';
import { link, lstat, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
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
    expectedDeclarations: ['Example.Status', 'Example.Widget'],
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
    declarationIds: ['Example.Status', 'Example.Widget'],
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    schema: PROJECTION_ADMISSION_REPORT_SCHEMA,
    status: 'passed',
    admissible: true,
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

test('projection verification policy is deterministic and requires an independent complete declaration scope', () => {
  const normalized = normalizeProjectionVerificationPolicy(policy({
    expectedDeclarations: ['Example.Widget', 'Example.Status'],
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
  assert.deepEqual(normalized.expectedDeclarations, ['Example.Status', 'Example.Widget']);
  assert.deepEqual(normalized.requiredProjections, ['protobuf', 'sql']);
  assert.deepEqual(normalized.toolchains.map((item) => item.id), ['api-docs-protobuf', 'sql-emitter']);
  assert.throws(
    () => normalizeProjectionVerificationPolicy({ ...policy(), expectedDeclarations: [] }),
    /must not be empty/u,
  );
  assert.throws(
    () => normalizeProjectionVerificationPolicy({ ...policy(), copiedStatus: 'passed' }),
    ProjectionVerificationPolicyError,
  );
});

test('projection verification policy rejects path reuse, traversal, and duplicate outputs', () => {
  assert.throws(
    () => normalizeProjectionVerificationPolicy(policy({
      inputs: {
        operationInventory: { path: '../operations.json' },
        projectionMetadata: { path: 'idl/protobuf.lock.json' },
        emitterConfiguration: { path: 'config/emitter.json' },
      },
    })),
    /normalized relative POSIX path/u,
  );
  assert.throws(
    () => normalizeProjectionVerificationPolicy(policy({
      outputs: [
        { path: 'generated/accounts.proto', mediaType: 'text/plain', projection: 'protobuf' },
        { path: 'generated/accounts.proto', mediaType: 'text/plain', projection: 'protobuf' },
      ],
    })),
    /output paths must be unique/u,
  );
  assert.throws(
    () => normalizeProjectionVerificationPolicy(policy({
      outputs: [{ path: 'operations/api-ir.json', mediaType: 'text/plain', projection: 'protobuf' }],
    })),
    /must not reuse a path/u,
  );
});

test('passed projection receipts are compact, deterministic, and self-digesting', () => {
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
});

test('stopped projection evidence retains stable rule ids without source text', () => {
  const receipt = createProjectionVerificationReceipt({
    report: report({
      status: 'stopped_for_evaluation',
      admissible: false,
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
  assert.doesNotMatch(canonicalStringify(receipt), /secret output bytes|private tool path/u);
});

test('receipt writer replaces only recognized singly linked evidence', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-receipt-'));
  const target = join(directory, 'verification.json');
  const failed = failedProjectionVerificationReceipt();
  await writeProjectionVerificationReceipt(target, failed);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), failed);
  const passed = createProjectionVerificationReceipt({
    report: report(),
    contractIrVerification: verification(),
    contractIr: contractIr(),
  });
  await writeProjectionVerificationReceipt(target, passed);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), passed);
  assert.equal((await lstat(target)).nlink, 1);

  const unrelated = join(directory, 'unrelated.json');
  await writeFile(unrelated, '{"status":"passed"}\n');
  await assert.rejects(
    writeProjectionVerificationReceipt(unrelated, failed),
    UnsafeProjectionVerificationReceiptDestinationError,
  );

  const symbolic = join(directory, 'symbolic.json');
  try {
    await symlink(target, symbolic);
  } catch (error) {
    context.skip(`symbolic links unavailable: ${error.message}`);
    return;
  }
  await assert.rejects(
    writeProjectionVerificationReceipt(symbolic, failed),
    UnsafeProjectionVerificationReceiptDestinationError,
  );

  const hard = join(directory, 'hard.json');
  await link(target, hard);
  await assert.rejects(
    writeProjectionVerificationReceipt(hard, failed),
    UnsafeProjectionVerificationReceiptDestinationError,
  );
});

test('flags-2-env parses verify-projection and preserves source, policy, and receipt roles', () => {
  const config = loadCliConfiguration([
    'node',
    'tsjsv',
    'verify-projection',
    '--root=workspace',
    '--projection-manifest=.contract/manifest.json',
    '--contract-ir=.contract/contract-ir.json',
    '--parity-receipt=.contract/parity.json',
    '--typespec=typespec/main.tsp',
    '--generated-schema=.contract/generated.schema.json',
    '--schema=json-schema',
    '--policy=.contract/policy.json',
    '--verification=.contract/verification.json',
  ]);
  assert.equal(config.command, 'verify-projection');
  assert.equal(config.root, 'workspace');
  assert.equal(config.projectionManifest, '.contract/manifest.json');
  assert.equal(config.contractIr, '.contract/contract-ir.json');
  assert.equal(config.parityReceipt, '.contract/parity.json');
  assert.equal(config.typespec, 'typespec/main.tsp');
  assert.equal(config.generatedSchema, '.contract/generated.schema.json');
  assert.equal(config.authoredSchema, 'json-schema');
  assert.equal(config.projectionPolicy, '.contract/policy.json');
  assert.equal(config.projectionVerification, '.contract/verification.json');
});

test('projection action binds inputs through env and keeps every shell body free of expressions', async () => {
  const action = (await readFile(new URL('../../actions/verify-projection/action.yml', import.meta.url), 'utf8'))
    .replace(/\r\n?/gu, '\n');
  assert.match(action, /TSJSV_COMMAND: verify-projection/u);
  assert.match(action, /TSJSV_PROJECTION_MANIFEST: \$\{\{ inputs\.projection_manifest \}\}/u);
  assert.match(action, /TSJSV_PROJECTION_POLICY: \$\{\{ inputs\.policy \}\}/u);
  assert.match(action, /bin\/typespec-json-schema-validator\.mjs/u);
  const runBlocks = action.match(/^      run: \|\n(?:        .*\n?)*/gmu) ?? [];
  assert.equal(runBlocks.length, 2);
  for (const runBlock of runBlocks) assert.doesNotMatch(runBlock, /\$\{\{ inputs\./u);
  assert.doesNotMatch(action, /\beval\b|child_process|execSync|spawnSync/u);
});
