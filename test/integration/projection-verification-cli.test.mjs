import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import { createProjectionManifest, hashProjectionFiles } from '../../src/projection-admission/index.mjs';
import { PROJECTION_VERIFICATION_POLICY_SCHEMA } from '../../src/projection-verification/index.mjs';
import { runCheck, writeReport } from '../../src/run.mjs';
import { buildContractIr, writeContractIr } from '../../src/contract-ir.mjs';
import { main } from '../../src/cli.mjs';

const fixtureRoot = resolve('test/fixtures/pass');
const typespec = resolve(fixtureRoot, 'main.tsp');
const authoredSchema = resolve(fixtureRoot, 'authored.schema.json');

async function writeJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, `${canonicalStringify(value, 2)}\n`);
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'tsjsv-projection-cli-'));
  const outputDir = resolve(root, 'generated-json-schema');
  const parityPath = resolve(root, 'parity-report.json');
  const contractIrPath = resolve(root, 'contract-ir.json');
  const manifestPath = resolve(root, 'projection-manifest.json');
  const policyPath = resolve(root, 'projection-policy.json');
  const verificationPath = resolve(root, 'projection-verification.json');
  const operationsPath = resolve(root, 'inputs/operations/api-ir.json');
  const metadataPath = resolve(root, 'inputs/idl/protobuf.lock.json');
  const configurationPath = resolve(root, 'inputs/config/emitter.json');
  const projectedOutputPath = resolve(root, 'outputs/generated/accounts.proto');

  const parityReport = await runCheck({
    command: 'check',
    typespec,
    authoredSchema,
    outputDir,
    bundleId: 'typespec.generated.schema.json',
    int64Strategy: 'string',
    sealObjectSchemas: true,
    polymorphicModelsStrategy: 'oneOf',
    maxFindings: 250,
    maxProbes: 64,
    probes: true,
    formatAssertion: false,
  });
  assert.equal(parityReport.status, 'passed');
  await writeReport(parityPath, parityReport);
  const generatedSchema = parityReport.inputs.generatedJsonSchema.input;
  const contractIr = await buildContractIr({
    report: parityReport,
    typespec,
    generatedSchema,
    authoredSchema,
  });
  await writeContractIr(contractIrPath, contractIr);

  await writeJson(operationsPath, {
    operations: [{ id: 'Example.Widget.read', request: 'Example.Widget', response: 'Example.Widget' }],
  });
  await writeJson(metadataPath, {
    projection: 'protobuf',
    declarations: [{ declaration: 'Example.Widget', fields: { name: 1, status: 2, count: 3 } }],
  });
  await writeJson(configurationPath, {
    emitter: 'api-docs-protobuf',
    options: { syntax: 'proto3' },
  });
  await mkdir(dirname(projectedOutputPath), { recursive: true });
  await writeFile(projectedOutputPath, 'syntax = "proto3";\nmessage Widget { string name = 1; }\n');

  const [operationInventory, projectionMetadata, emitterConfiguration] = await hashProjectionFiles(
    resolve(root, 'inputs'),
    [
      { path: 'operations/api-ir.json' },
      { path: 'idl/protobuf.lock.json' },
      { path: 'config/emitter.json' },
    ],
  );
  const [projectedOutput] = await hashProjectionFiles(resolve(root, 'outputs'), [
    { path: 'generated/accounts.proto', mediaType: 'text/plain', projection: 'protobuf' },
  ]);
  const toolchain = {
    id: 'api-docs-protobuf',
    version: '0.8.0',
    artifactDigest: sha256('api-docs-protobuf@0.8.0'),
  };
  const manifest = createProjectionManifest({
    contractIr,
    parityReceipt: parityReport,
    sourceDigests: {
      typespec: contractIr.provenance.typespec.digest,
      generatedJsonSchema: contractIr.provenance.generatedJsonSchema.digest,
      authoredJsonSchema: contractIr.provenance.authoredJsonSchema.digest,
    },
    inputs: { operationInventory, projectionMetadata, emitterConfiguration },
    toolchains: [toolchain],
    projections: [{
      id: 'protobuf',
      declarations: ['Example.Status', 'Example.Widget'],
      complete: true,
    }],
    outputs: [projectedOutput],
    representationDeltas: [],
    runtimeValidators: [],
  });
  await writeJson(manifestPath, manifest);
  await writeJson(policyPath, {
    schema: PROJECTION_VERIFICATION_POLICY_SCHEMA,
    inputs: {
      operationInventory: { path: operationInventory.path },
      projectionMetadata: { path: projectionMetadata.path },
      emitterConfiguration: { path: emitterConfiguration.path },
    },
    toolchains: [toolchain],
    requiredProjections: ['protobuf'],
    outputs: [{ path: projectedOutput.path, mediaType: projectedOutput.mediaType, projection: 'protobuf' }],
    approvedDeltas: [],
    runtimeValidators: [],
  });

  return {
    root,
    parityPath,
    contractIrPath,
    manifestPath,
    policyPath,
    verificationPath,
    generatedSchema,
    projectedOutputPath,
  };
}

function argv(context, verificationPath = context.verificationPath) {
  return [
    'node',
    'tsjsv',
    'verify-projection',
    `--projection-manifest=${context.manifestPath}`,
    `--contract-ir=${context.contractIrPath}`,
    `--parity-receipt=${context.parityPath}`,
    `--typespec=${typespec}`,
    `--generated-schema=${context.generatedSchema}`,
    `--schema=${authoredSchema}`,
    `--policy=${context.policyPath}`,
    `--input-root=${resolve(context.root, 'inputs')}`,
    `--output-root=${resolve(context.root, 'outputs')}`,
    `--verification=${verificationPath}`,
    '--quiet',
  ];
}

test('verify-projection emits durable green evidence for exact current inputs and outputs', async () => {
  const context = await fixture();
  assert.equal(await main(argv(context)), 0);
  const receipt = JSON.parse(await readFile(context.verificationPath, 'utf8'));
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.admissible, true);
  assert.equal(receipt.contractIrId, JSON.parse(await readFile(context.contractIrPath, 'utf8')).irId);
  assert.equal(receipt.failureCode, null);
  assert.deepEqual(receipt.findingRuleIds, []);
});

test('verify-projection replaces green evidence when generated output bytes drift', async () => {
  const context = await fixture();
  assert.equal(await main(argv(context)), 0);
  await writeFile(context.projectedOutputPath, 'syntax = "proto3";\nmessage Widget { bytes name = 1; }\n');
  assert.equal(await main(argv(context)), 2);
  const receipt = JSON.parse(await readFile(context.verificationPath, 'utf8'));
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.equal(receipt.admissible, false);
  assert.equal(receipt.failureCode, 'projection-verification-stopped');
  assert.ok(receipt.findingRuleIds.includes('projection-output-drift'));
});

test('verify-projection stops before trusting projection claims when an authored source byte drifts', async () => {
  const context = await fixture();
  const drifted = resolve(context.root, 'authored-drift.schema.json');
  await writeFile(drifted, `${await readFile(authoredSchema, 'utf8')}\n`);
  const driftArgv = argv(context).map((value) => (
    value.startsWith('--schema=') ? `--schema=${drifted}` : value
  ));
  assert.equal(await main(driftArgv), 2);
  const receipt = JSON.parse(await readFile(context.verificationPath, 'utf8'));
  assert.equal(receipt.status, 'stopped_for_evaluation');
  assert.deepEqual(receipt.findingRuleIds, ['projection-current-contract-ir-verification-failed']);
  assert.equal(receipt.sourceDigests.authoredJsonSchema.length, 64);
});

test('verify-projection writes failed evidence on usage errors without overwriting source artifacts', async () => {
  const context = await fixture();
  const before = await Promise.all([
    readFile(context.manifestPath, 'utf8'),
    readFile(context.contractIrPath, 'utf8'),
    readFile(context.parityPath, 'utf8'),
  ]);
  assert.equal(await main([
    'node',
    'tsjsv',
    'verify-projection',
    `--projection-manifest=${context.manifestPath}`,
    `--verification=${context.verificationPath}`,
  ]), 3);
  const receipt = JSON.parse(await readFile(context.verificationPath, 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.admissible, false);
  assert.equal(receipt.failureCode, 'projection-verification-failed');
  assert.deepEqual(await Promise.all([
    readFile(context.manifestPath, 'utf8'),
    readFile(context.contractIrPath, 'utf8'),
    readFile(context.parityPath, 'utf8'),
  ]), before);
});
