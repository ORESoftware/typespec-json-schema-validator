import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  ADDITIVE_PROJECTION_IDS,
  createProjectionManifest,
  verifyProjectionManifest,
} from '../../src/projection-admission/index.mjs';

const digest = (value) => sha256(String(value));
const digestJson = (value) => sha256(canonicalStringify(value));

function fixture() {
  const assertionSchema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
    additionalProperties: false,
  };
  const receipt = {
    schema: 'ores.typespec-json-schema-validator.report/v1',
    runId: digest('run'),
    status: 'passed',
    zeroUnexplainedFindings: true,
    findings: [],
    coverage: {
      directDeclarationInventory: true,
      typespecGeneratedJsonSchemaComparison: true,
      differentialInstanceValidation: true,
    },
    inputs: {
      typespec: { digest: digest('typespec') },
      generatedJsonSchema: { digest: digest('generated') },
      authoredJsonSchema: { digest: digest('authored') },
    },
  };
  const declaration = {
    id: 'Example.Message',
    kind: 'model',
    names: {
      typespec: 'Example.Message',
      generatedJsonSchema: 'Example.Message',
      authoredJsonSchema: 'Example.Message',
    },
    sources: {
      typespec: { file: 'idl/main.tsp', line: 1, column: 1 },
      generatedJsonSchema: { file: 'generated/schema.json', pointer: '#/$defs/Message' },
      authoredJsonSchema: { file: 'schema/message.json', pointer: '#/$defs/Message' },
    },
    assertionSchema,
    assertionDigest: digestJson(assertionSchema),
    lanes: {
      typespecGeneratedJsonSchema: {
        role: 'comparison-evidence-only',
        name: 'Example.Message',
        kind: 'model',
        schemaDigest: digestJson(assertionSchema),
        normalizedSchema: assertionSchema,
      },
      authoredJsonSchema: {
        role: 'independently-authored-authority',
        name: 'Example.Message',
        kind: 'model',
        schemaDigest: digestJson(assertionSchema),
        normalizedSchema: assertionSchema,
      },
    },
  };
  const contractBody = {
    schema: 'ores.typespec-json-schema-validator.contract-ir/v1',
    status: 'passed',
    admissible: true,
    role: 'downstream-derived-parity-artifact',
    editableAuthority: false,
    authorities: {
      typespec: 'independently-authored',
      jsonSchema: 'independently-authored',
      generatedJsonSchema: 'comparison-evidence-only',
      precedence: 'none',
    },
    admission: {
      receipt: {
        schema: receipt.schema,
        runId: receipt.runId,
        digest: digestJson(receipt),
        status: receipt.status,
        zeroUnexplainedFindings: true,
      },
      requirements: {
        exactInputDigests: true,
        directDeclarationInventory: true,
        generatedSchemaComparison: true,
        differentialInstanceValidation: true,
        zeroUnexplainedFindings: true,
      },
      scope: { admittedDeclarations: 1, excludedDeclarations: 0, outOfScopeDeclarations: 0, complete: true },
    },
    provenance: {
      typespec: { role: 'independently-authored-authority', digest: receipt.inputs.typespec.digest, files: [] },
      generatedJsonSchema: { role: 'comparison-evidence-only', digest: receipt.inputs.generatedJsonSchema.digest, files: [] },
      authoredJsonSchema: { role: 'independently-authored-authority', digest: receipt.inputs.authoredJsonSchema.digest, files: [] },
    },
    toolchain: {},
    configuration: {},
    coverage: receipt.coverage,
    differential: {},
    declarations: [declaration],
    excludedDeclarations: [],
    outOfScopeDeclarations: [],
  };
  const contractIr = { ...contractBody, irId: digestJson(contractBody) };
  const sourceDigests = {
    typespec: receipt.inputs.typespec.digest,
    generatedJsonSchema: receipt.inputs.generatedJsonSchema.digest,
    authoredJsonSchema: receipt.inputs.authoredJsonSchema.digest,
  };
  const inputs = {
    operationInventory: { path: 'operations/api-ir.json', sha256: digest('ops'), size: 1 },
    projectionMetadata: { path: 'idl/projection.lock.json', sha256: digest('lock'), size: 1 },
    emitterConfiguration: { path: 'config/projections.json', sha256: digest('config'), size: 1 },
  };
  const toolchains = [{ id: 'tjsv', version: 'test', artifactDigest: digest('tool') }];
  const outputs = [
    { path: 'generated/protobuf/message.proto', sha256: digest('proto'), size: 1, mediaType: 'text/plain', projection: 'protobuf' },
    { path: 'generated/wit/message.wit', sha256: digest('wit'), size: 1, mediaType: 'text/plain', projection: 'wit' },
    { path: 'generated/dafny/message.dfy', sha256: digest('dafny'), size: 1, mediaType: 'text/plain', projection: 'dafny' },
  ];
  const projections = ADDITIVE_PROJECTION_IDS.map((id) => ({
    id,
    emitter: `test-${id}`,
    declarationIds: ['Example.Message'],
    outputPaths: outputs.filter((output) => output.projection === id).map((output) => output.path),
    representationDeltaIds: [],
    runtimeValidatorIds: [],
  }));
  const manifest = createProjectionManifest({
    contractIr,
    parityReceipt: receipt,
    expectedSourceDigests: sourceDigests,
    inputs,
    toolchains,
    projections,
    outputs,
  });
  return { manifest, contractIr, receipt, sourceDigests, inputs, toolchains, outputs };
}

test('protobuf wit and dafny coexist as digest-bound downstream projections', () => {
  const value = fixture();
  const report = verifyProjectionManifest({
    manifest: value.manifest,
    contractIr: value.contractIr,
    parityReceipt: value.receipt,
    expectedSourceDigests: value.sourceDigests,
    expectedInputs: value.inputs,
    requiredToolchains: value.toolchains,
    actualOutputs: value.outputs,
    requiredProjections: ADDITIVE_PROJECTION_IDS,
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.admissible, true);
  assert.deepEqual(value.manifest.projections.map(({ id }) => id), ['dafny', 'protobuf', 'wit']);
  assert.equal(report.summary.projections, 3);
  assert.equal(report.summary.outputs, 3);
});

test('WIT byte drift invalidates the shared additive projection receipt', () => {
  const value = fixture();
  const actualOutputs = value.outputs.map((output) =>
    output.projection === 'wit' ? { ...output, sha256: digest('wit-drift') } : output,
  );
  const report = verifyProjectionManifest({
    manifest: value.manifest,
    contractIr: value.contractIr,
    parityReceipt: value.receipt,
    expectedSourceDigests: value.sourceDigests,
    expectedInputs: value.inputs,
    requiredToolchains: value.toolchains,
    actualOutputs,
    requiredProjections: ADDITIVE_PROJECTION_IDS,
  });
  assert.notEqual(report.status, 'passed');
  assert.equal(report.admissible, false);
});
