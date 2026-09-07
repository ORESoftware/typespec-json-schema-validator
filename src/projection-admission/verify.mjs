import { canonicalStringify, sha256 } from '../canonical.mjs';
import {
  PROJECTION_ADMISSION_REPORT_SCHEMA,
  PROJECTION_MANIFEST_SCHEMA,
  validDigest,
} from './constants.mjs';
import { contractAssertionDigestMap, verifyProjectionContract } from './contract.mjs';
import { makeProjectionFinding, sortProjectionFindings } from './findings.mjs';
import { normalizeProjectionManifest } from './normalize.mjs';

function digestJson(value) {
  return sha256(canonicalStringify(value));
}

function add(findings, ruleId, pointer, message, extra = {}) {
  findings.push(makeProjectionFinding({ ruleId, pointer, message, ...extra }));
}

function mapBy(items, key) {
  return new Map((items ?? []).map((item) => [item[key], item]));
}

function equalDescriptor(left, right, fields) {
  return left && right && fields.every((field) => left[field] === right[field]);
}

function verifyManifestId(manifest, findings) {
  if (!manifest) return;
  const { manifestId, ...body } = manifest;
  if (digestJson(body) !== manifestId) {
    add(findings, 'projection-manifest-id-mismatch', '#/manifestId', 'projection manifest self digest is stale or tampered');
  }
}

function verifyContractBinding(manifest, binding, findings) {
  if (!manifest || !binding) return;
  for (const key of ['contractIrId', 'contractIrDigest', 'receiptRunId', 'receiptDigest']) {
    if (manifest.contract[key] !== binding[key]) {
      add(findings, 'projection-manifest-contract-binding-mismatch', `#/contract/${key}`, 'manifest contract binding does not match supplied evidence');
    }
  }
  for (const lane of ['typespec', 'generatedJsonSchema', 'authoredJsonSchema']) {
    if (manifest.contract.sourceDigests[lane] !== binding.sourceDigests[lane]) {
      add(findings, 'projection-manifest-source-binding-mismatch', `#/contract/sourceDigests/${lane}`, 'manifest source binding does not match supplied evidence');
    }
  }
}

function verifyInputs(manifest, expectedInputs, findings) {
  if (!manifest) return;
  for (const key of ['operationInventory', 'projectionMetadata', 'emitterConfiguration']) {
    const actual = manifest.inputs[key];
    const expected = expectedInputs?.[key];
    if (!equalDescriptor(actual, expected, ['path', 'sha256', 'size'])) {
      add(findings, 'projection-input-binding-mismatch', `#/inputs/${key}`, 'projection input does not match the independently observed file');
    }
  }
}

function verifyToolchains(manifest, requiredToolchains, findings) {
  if (!manifest) return;
  if (!Array.isArray(requiredToolchains)) {
    add(findings, 'projection-trusted-toolchains-missing', '#/requiredToolchains', 'trusted required toolchains must be supplied separately');
    return;
  }
  const actual = mapBy(manifest.toolchains, 'id');
  const expected = mapBy(requiredToolchains, 'id');
  if (actual.size !== manifest.toolchains.length || expected.size !== requiredToolchains.length) {
    add(findings, 'projection-trusted-toolchain-duplicate', '#/requiredToolchains', 'trusted or manifest toolchain ids are duplicated');
  }
  for (const [id, descriptor] of expected) {
    if (!equalDescriptor(actual.get(id), descriptor, ['id', 'version', 'artifactDigest'])) {
      add(findings, 'projection-toolchain-binding-mismatch', '#/toolchains', 'required toolchain identity, version, or artifact digest does not match');
    }
  }
  for (const id of actual.keys()) {
    if (!expected.has(id)) {
      add(findings, 'projection-toolchain-unexpected', '#/toolchains', 'manifest contains a toolchain not present in the trusted toolchain set');
    }
  }
}

function verifyDeclarations(manifest, declarationIds, findings) {
  if (!manifest) return;
  const expected = [...declarationIds].sort((left, right) => left.localeCompare(right));
  if (canonicalStringify(manifest.declarations) !== canonicalStringify(expected)) {
    add(findings, 'projection-declaration-closure-mismatch', '#/declarations', 'manifest declaration closure does not exactly match admitted Contract IR declarations');
  }
}

function verifyOutputs(manifest, actualOutputs, findings) {
  if (!manifest) return;
  if (!Array.isArray(actualOutputs)) {
    add(findings, 'projection-actual-outputs-missing', '#/actualOutputs', 'independently observed output descriptors must be supplied');
    return;
  }
  const actualMap = mapBy(actualOutputs, 'path');
  const manifestMap = mapBy(manifest.outputs, 'path');
  if (actualMap.size !== actualOutputs.length) {
    add(findings, 'projection-actual-output-duplicate', '#/actualOutputs', 'independently observed output paths are duplicated');
  }
  for (const output of manifest.outputs) {
    if (!equalDescriptor(output, actualMap.get(output.path), ['path', 'sha256', 'size', 'mediaType', 'projection'])) {
      add(findings, 'projection-output-binding-mismatch', '#/outputs', 'manifest output does not match the independently observed file', {
        projection: output.projection,
        path: output.path,
      });
    }
  }
  for (const output of actualOutputs) {
    if (!manifestMap.has(output.path)) {
      add(findings, 'projection-output-unmanifested', '#/actualOutputs', 'an observed output is not declared by the manifest', {
        projection: output.projection,
        path: output.path,
      });
    }
  }
}

function verifyProjectionTopology(manifest, requiredProjections, findings) {
  if (!manifest) return;
  if (!Array.isArray(requiredProjections) || requiredProjections.length === 0) {
    add(findings, 'projection-required-targets-missing', '#/requiredProjections', 'trusted required projection ids must be supplied');
    return;
  }
  const projections = mapBy(manifest.projections, 'id');
  const outputsByProjection = new Map();
  for (const output of manifest.outputs) {
    if (!outputsByProjection.has(output.projection)) outputsByProjection.set(output.projection, []);
    outputsByProjection.get(output.projection).push(output.path);
    if (!projections.has(output.projection)) {
      add(findings, 'projection-output-target-unknown', '#/outputs', 'output references an undeclared projection', {
        projection: output.projection,
        path: output.path,
      });
    }
  }
  const requiredSet = new Set(requiredProjections);
  for (const id of requiredSet) {
    if (!projections.has(id)) {
      add(findings, 'projection-required-target-missing', '#/projections', 'required projection target is absent');
    }
  }
  for (const projection of manifest.projections) {
    if (!requiredSet.has(projection.id)) {
      add(findings, 'projection-target-unexpected', '#/projections', 'manifest contains a projection not present in the trusted required set', { projection: projection.id });
    }
    if (canonicalStringify(projection.declarationIds) !== canonicalStringify(manifest.declarations)) {
      add(findings, 'projection-target-declaration-coverage-mismatch', '#/projections', 'projection target does not cover the exact admitted declaration closure', { projection: projection.id });
    }
    const observedPaths = [...(outputsByProjection.get(projection.id) ?? [])].sort((left, right) => left.localeCompare(right));
    if (canonicalStringify(projection.outputPaths) !== canonicalStringify(observedPaths)) {
      add(findings, 'projection-target-output-closure-mismatch', '#/projections', 'projection target output references do not match manifest outputs', { projection: projection.id });
    }
    if (projection.outputPaths.length === 0) {
      add(findings, 'projection-target-output-empty', '#/projections', 'projection target must declare at least one output', { projection: projection.id });
    }
  }
}

function verifyDeltas(manifest, contractIr, approvedDeltas, expectedRuntimeValidators, findings) {
  if (!manifest) return;
  const deltaMap = mapBy(manifest.representationDeltas, 'id');
  const validatorMap = mapBy(manifest.runtimeValidators, 'id');
  const assertionDigests = contractAssertionDigestMap(contractIr);
  const approvalMap = Array.isArray(approvedDeltas) ? mapBy(approvedDeltas, 'id') : null;
  const expectedValidatorMap = Array.isArray(expectedRuntimeValidators)
    ? mapBy(expectedRuntimeValidators, 'id')
    : null;
  if (manifest.representationDeltas.length > 0 && !approvalMap) {
    add(findings, 'projection-reviewed-delta-evidence-missing', '#/approvedDeltas', 'trusted reviewed-delta evidence must be supplied separately');
  }
  if (manifest.runtimeValidators.length > 0 && !expectedValidatorMap) {
    add(findings, 'projection-runtime-validator-evidence-missing', '#/expectedRuntimeValidators', 'trusted runtime-validator evidence must be supplied separately');
  }
  const referencedDeltas = new Set();
  const referencedValidators = new Set();
  for (const projection of manifest.projections) {
    for (const id of projection.representationDeltaIds) {
      const delta = deltaMap.get(id);
      if (!delta || delta.projection !== projection.id) {
        add(findings, 'projection-delta-reference-mismatch', '#/projections', 'projection references a missing or cross-target representation delta', { projection: projection.id });
      } else if (referencedDeltas.has(id)) {
        add(findings, 'projection-delta-reference-reused', '#/projections', 'representation delta is referenced by more than one projection');
      } else {
        referencedDeltas.add(id);
      }
    }
    for (const id of projection.runtimeValidatorIds) {
      const validator = validatorMap.get(id);
      if (!validator || validator.projection !== projection.id) {
        add(findings, 'projection-runtime-validator-reference-mismatch', '#/projections', 'projection references a missing or cross-target runtime validator', { projection: projection.id });
      } else if (referencedValidators.has(id)) {
        add(findings, 'projection-runtime-validator-reference-reused', '#/projections', 'runtime validator is referenced by more than one projection');
      } else {
        referencedValidators.add(id);
      }
    }
  }
  for (const delta of manifest.representationDeltas) {
    if (!referencedDeltas.has(delta.id)) {
      add(findings, 'projection-delta-unreferenced', '#/representationDeltas', 'representation delta is not referenced by its projection', { projection: delta.projection });
    }
    const assertionDigest = assertionDigests.get(delta.declaration);
    if (!assertionDigest || assertionDigest !== delta.sourceDigest) {
      add(findings, 'projection-delta-source-stale', '#/representationDeltas', 'representation delta is not bound to the current Contract IR declaration', { projection: delta.projection });
    }
    const approval = approvalMap?.get(delta.id);
    if (!approval
      || approval.projection !== delta.projection
      || approval.declaration !== delta.declaration
      || approval.sourceDigest !== delta.sourceDigest
      || approval.approvalDigest !== delta.review.approvalDigest
      || approval.negativeFixtureDigest !== delta.negativeFixtureDigest) {
      add(findings, 'projection-delta-approval-mismatch', '#/representationDeltas', 'representation delta does not match independently supplied reviewed approval evidence', { projection: delta.projection });
    }
    if (delta.runtimeValidatorRequired) {
      const validator = validatorMap.get(delta.runtimeValidatorId);
      if (!validator
        || validator.projection !== delta.projection
        || validator.fixtureDigest !== delta.negativeFixtureDigest
        || !referencedValidators.has(validator.id)) {
        add(findings, 'projection-delta-runtime-validator-mismatch', '#/representationDeltas', 'runtime-required representation delta lacks matching executable evidence', { projection: delta.projection });
      }
    }
  }
  for (const validator of manifest.runtimeValidators) {
    if (!referencedValidators.has(validator.id)) {
      add(findings, 'projection-runtime-validator-unreferenced', '#/runtimeValidators', 'runtime validator is not referenced by its projection', { projection: validator.projection });
    }
    const expected = expectedValidatorMap?.get(validator.id);
    if (!equalDescriptor(validator, expected, [
      'id',
      'projection',
      'artifactPath',
      'artifactDigest',
      'fixtureDigest',
      'ingressEgressCoverageDigest',
    ])) {
      add(findings, 'projection-runtime-validator-binding-mismatch', '#/runtimeValidators', 'runtime validator artifact, fixture, or ingress/egress coverage does not match trusted evidence', { projection: validator.projection });
    }
  }
  for (const approval of approvedDeltas ?? []) {
    if (!deltaMap.has(approval.id)) {
      add(findings, 'projection-approved-delta-unmanifested', '#/approvedDeltas', 'trusted reviewed delta is absent from the manifest');
    }
  }
  for (const validator of expectedRuntimeValidators ?? []) {
    if (!validatorMap.has(validator.id)) {
      add(findings, 'projection-expected-runtime-validator-unmanifested', '#/expectedRuntimeValidators', 'trusted runtime validator is absent from the manifest');
    }
  }
}

function reportFrom({ findings, manifest, binding, evidence }) {
  const sorted = sortProjectionFindings(findings);
  const status = sorted.length === 0 ? 'passed' : 'stopped_for_evaluation';
  const summary = Object.freeze({
    declarations: manifest?.declarations.length ?? 0,
    projections: manifest?.projections.length ?? 0,
    outputs: manifest?.outputs.length ?? 0,
    representationDeltas: manifest?.representationDeltas.length ?? 0,
    runtimeValidators: manifest?.runtimeValidators.length ?? 0,
  });
  const evidenceDigest = digestJson({
    manifestId: manifest?.manifestId ?? null,
    contractIrId: binding?.contractIrId ?? null,
    receiptRunId: binding?.receiptRunId ?? null,
    evidence,
  });
  return Object.freeze({
    schema: PROJECTION_ADMISSION_REPORT_SCHEMA,
    status,
    admissible: status === 'passed',
    manifestId: manifest?.manifestId ?? null,
    contractIrId: binding?.contractIrId ?? null,
    receiptRunId: binding?.receiptRunId ?? null,
    evidenceDigest,
    summary,
    findings: Object.freeze(sorted),
  });
}

export function verifyProjectionManifest({
  manifest: suppliedManifest,
  contractIr,
  parityReceipt,
  expectedSourceDigests,
  expectedInputs,
  requiredToolchains,
  actualOutputs,
  requiredProjections,
  approvedDeltas = [],
  expectedRuntimeValidators = [],
  limits,
} = {}) {
  const normalized = normalizeProjectionManifest(suppliedManifest, { limits });
  const findings = [...normalized.findings];
  const manifest = normalized.manifest;
  const contract = verifyProjectionContract({ contractIr, parityReceipt, expectedSourceDigests });
  findings.push(...contract.findings);
  verifyManifestId(manifest, findings);
  verifyContractBinding(manifest, contract.binding, findings);
  verifyInputs(manifest, expectedInputs, findings);
  verifyToolchains(manifest, requiredToolchains, findings);
  verifyDeclarations(manifest, contract.declarationIds, findings);
  verifyOutputs(manifest, actualOutputs, findings);
  verifyProjectionTopology(manifest, requiredProjections, findings);
  verifyDeltas(manifest, contractIr, approvedDeltas, expectedRuntimeValidators, findings);
  return reportFrom({
    findings,
    manifest,
    binding: contract.binding,
    evidence: {
      expectedSourceDigests: expectedSourceDigests ?? null,
      expectedInputs: expectedInputs ?? null,
      requiredToolchains: requiredToolchains ?? null,
      actualOutputs: actualOutputs ?? null,
      requiredProjections: requiredProjections ?? null,
      approvedDeltas,
      expectedRuntimeValidators,
    },
  });
}

export function createProjectionManifest({
  contractIr,
  parityReceipt,
  expectedSourceDigests,
  inputs,
  toolchains,
  projections,
  outputs,
  representationDeltas = [],
  runtimeValidators = [],
  limits,
} = {}) {
  const contract = verifyProjectionContract({ contractIr, parityReceipt, expectedSourceDigests });
  if (!contract.binding || contract.findings.length > 0) {
    throw new Error('cannot create projection manifest from inadmissible or stale contract evidence');
  }
  const draft = {
    schema: PROJECTION_MANIFEST_SCHEMA,
    manifestId: '0'.repeat(64),
    status: 'passed',
    contract: contract.binding,
    inputs,
    toolchains,
    declarations: contract.declarationIds,
    projections,
    outputs,
    representationDeltas,
    runtimeValidators,
  };
  const normalized = normalizeProjectionManifest(draft, { limits });
  if (!normalized.manifest || normalized.findings.length > 0) {
    throw new Error('cannot create projection manifest from invalid projection metadata');
  }
  const { manifestId: ignored, ...body } = normalized.manifest;
  void ignored;
  return Object.freeze({ ...body, manifestId: digestJson(body) });
}

export function projectionManifestDigest(manifest) {
  return validDigest(manifest?.manifestId) ? digestJson(manifest) : null;
}
