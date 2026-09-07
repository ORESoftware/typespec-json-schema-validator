import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  PROJECTION_ADMISSION_REPORT_SCHEMA,
  PROJECTION_MANIFEST_SCHEMA,
  createProjectionManifest,
  hashProjectionFiles,
  loadProjectionManifest,
  normalizeProjectionManifest,
  projectionManifestDigest,
  verifyProjectionContract,
  verifyProjectionManifest,
} from '../../src/projection-admission/index.mjs';

const digest = (value) => sha256(String(value));
const digestJson = (value) => sha256(canonicalStringify(value));
const clone = (value) => structuredClone(value);

function makeReceipt() {
  return {
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
}

function makeDeclaration(id = 'Accounts.User') {
  const assertionSchema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
    additionalProperties: false,
  };
  const generatedSchema = clone(assertionSchema);
  const authoredSchema = clone(assertionSchema);
  return {
    id,
    kind: 'model',
    names: {
      typespec: id,
      generatedJsonSchema: id,
      authoredJsonSchema: id,
    },
    sources: {
      typespec: { file: 'idl/main.tsp', line: 1, column: 1 },
      generatedJsonSchema: { file: 'generated/schema.json', pointer: '#/$defs/User' },
      authoredJsonSchema: { file: 'schema/user.json', pointer: '#/$defs/User' },
    },
    assertionSchema,
    assertionDigest: digestJson(assertionSchema),
    lanes: {
      typespecGeneratedJsonSchema: {
        role: 'comparison-evidence-only',
        name: id,
        kind: 'model',
        schemaDigest: digestJson(generatedSchema),
        normalizedSchema: generatedSchema,
      },
      authoredJsonSchema: {
        role: 'independently-authored-authority',
        name: id,
        kind: 'model',
        schemaDigest: digestJson(authoredSchema),
        normalizedSchema: authoredSchema,
      },
    },
  };
}

function makeContractIr(receipt = makeReceipt(), declarations = [makeDeclaration()]) {
  const body = {
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
        zeroUnexplainedFindings: receipt.zeroUnexplainedFindings,
      },
      requirements: {
        exactInputDigests: true,
        directDeclarationInventory: true,
        generatedSchemaComparison: true,
        differentialInstanceValidation: true,
        zeroUnexplainedFindings: true,
      },
      scope: {
        admittedDeclarations: declarations.length,
        excludedDeclarations: 0,
        outOfScopeDeclarations: 0,
        complete: true,
      },
    },
    provenance: {
      typespec: {
        role: 'independently-authored-authority',
        digest: receipt.inputs.typespec.digest,
        files: [],
      },
      generatedJsonSchema: {
        role: 'comparison-evidence-only',
        digest: receipt.inputs.generatedJsonSchema.digest,
        files: [],
      },
      authoredJsonSchema: {
        role: 'independently-authored-authority',
        digest: receipt.inputs.authoredJsonSchema.digest,
        files: [],
      },
    },
    toolchain: {},
    configuration: {},
    coverage: receipt.coverage,
    differential: {},
    declarations,
    excludedDeclarations: [],
    outOfScopeDeclarations: [],
  };
  return { ...body, irId: digestJson(body) };
}

function expectedSourceDigests(receipt) {
  return {
    typespec: receipt.inputs.typespec.digest,
    generatedJsonSchema: receipt.inputs.generatedJsonSchema.digest,
    authoredJsonSchema: receipt.inputs.authoredJsonSchema.digest,
  };
}

function makeInputs() {
  return {
    operationInventory: {
      path: 'operations/api-ir.json',
      sha256: digest('operations'),
      size: 123,
    },
    projectionMetadata: {
      path: 'idl/protobuf.lock.json',
      sha256: digest('field-lock'),
      size: 456,
    },
    emitterConfiguration: {
      path: 'config/protobuf-emitter.json',
      sha256: digest('emitter-config'),
      size: 78,
    },
  };
}

function makeToolchains() {
  return [
    { id: 'api-docs', version: '0.8.0', artifactDigest: digest('api-docs') },
    { id: 'buf', version: '1.58.0', artifactDigest: digest('buf') },
    { id: 'protoc', version: '33.0', artifactDigest: digest('protoc') },
  ];
}

function makeOutputs() {
  return [
    {
      path: 'generated/protobuf/accounts.proto',
      sha256: digest('accounts.proto'),
      size: 901,
      mediaType: 'text/plain',
      projection: 'protobuf',
    },
    {
      path: 'generated/protobuf/descriptors.pb',
      sha256: digest('descriptors.pb'),
      size: 902,
      mediaType: 'application/octet-stream',
      projection: 'protobuf',
    },
  ];
}

function makeProjection(declarationIds = ['Accounts.User'], outputs = makeOutputs()) {
  return {
    id: 'protobuf',
    emitter: 'api-docs-protobuf',
    declarationIds,
    outputPaths: outputs.map((item) => item.path),
    representationDeltaIds: [],
    runtimeValidatorIds: [],
  };
}

function makeBase() {
  const parityReceipt = makeReceipt();
  const contractIr = makeContractIr(parityReceipt);
  const sourceDigests = expectedSourceDigests(parityReceipt);
  const inputs = makeInputs();
  const toolchains = makeToolchains();
  const outputs = makeOutputs();
  const projections = [makeProjection(['Accounts.User'], outputs)];
  const manifest = createProjectionManifest({
    contractIr,
    parityReceipt,
    expectedSourceDigests: sourceDigests,
    inputs,
    toolchains,
    projections,
    outputs,
  });
  const verification = {
    manifest,
    contractIr,
    parityReceipt,
    expectedSourceDigests: sourceDigests,
    expectedInputs: inputs,
    requiredToolchains: toolchains,
    actualOutputs: outputs,
    requiredProjections: ['protobuf'],
  };
  return { manifest, contractIr, parityReceipt, sourceDigests, inputs, toolchains, outputs, projections, verification };
}

function ruleIds(report) {
  return report.findings.map((item) => item.ruleId);
}

function recomputeManifestId(manifest) {
  const { manifestId, ...body } = manifest;
  void manifestId;
  return { ...body, manifestId: digestJson(body) };
}

test('exports stable projection admission schema identifiers', () => {
  assert.equal(PROJECTION_MANIFEST_SCHEMA, 'ores.typespec-json-schema-validator.projection-manifest/v1');
  assert.equal(PROJECTION_ADMISSION_REPORT_SCHEMA, 'ores.typespec-json-schema-validator.projection-admission-report/v1');
});

test('creates a deterministic canonical manifest independent of caller array order', () => {
  const left = makeBase().manifest;
  const base = makeBase();
  const right = createProjectionManifest({
    contractIr: base.contractIr,
    parityReceipt: base.parityReceipt,
    expectedSourceDigests: base.sourceDigests,
    inputs: base.inputs,
    toolchains: [...base.toolchains].reverse(),
    projections: base.projections,
    outputs: [...base.outputs].reverse(),
  });
  assert.deepEqual(right, left);
});

test('admits an exact digest-bound downstream projection', () => {
  const report = verifyProjectionManifest(makeBase().verification);
  assert.equal(report.status, 'passed');
  assert.equal(report.admissible, true);
  assert.equal(report.findings.length, 0);
  assert.deepEqual(report.summary, {
    declarations: 1,
    projections: 1,
    outputs: 2,
    representationDeltas: 0,
    runtimeValidators: 0,
  });
});

test('projection admission report is deterministic', () => {
  const input = makeBase().verification;
  assert.deepEqual(verifyProjectionManifest(input), verifyProjectionManifest(clone(input)));
});

test('projectionManifestDigest returns a digest for a valid manifest id', () => {
  const { manifest } = makeBase();
  assert.match(projectionManifestDigest(manifest), /^[a-f0-9]{64}$/u);
});

test('verifies the peer-authority Contract IR boundary directly', () => {
  const base = makeBase();
  const result = verifyProjectionContract({
    contractIr: base.contractIr,
    parityReceipt: base.parityReceipt,
    expectedSourceDigests: base.sourceDigests,
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.binding.contractIrId, base.contractIr.irId);
  assert.deepEqual(result.declarationIds, ['Accounts.User']);
});

test('rejects a non-passed parity receipt', () => {
  const base = makeBase();
  const parityReceipt = { ...base.parityReceipt, status: 'failed' };
  const report = verifyProjectionManifest({ ...base.verification, parityReceipt });
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.ok(ruleIds(report).includes('projection-receipt-status-invalid'));
});

test('rejects a parity receipt with findings despite a copied zero flag', () => {
  const base = makeBase();
  const parityReceipt = { ...base.parityReceipt, findings: [{ ruleId: 'copied-green' }] };
  const report = verifyProjectionManifest({ ...base.verification, parityReceipt });
  assert.ok(ruleIds(report).includes('projection-receipt-findings-present'));
});

test('rejects an inadmissible Contract IR', () => {
  const base = makeBase();
  const contractIr = { ...base.contractIr, admissible: false };
  const report = verifyProjectionManifest({ ...base.verification, contractIr });
  assert.ok(ruleIds(report).includes('projection-contract-ir-not-admissible'));
});

test('rejects a Contract IR that ranks an authored authority above its peer', () => {
  const base = makeBase();
  const contractIr = clone(base.contractIr);
  contractIr.authorities.precedence = 'typespec';
  const report = verifyProjectionManifest({ ...base.verification, contractIr });
  assert.ok(ruleIds(report).includes('projection-contract-authority-model-invalid'));
});

test('rejects a tampered Contract IR self digest', () => {
  const base = makeBase();
  const contractIr = clone(base.contractIr);
  contractIr.coverage.extra = true;
  const report = verifyProjectionManifest({ ...base.verification, contractIr });
  assert.ok(ruleIds(report).includes('projection-contract-ir-id-mismatch'));
});

test('rejects a tampered declaration assertion digest', () => {
  const base = makeBase();
  const contractIr = clone(base.contractIr);
  contractIr.declarations[0].assertionSchema.properties.id.minLength = 2;
  const { irId, ...body } = contractIr;
  void irId;
  contractIr.irId = digestJson(body);
  const report = verifyProjectionManifest({ ...base.verification, contractIr });
  assert.ok(ruleIds(report).includes('projection-contract-assertion-digest-mismatch'));
});

test('rejects a tampered source-lane digest', () => {
  const base = makeBase();
  const contractIr = clone(base.contractIr);
  contractIr.declarations[0].lanes.authoredJsonSchema.normalizedSchema.type = 'array';
  const { irId, ...body } = contractIr;
  void irId;
  contractIr.irId = digestJson(body);
  const report = verifyProjectionManifest({ ...base.verification, contractIr });
  assert.ok(ruleIds(report).includes('projection-contract-lane-digest-mismatch'));
});

test('rejects a Contract IR bound to a different parity receipt', () => {
  const base = makeBase();
  const parityReceipt = { ...base.parityReceipt, runId: digest('other-run') };
  const report = verifyProjectionManifest({ ...base.verification, parityReceipt });
  assert.ok(ruleIds(report).includes('projection-contract-receipt-binding-mismatch'));
});

test('rejects checked-out TypeSpec source drift', () => {
  const base = makeBase();
  const report = verifyProjectionManifest({
    ...base.verification,
    expectedSourceDigests: { ...base.sourceDigests, typespec: digest('changed-typespec') },
  });
  assert.ok(ruleIds(report).includes('projection-contract-current-source-mismatch'));
});

test('rejects a stale projection manifest id', () => {
  const base = makeBase();
  const manifest = clone(base.manifest);
  manifest.outputs[0].size += 1;
  const report = verifyProjectionManifest({ ...base.verification, manifest });
  assert.ok(ruleIds(report).includes('projection-manifest-id-mismatch'));
});

test('rejects copied contract binding strings', () => {
  const base = makeBase();
  const manifest = clone(base.manifest);
  manifest.contract.receiptDigest = digest('copied-green');
  const adjusted = recomputeManifestId(manifest);
  const report = verifyProjectionManifest({ ...base.verification, manifest: adjusted });
  assert.ok(ruleIds(report).includes('projection-manifest-contract-binding-mismatch'));
});

test('rejects operation-inventory drift', () => {
  const base = makeBase();
  const expectedInputs = clone(base.inputs);
  expectedInputs.operationInventory.sha256 = digest('different-operations');
  const report = verifyProjectionManifest({ ...base.verification, expectedInputs });
  assert.ok(ruleIds(report).includes('projection-input-binding-mismatch'));
});

test('rejects protobuf field-lock or projection-metadata drift', () => {
  const base = makeBase();
  const expectedInputs = clone(base.inputs);
  expectedInputs.projectionMetadata.sha256 = digest('different-lock');
  const report = verifyProjectionManifest({ ...base.verification, expectedInputs });
  assert.ok(ruleIds(report).includes('projection-input-binding-mismatch'));
});

test('rejects emitter configuration drift', () => {
  const base = makeBase();
  const expectedInputs = clone(base.inputs);
  expectedInputs.emitterConfiguration.sha256 = digest('different-emitter');
  const report = verifyProjectionManifest({ ...base.verification, expectedInputs });
  assert.ok(ruleIds(report).includes('projection-input-binding-mismatch'));
});

test('rejects missing trusted toolchain evidence', () => {
  const base = makeBase();
  const report = verifyProjectionManifest({ ...base.verification, requiredToolchains: undefined });
  assert.ok(ruleIds(report).includes('projection-trusted-toolchains-missing'));
});

test('rejects a toolchain version mismatch', () => {
  const base = makeBase();
  const requiredToolchains = clone(base.toolchains);
  requiredToolchains[0].version = '0.9.0';
  const report = verifyProjectionManifest({ ...base.verification, requiredToolchains });
  assert.ok(ruleIds(report).includes('projection-toolchain-binding-mismatch'));
});

test('rejects an untrusted extra toolchain', () => {
  const base = makeBase();
  const manifest = clone(base.manifest);
  manifest.toolchains.push({ id: 'unreviewed', version: '1', artifactDigest: digest('x') });
  const report = verifyProjectionManifest({ ...base.verification, manifest: recomputeManifestId(manifest) });
  assert.ok(ruleIds(report).includes('projection-toolchain-unexpected'));
});

test('rejects declaration closure drift', () => {
  const base = makeBase();
  const manifest = clone(base.manifest);
  manifest.declarations = [];
  manifest.projections[0].declarationIds = [];
  const report = verifyProjectionManifest({ ...base.verification, manifest: recomputeManifestId(manifest) });
  assert.ok(ruleIds(report).includes('projection-declaration-closure-mismatch'));
});

test('rejects a projection that covers only part of the admitted declaration closure', () => {
  const parityReceipt = makeReceipt();
  const contractIr = makeContractIr(parityReceipt, [makeDeclaration(), makeDeclaration('Accounts.Team')]);
  const sourceDigests = expectedSourceDigests(parityReceipt);
  const inputs = makeInputs();
  const toolchains = makeToolchains();
  const outputs = makeOutputs();
  const manifest = createProjectionManifest({
    contractIr,
    parityReceipt,
    expectedSourceDigests: sourceDigests,
    inputs,
    toolchains,
    projections: [makeProjection(['Accounts.User'], outputs)],
    outputs,
  });
  const report = verifyProjectionManifest({
    manifest,
    contractIr,
    parityReceipt,
    expectedSourceDigests: sourceDigests,
    expectedInputs: inputs,
    requiredToolchains: toolchains,
    actualOutputs: outputs,
    requiredProjections: ['protobuf'],
  });
  assert.ok(ruleIds(report).includes('projection-target-declaration-coverage-mismatch'));
});

test('rejects a missing required projection target', () => {
  const base = makeBase();
  const report = verifyProjectionManifest({ ...base.verification, requiredProjections: ['protobuf', 'grpc'] });
  assert.ok(ruleIds(report).includes('projection-required-target-missing'));
});

test('rejects a projection not in the trusted target set', () => {
  const base = makeBase();
  const report = verifyProjectionManifest({ ...base.verification, requiredProjections: ['grpc'] });
  assert.ok(ruleIds(report).includes('projection-target-unexpected'));
});

test('rejects output digest drift', () => {
  const base = makeBase();
  const actualOutputs = clone(base.outputs);
  actualOutputs[0].sha256 = digest('changed-output');
  const report = verifyProjectionManifest({ ...base.verification, actualOutputs });
  assert.ok(ruleIds(report).includes('projection-output-binding-mismatch'));
});

test('rejects output size drift', () => {
  const base = makeBase();
  const actualOutputs = clone(base.outputs);
  actualOutputs[0].size += 1;
  const report = verifyProjectionManifest({ ...base.verification, actualOutputs });
  assert.ok(ruleIds(report).includes('projection-output-binding-mismatch'));
});

test('rejects an unmanifested generated output', () => {
  const base = makeBase();
  const actualOutputs = [...base.outputs, {
    path: 'generated/protobuf/untracked.proto',
    sha256: digest('untracked'),
    size: 1,
    mediaType: 'text/plain',
    projection: 'protobuf',
  }];
  const report = verifyProjectionManifest({ ...base.verification, actualOutputs });
  assert.ok(ruleIds(report).includes('projection-output-unmanifested'));
});

test('rejects an output assigned to an undeclared target', () => {
  const base = makeBase();
  const manifest = clone(base.manifest);
  manifest.outputs[0].projection = 'grpc';
  const report = verifyProjectionManifest({ ...base.verification, manifest: recomputeManifestId(manifest) });
  assert.ok(ruleIds(report).includes('projection-output-target-unknown'));
});

test('rejects path traversal in manifest outputs', () => {
  const base = makeBase();
  const manifest = clone(base.manifest);
  manifest.outputs[0].path = '../secret';
  const normalized = normalizeProjectionManifest(manifest);
  assert.ok(normalized.findings.some((item) => item.ruleId === 'projection-output-path-invalid'));
});

test('rejects unknown manifest properties without echoing their values', () => {
  const base = makeBase();
  const manifest = clone(base.manifest);
  manifest.privateToken = 'SENTINEL_SHOULD_NEVER_APPEAR';
  const report = verifyProjectionManifest({ ...base.verification, manifest });
  assert.ok(ruleIds(report).includes('projection-manifest-unknown-property'));
  assert.equal(JSON.stringify(report).includes('SENTINEL_SHOULD_NEVER_APPEAR'), false);
});

test('admits a reviewed representational delta only with matching runtime enforcement', () => {
  const base = makeBase();
  const declaration = base.contractIr.declarations[0];
  const fixtureDigest = digest('negative-fixtures');
  const runtimeValidator = {
    id: 'protobuf-semantic-validator',
    projection: 'protobuf',
    artifactPath: 'generated/runtime/protobuf-validator.wasm',
    artifactDigest: digest('validator-artifact'),
    fixtureDigest,
    ingressEgressCoverageDigest: digest('all-ingress-egress'),
  };
  const delta = {
    id: 'user-conditional-flattening',
    projection: 'protobuf',
    declaration: declaration.id,
    sourcePointer: '#/properties/id',
    reason: 'The target wire format cannot encode the source conditional directly.',
    sourceDigest: declaration.assertionDigest,
    review: {
      reviewer: 'oresoftware-contract-review',
      reviewedAt: '2026-09-07T04:15:00Z',
      approvalDigest: digest('approval-record'),
    },
    runtimeValidatorRequired: true,
    runtimeValidatorId: runtimeValidator.id,
    negativeFixtureDigest: fixtureDigest,
  };
  const projections = clone(base.projections);
  projections[0].representationDeltaIds = [delta.id];
  projections[0].runtimeValidatorIds = [runtimeValidator.id];
  const manifest = createProjectionManifest({
    contractIr: base.contractIr,
    parityReceipt: base.parityReceipt,
    expectedSourceDigests: base.sourceDigests,
    inputs: base.inputs,
    toolchains: base.toolchains,
    projections,
    outputs: base.outputs,
    representationDeltas: [delta],
    runtimeValidators: [runtimeValidator],
  });
  const report = verifyProjectionManifest({
    ...base.verification,
    manifest,
    approvedDeltas: [{
      id: delta.id,
      projection: delta.projection,
      declaration: delta.declaration,
      sourceDigest: delta.sourceDigest,
      approvalDigest: delta.review.approvalDigest,
      negativeFixtureDigest: fixtureDigest,
    }],
    expectedRuntimeValidators: [runtimeValidator],
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.summary.representationDeltas, 1);
  assert.equal(report.summary.runtimeValidators, 1);
});

function makeDeltaCase() {
  const base = makeBase();
  const declaration = base.contractIr.declarations[0];
  const fixtureDigest = digest('negative-fixtures');
  const runtimeValidator = {
    id: 'protobuf-semantic-validator',
    projection: 'protobuf',
    artifactPath: 'generated/runtime/protobuf-validator.wasm',
    artifactDigest: digest('validator-artifact'),
    fixtureDigest,
    ingressEgressCoverageDigest: digest('all-ingress-egress'),
  };
  const delta = {
    id: 'user-conditional-flattening',
    projection: 'protobuf',
    declaration: declaration.id,
    sourcePointer: '#/properties/id',
    reason: 'The target wire format cannot encode the source conditional directly.',
    sourceDigest: declaration.assertionDigest,
    review: {
      reviewer: 'oresoftware-contract-review',
      reviewedAt: '2026-09-07T04:15:00Z',
      approvalDigest: digest('approval-record'),
    },
    runtimeValidatorRequired: true,
    runtimeValidatorId: runtimeValidator.id,
    negativeFixtureDigest: fixtureDigest,
  };
  const projections = clone(base.projections);
  projections[0].representationDeltaIds = [delta.id];
  projections[0].runtimeValidatorIds = [runtimeValidator.id];
  const manifest = createProjectionManifest({
    contractIr: base.contractIr,
    parityReceipt: base.parityReceipt,
    expectedSourceDigests: base.sourceDigests,
    inputs: base.inputs,
    toolchains: base.toolchains,
    projections,
    outputs: base.outputs,
    representationDeltas: [delta],
    runtimeValidators: [runtimeValidator],
  });
  return {
    base,
    delta,
    runtimeValidator,
    manifest,
    approvedDeltas: [{
      id: delta.id,
      projection: delta.projection,
      declaration: delta.declaration,
      sourceDigest: delta.sourceDigest,
      approvalDigest: delta.review.approvalDigest,
      negativeFixtureDigest: fixtureDigest,
    }],
  };
}

test('rejects a reviewed:true-style delta without independent approval evidence', () => {
  const item = makeDeltaCase();
  const report = verifyProjectionManifest({
    ...item.base.verification,
    manifest: item.manifest,
    approvedDeltas: undefined,
    expectedRuntimeValidators: [item.runtimeValidator],
  });
  assert.ok(ruleIds(report).includes('projection-delta-approval-mismatch'));
});

test('rejects stale approval digest evidence', () => {
  const item = makeDeltaCase();
  const approvedDeltas = clone(item.approvedDeltas);
  approvedDeltas[0].approvalDigest = digest('different-approval');
  const report = verifyProjectionManifest({
    ...item.base.verification,
    manifest: item.manifest,
    approvedDeltas,
    expectedRuntimeValidators: [item.runtimeValidator],
  });
  assert.ok(ruleIds(report).includes('projection-delta-approval-mismatch'));
});

test('rejects a delta bound to an obsolete declaration digest', () => {
  const item = makeDeltaCase();
  const manifest = clone(item.manifest);
  manifest.representationDeltas[0].sourceDigest = digest('obsolete-source');
  const report = verifyProjectionManifest({
    ...item.base.verification,
    manifest: recomputeManifestId(manifest),
    approvedDeltas: item.approvedDeltas,
    expectedRuntimeValidators: [item.runtimeValidator],
  });
  assert.ok(ruleIds(report).includes('projection-delta-source-stale'));
});

test('rejects a runtime-required delta without the validator reference', () => {
  const item = makeDeltaCase();
  const manifest = clone(item.manifest);
  manifest.projections[0].runtimeValidatorIds = [];
  const report = verifyProjectionManifest({
    ...item.base.verification,
    manifest: recomputeManifestId(manifest),
    approvedDeltas: item.approvedDeltas,
    expectedRuntimeValidators: [item.runtimeValidator],
  });
  assert.ok(ruleIds(report).includes('projection-delta-runtime-validator-mismatch'));
});

test('rejects runtime fixture drift', () => {
  const item = makeDeltaCase();
  const expectedRuntimeValidators = clone([item.runtimeValidator]);
  expectedRuntimeValidators[0].fixtureDigest = digest('changed-fixtures');
  const report = verifyProjectionManifest({
    ...item.base.verification,
    manifest: item.manifest,
    approvedDeltas: item.approvedDeltas,
    expectedRuntimeValidators,
  });
  assert.ok(ruleIds(report).includes('projection-runtime-validator-binding-mismatch'));
});

test('rejects missing ingress and egress coverage evidence', () => {
  const item = makeDeltaCase();
  const expectedRuntimeValidators = clone([item.runtimeValidator]);
  expectedRuntimeValidators[0].ingressEgressCoverageDigest = digest('partial-coverage');
  const report = verifyProjectionManifest({
    ...item.base.verification,
    manifest: item.manifest,
    approvedDeltas: item.approvedDeltas,
    expectedRuntimeValidators,
  });
  assert.ok(ruleIds(report).includes('projection-runtime-validator-binding-mismatch'));
});

test('createProjectionManifest rejects stale contract evidence', () => {
  const base = makeBase();
  const contractIr = { ...base.contractIr, status: 'failed' };
  assert.throws(() => createProjectionManifest({
    contractIr,
    parityReceipt: base.parityReceipt,
    expectedSourceDigests: base.sourceDigests,
    inputs: base.inputs,
    toolchains: base.toolchains,
    projections: base.projections,
    outputs: base.outputs,
  }), /inadmissible or stale/u);
});

test('loadProjectionManifest reads a bounded singly linked regular JSON file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-'));
  const path = join(directory, 'manifest.json');
  const manifest = makeBase().manifest;
  await writeFile(path, `${JSON.stringify(manifest)}\n`);
  assert.deepEqual(await loadProjectionManifest(path), manifest);
});

test('loadProjectionManifest rejects symbolic links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-'));
  const target = join(directory, 'target.json');
  const path = join(directory, 'manifest.json');
  await writeFile(target, '{}');
  await symlink(target, path);
  await assert.rejects(loadProjectionManifest(path), /singly linked regular file/u);
});

test('loadProjectionManifest rejects multiply linked files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-'));
  const target = join(directory, 'target.json');
  const path = join(directory, 'manifest.json');
  await writeFile(target, '{}');
  await link(target, path);
  await assert.rejects(loadProjectionManifest(path), /singly linked regular file/u);
});

test('loadProjectionManifest rejects oversized input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-'));
  const path = join(directory, 'manifest.json');
  await writeFile(path, '{"long":"value"}');
  await assert.rejects(loadProjectionManifest(path, { maxBytes: 4 }), /byte limit/u);
});

test('loadProjectionManifest rejects malformed JSON without echoing it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-'));
  const path = join(directory, 'manifest.json');
  await writeFile(path, '{SENTINEL_PRIVATE_VALUE');
  await assert.rejects(loadProjectionManifest(path), (error) => {
    assert.match(error.message, /valid UTF-8 JSON/u);
    assert.equal(error.message.includes('SENTINEL_PRIVATE_VALUE'), false);
    return true;
  });
});

test('hashProjectionFiles computes exact size and digest under a trusted root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-'));
  await mkdir(join(directory, 'generated'));
  await writeFile(join(directory, 'generated', 'a.proto'), 'syntax = "proto3";\n');
  const [result] = await hashProjectionFiles(directory, [{
    path: 'generated/a.proto',
    mediaType: 'text/plain',
    projection: 'protobuf',
  }]);
  assert.equal(result.size, Buffer.byteLength('syntax = "proto3";\n'));
  assert.equal(result.sha256, sha256(Buffer.from('syntax = "proto3";\n')));
  assert.equal(result.path, 'generated/a.proto');
});

test('hashProjectionFiles rejects traversal before reading', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-'));
  await assert.rejects(
    hashProjectionFiles(directory, [{ path: '../outside' }]),
    /normalized relative POSIX path/u,
  );
});

test('hashProjectionFiles rejects symbolic-link outputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-'));
  await mkdir(join(directory, 'generated'));
  const target = join(directory, 'target.proto');
  await writeFile(target, 'secret');
  await symlink(target, join(directory, 'generated', 'a.proto'));
  await assert.rejects(
    hashProjectionFiles(directory, [{ path: 'generated/a.proto' }]),
    /singly linked regular file/u,
  );
});

test('hashProjectionFiles rejects duplicate descriptors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-projection-'));
  await mkdir(join(directory, 'generated'));
  await writeFile(join(directory, 'generated', 'a.proto'), 'x');
  await assert.rejects(
    hashProjectionFiles(directory, [{ path: 'generated/a.proto' }, { path: 'generated/a.proto' }]),
    /duplicated/u,
  );
});

test('published schema is Draft 2020-12, closed, and requires independent review evidence', async () => {
  const schema = JSON.parse(await (await import('node:fs/promises')).readFile(
    new URL('../../schema/projection-manifest.schema.json', import.meta.url),
    'utf8',
  ));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.status.const, 'passed');
  assert.equal(schema.$defs.representationDelta.properties.review.$ref, '#/$defs/review');
  assert.equal(schema.$defs.representationDelta.properties.reviewed, undefined);
  assert.ok(schema.$defs.representationDelta.required.includes('sourceDigest'));
  assert.ok(schema.$defs.runtimeValidator.required.includes('ingressEgressCoverageDigest'));
});

test('package exports the immutable projection-admission API and schema subpaths', async () => {
  const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(
    new URL('../../package.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(packageJson.exports['./projection-admission'], {
    import: './src/projection-admission/index.mjs',
    types: './src/projection-admission/index.d.mts',
  });
  assert.equal(
    packageJson.exports['./schema/projection-manifest'],
    './schema/projection-manifest.schema.json',
  );
});
