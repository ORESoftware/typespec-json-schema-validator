import {
  DEFAULT_LIMITS,
  JSON_POINTER_PATTERN,
  MEDIA_TYPE_PATTERN,
  PROJECTION_MANIFEST_SCHEMA,
  boundedText,
  isPlainObject,
  validDigest,
  validIdentifier,
  validIsoInstant,
  validRelativePath,
} from './constants.mjs';
import { makeProjectionFinding } from './findings.mjs';

function add(findings, ruleId, pointer, message, extra = {}) {
  findings.push(makeProjectionFinding({ ruleId, pointer, message, ...extra }));
}

function objectShape(value, pointer, allowed, required, findings, rulePrefix) {
  if (!isPlainObject(value)) {
    add(findings, `${rulePrefix}-invalid`, pointer, 'value must be an object');
    return false;
  }
  const unknownCount = Object.keys(value).filter((key) => !allowed.has(key)).length;
  if (unknownCount > 0) {
    add(findings, `${rulePrefix}-unknown-property`, pointer, 'object contains unsupported properties');
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      add(findings, `${rulePrefix}-missing-property`, `${pointer}/${key}`, 'required property is missing');
    }
  }
  return true;
}

function normalizeDigest(value, pointer, findings, ruleId = 'projection-digest-invalid') {
  if (!validDigest(value)) {
    add(findings, ruleId, pointer, 'value must be a lowercase SHA-256 digest');
    return null;
  }
  return value;
}

function normalizeIdentifier(value, pointer, findings, ruleId = 'projection-identifier-invalid') {
  if (!validIdentifier(value)) {
    add(findings, ruleId, pointer, 'value must be a bounded lowercase identifier');
    return null;
  }
  return value;
}

function normalizePath(value, pointer, findings, ruleId = 'projection-path-invalid') {
  if (!validRelativePath(value)) {
    add(findings, ruleId, pointer, 'path must be a normalized relative POSIX path without traversal');
    return null;
  }
  return value;
}

function normalizeText(value, pointer, findings, maxLength = 512, ruleId = 'projection-text-invalid') {
  if (!boundedText(value, maxLength)) {
    add(findings, ruleId, pointer, 'value must be bounded text without control characters');
    return null;
  }
  return value;
}

function normalizeStringArray(value, pointer, findings, {
  limit,
  normalize,
  duplicateRule,
  invalidRule,
}) {
  if (!Array.isArray(value)) {
    add(findings, invalidRule, pointer, 'value must be an array');
    return [];
  }
  if (value.length > limit) {
    add(findings, `${invalidRule}-limit`, pointer, 'array exceeds the configured admission limit');
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.length, limit); index += 1) {
    const item = normalize(value[index], `${pointer}/${index}`, findings);
    if (item === null) continue;
    if (seen.has(item)) {
      add(findings, duplicateRule, `${pointer}/${index}`, 'array entry is duplicated');
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function normalizeFileDescriptor(value, pointer, findings, rulePrefix, { requireProjection = false } = {}) {
  const allowed = new Set(['path', 'sha256', 'size', ...(requireProjection ? ['mediaType', 'projection'] : [])]);
  const required = new Set(['path', 'sha256', 'size', ...(requireProjection ? ['mediaType', 'projection'] : [])]);
  if (!objectShape(value, pointer, allowed, required, findings, rulePrefix)) return null;
  const path = normalizePath(value.path, `${pointer}/path`, findings, `${rulePrefix}-path-invalid`);
  const sha256 = normalizeDigest(value.sha256, `${pointer}/sha256`, findings, `${rulePrefix}-digest-invalid`);
  let size = null;
  if (!Number.isSafeInteger(value.size) || value.size < 0) {
    add(findings, `${rulePrefix}-size-invalid`, `${pointer}/size`, 'file size must be a non-negative safe integer');
  } else {
    size = value.size;
  }
  let mediaType = null;
  let projection = null;
  if (requireProjection) {
    if (!boundedText(value.mediaType, 255) || !MEDIA_TYPE_PATTERN.test(value.mediaType)) {
      add(findings, `${rulePrefix}-media-type-invalid`, `${pointer}/mediaType`, 'mediaType must be a bounded lowercase media type');
    } else {
      mediaType = value.mediaType;
    }
    projection = normalizeIdentifier(
      value.projection,
      `${pointer}/projection`,
      findings,
      `${rulePrefix}-projection-invalid`,
    );
  }
  if (path === null || sha256 === null || size === null || (requireProjection && (!mediaType || !projection))) return null;
  return Object.freeze({
    path,
    sha256,
    size,
    ...(requireProjection ? { mediaType, projection } : {}),
  });
}

function normalizeContract(value, pointer, findings) {
  const allowed = new Set([
    'contractIrId',
    'contractIrDigest',
    'receiptRunId',
    'receiptDigest',
    'sourceDigests',
  ]);
  if (!objectShape(value, pointer, allowed, allowed, findings, 'projection-contract')) return null;
  const sourcePointer = `${pointer}/sourceDigests`;
  const sourceAllowed = new Set(['typespec', 'generatedJsonSchema', 'authoredJsonSchema']);
  let sourceDigests = null;
  if (objectShape(value.sourceDigests, sourcePointer, sourceAllowed, sourceAllowed, findings, 'projection-source-digests')) {
    sourceDigests = Object.freeze({
      typespec: normalizeDigest(value.sourceDigests.typespec, `${sourcePointer}/typespec`, findings),
      generatedJsonSchema: normalizeDigest(
        value.sourceDigests.generatedJsonSchema,
        `${sourcePointer}/generatedJsonSchema`,
        findings,
      ),
      authoredJsonSchema: normalizeDigest(
        value.sourceDigests.authoredJsonSchema,
        `${sourcePointer}/authoredJsonSchema`,
        findings,
      ),
    });
  }
  const normalized = {
    contractIrId: normalizeDigest(value.contractIrId, `${pointer}/contractIrId`, findings),
    contractIrDigest: normalizeDigest(value.contractIrDigest, `${pointer}/contractIrDigest`, findings),
    receiptRunId: normalizeDigest(value.receiptRunId, `${pointer}/receiptRunId`, findings),
    receiptDigest: normalizeDigest(value.receiptDigest, `${pointer}/receiptDigest`, findings),
    sourceDigests,
  };
  return Object.values(normalized).some((item) => item === null) ? null : Object.freeze(normalized);
}

function normalizeInputs(value, pointer, findings) {
  const keys = ['operationInventory', 'projectionMetadata', 'emitterConfiguration'];
  const allowed = new Set(keys);
  if (!objectShape(value, pointer, allowed, allowed, findings, 'projection-inputs')) return null;
  const normalized = {};
  for (const key of keys) {
    normalized[key] = normalizeFileDescriptor(
      value[key],
      `${pointer}/${key}`,
      findings,
      `projection-input-${key}`,
    );
  }
  return Object.values(normalized).some((item) => item === null) ? null : Object.freeze(normalized);
}

function normalizeToolchains(value, pointer, findings, limits) {
  if (!Array.isArray(value)) {
    add(findings, 'projection-toolchains-invalid', pointer, 'toolchains must be an array');
    return [];
  }
  if (value.length === 0) add(findings, 'projection-toolchains-empty', pointer, 'at least one toolchain is required');
  if (value.length > limits.maxToolchains) {
    add(findings, 'projection-toolchains-limit', pointer, 'toolchain count exceeds the configured admission limit');
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.length, limits.maxToolchains); index += 1) {
    const itemPointer = `${pointer}/${index}`;
    const item = value[index];
    const allowed = new Set(['id', 'version', 'artifactDigest']);
    if (!objectShape(item, itemPointer, allowed, allowed, findings, 'projection-toolchain')) continue;
    const id = normalizeIdentifier(item.id, `${itemPointer}/id`, findings, 'projection-toolchain-id-invalid');
    const version = normalizeText(item.version, `${itemPointer}/version`, findings, 256, 'projection-toolchain-version-invalid');
    const artifactDigest = normalizeDigest(
      item.artifactDigest,
      `${itemPointer}/artifactDigest`,
      findings,
      'projection-toolchain-digest-invalid',
    );
    if (!id || !version || !artifactDigest) continue;
    if (seen.has(id)) {
      add(findings, 'projection-toolchain-duplicate', `${itemPointer}/id`, 'toolchain id is duplicated');
      continue;
    }
    seen.add(id);
    result.push(Object.freeze({ id, version, artifactDigest }));
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeProjection(value, pointer, findings, limits) {
  const allowed = new Set([
    'id',
    'emitter',
    'declarationIds',
    'outputPaths',
    'representationDeltaIds',
    'runtimeValidatorIds',
  ]);
  if (!objectShape(value, pointer, allowed, allowed, findings, 'projection-target')) return null;
  const id = normalizeIdentifier(value.id, `${pointer}/id`, findings, 'projection-target-id-invalid');
  const emitter = normalizeIdentifier(value.emitter, `${pointer}/emitter`, findings, 'projection-emitter-id-invalid');
  const options = { limit: limits.maxReferencesPerProjection };
  const declarationIds = normalizeStringArray(value.declarationIds, `${pointer}/declarationIds`, findings, {
    ...options,
    normalize: (item, itemPointer, itemFindings) => normalizeText(
      item,
      itemPointer,
      itemFindings,
      512,
      'projection-declaration-id-invalid',
    ),
    duplicateRule: 'projection-declaration-id-duplicate',
    invalidRule: 'projection-declaration-ids-invalid',
  });
  const outputPaths = normalizeStringArray(value.outputPaths, `${pointer}/outputPaths`, findings, {
    ...options,
    normalize: (item, itemPointer, itemFindings) => normalizePath(
      item,
      itemPointer,
      itemFindings,
      'projection-output-path-invalid',
    ),
    duplicateRule: 'projection-output-path-duplicate',
    invalidRule: 'projection-output-paths-invalid',
  });
  const representationDeltaIds = normalizeStringArray(
    value.representationDeltaIds,
    `${pointer}/representationDeltaIds`,
    findings,
    {
      ...options,
      normalize: (item, itemPointer, itemFindings) => normalizeIdentifier(
        item,
        itemPointer,
        itemFindings,
        'projection-delta-reference-invalid',
      ),
      duplicateRule: 'projection-delta-reference-duplicate',
      invalidRule: 'projection-delta-references-invalid',
    },
  );
  const runtimeValidatorIds = normalizeStringArray(
    value.runtimeValidatorIds,
    `${pointer}/runtimeValidatorIds`,
    findings,
    {
      ...options,
      normalize: (item, itemPointer, itemFindings) => normalizeIdentifier(
        item,
        itemPointer,
        itemFindings,
        'projection-runtime-validator-reference-invalid',
      ),
      duplicateRule: 'projection-runtime-validator-reference-duplicate',
      invalidRule: 'projection-runtime-validator-references-invalid',
    },
  );
  if (!id || !emitter) return null;
  return Object.freeze({
    id,
    emitter,
    declarationIds: Object.freeze(declarationIds),
    outputPaths: Object.freeze(outputPaths),
    representationDeltaIds: Object.freeze(representationDeltaIds),
    runtimeValidatorIds: Object.freeze(runtimeValidatorIds),
  });
}

function normalizeProjections(value, pointer, findings, limits) {
  if (!Array.isArray(value)) {
    add(findings, 'projection-targets-invalid', pointer, 'projections must be an array');
    return [];
  }
  if (value.length === 0) add(findings, 'projection-targets-empty', pointer, 'at least one projection is required');
  if (value.length > limits.maxProjections) {
    add(findings, 'projection-targets-limit', pointer, 'projection count exceeds the configured admission limit');
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.length, limits.maxProjections); index += 1) {
    const item = normalizeProjection(value[index], `${pointer}/${index}`, findings, limits);
    if (!item) continue;
    if (seen.has(item.id)) {
      add(findings, 'projection-target-duplicate', `${pointer}/${index}/id`, 'projection id is duplicated');
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeOutputs(value, pointer, findings, limits) {
  if (!Array.isArray(value)) {
    add(findings, 'projection-outputs-invalid', pointer, 'outputs must be an array');
    return [];
  }
  if (value.length === 0) add(findings, 'projection-outputs-empty', pointer, 'at least one output is required');
  if (value.length > limits.maxOutputs) {
    add(findings, 'projection-outputs-limit', pointer, 'output count exceeds the configured admission limit');
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.length, limits.maxOutputs); index += 1) {
    const item = normalizeFileDescriptor(
      value[index],
      `${pointer}/${index}`,
      findings,
      'projection-output',
      { requireProjection: true },
    );
    if (!item) continue;
    if (seen.has(item.path)) {
      add(findings, 'projection-output-duplicate', `${pointer}/${index}/path`, 'output path is duplicated');
      continue;
    }
    seen.add(item.path);
    result.push(item);
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeReview(value, pointer, findings) {
  const allowed = new Set(['reviewer', 'reviewedAt', 'approvalDigest']);
  if (!objectShape(value, pointer, allowed, allowed, findings, 'projection-delta-review')) return null;
  const reviewer = normalizeIdentifier(value.reviewer, `${pointer}/reviewer`, findings, 'projection-reviewer-invalid');
  let reviewedAt = null;
  if (!validIsoInstant(value.reviewedAt)) {
    add(findings, 'projection-reviewed-at-invalid', `${pointer}/reviewedAt`, 'reviewedAt must be a valid UTC instant');
  } else {
    reviewedAt = value.reviewedAt;
  }
  const approvalDigest = normalizeDigest(
    value.approvalDigest,
    `${pointer}/approvalDigest`,
    findings,
    'projection-approval-digest-invalid',
  );
  return reviewer && reviewedAt && approvalDigest
    ? Object.freeze({ reviewer, reviewedAt, approvalDigest })
    : null;
}

function normalizeDelta(value, pointer, findings) {
  const allowed = new Set([
    'id',
    'projection',
    'declaration',
    'sourcePointer',
    'reason',
    'sourceDigest',
    'review',
    'runtimeValidatorRequired',
    'runtimeValidatorId',
    'negativeFixtureDigest',
  ]);
  if (!objectShape(value, pointer, allowed, allowed, findings, 'projection-delta')) return null;
  const id = normalizeIdentifier(value.id, `${pointer}/id`, findings, 'projection-delta-id-invalid');
  const projection = normalizeIdentifier(
    value.projection,
    `${pointer}/projection`,
    findings,
    'projection-delta-projection-invalid',
  );
  const declaration = normalizeText(
    value.declaration,
    `${pointer}/declaration`,
    findings,
    512,
    'projection-delta-declaration-invalid',
  );
  let sourcePointer = null;
  if (!boundedText(value.sourcePointer, 1024) || !JSON_POINTER_PATTERN.test(value.sourcePointer)) {
    add(findings, 'projection-delta-source-pointer-invalid', `${pointer}/sourcePointer`, 'sourcePointer must be a bounded JSON Pointer');
  } else {
    sourcePointer = value.sourcePointer;
  }
  const reason = normalizeText(value.reason, `${pointer}/reason`, findings, 2048, 'projection-delta-reason-invalid');
  const sourceDigest = normalizeDigest(
    value.sourceDigest,
    `${pointer}/sourceDigest`,
    findings,
    'projection-delta-source-digest-invalid',
  );
  const review = normalizeReview(value.review, `${pointer}/review`, findings);
  let runtimeValidatorRequired = null;
  if (typeof value.runtimeValidatorRequired !== 'boolean') {
    add(findings, 'projection-delta-runtime-required-invalid', `${pointer}/runtimeValidatorRequired`, 'runtimeValidatorRequired must be boolean');
  } else {
    runtimeValidatorRequired = value.runtimeValidatorRequired;
  }
  let runtimeValidatorId = null;
  let negativeFixtureDigest = null;
  if (value.runtimeValidatorId !== null) {
    runtimeValidatorId = normalizeIdentifier(
      value.runtimeValidatorId,
      `${pointer}/runtimeValidatorId`,
      findings,
      'projection-delta-runtime-validator-invalid',
    );
  }
  if (value.negativeFixtureDigest !== null) {
    negativeFixtureDigest = normalizeDigest(
      value.negativeFixtureDigest,
      `${pointer}/negativeFixtureDigest`,
      findings,
      'projection-delta-negative-fixture-invalid',
    );
  }
  if (runtimeValidatorRequired === true && (!runtimeValidatorId || !negativeFixtureDigest)) {
    add(findings, 'projection-delta-runtime-evidence-missing', pointer, 'runtime-required delta must bind a validator and negative fixture');
  }
  if (runtimeValidatorRequired === false && (runtimeValidatorId !== null || negativeFixtureDigest !== null)) {
    add(findings, 'projection-delta-runtime-evidence-unexpected', pointer, 'non-runtime delta must not bind runtime-validator evidence');
  }
  if (!id || !projection || !declaration || !sourcePointer || !reason || !sourceDigest || !review || runtimeValidatorRequired === null) return null;
  return Object.freeze({
    id,
    projection,
    declaration,
    sourcePointer,
    reason,
    sourceDigest,
    review,
    runtimeValidatorRequired,
    runtimeValidatorId,
    negativeFixtureDigest,
  });
}

function normalizeDeltas(value, pointer, findings, limits) {
  if (!Array.isArray(value)) {
    add(findings, 'projection-deltas-invalid', pointer, 'representationDeltas must be an array');
    return [];
  }
  if (value.length > limits.maxRepresentationDeltas) {
    add(findings, 'projection-deltas-limit', pointer, 'representation delta count exceeds the configured admission limit');
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.length, limits.maxRepresentationDeltas); index += 1) {
    const item = normalizeDelta(value[index], `${pointer}/${index}`, findings);
    if (!item) continue;
    if (seen.has(item.id)) {
      add(findings, 'projection-delta-duplicate', `${pointer}/${index}/id`, 'representation delta id is duplicated');
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeRuntimeValidator(value, pointer, findings) {
  const allowed = new Set([
    'id',
    'projection',
    'artifactPath',
    'artifactDigest',
    'fixtureDigest',
    'ingressEgressCoverageDigest',
  ]);
  if (!objectShape(value, pointer, allowed, allowed, findings, 'projection-runtime-validator')) return null;
  const id = normalizeIdentifier(value.id, `${pointer}/id`, findings, 'projection-runtime-validator-id-invalid');
  const projection = normalizeIdentifier(
    value.projection,
    `${pointer}/projection`,
    findings,
    'projection-runtime-validator-projection-invalid',
  );
  const artifactPath = normalizePath(
    value.artifactPath,
    `${pointer}/artifactPath`,
    findings,
    'projection-runtime-validator-path-invalid',
  );
  const artifactDigest = normalizeDigest(
    value.artifactDigest,
    `${pointer}/artifactDigest`,
    findings,
    'projection-runtime-validator-artifact-digest-invalid',
  );
  const fixtureDigest = normalizeDigest(
    value.fixtureDigest,
    `${pointer}/fixtureDigest`,
    findings,
    'projection-runtime-validator-fixture-digest-invalid',
  );
  const ingressEgressCoverageDigest = normalizeDigest(
    value.ingressEgressCoverageDigest,
    `${pointer}/ingressEgressCoverageDigest`,
    findings,
    'projection-runtime-validator-coverage-digest-invalid',
  );
  return id && projection && artifactPath && artifactDigest && fixtureDigest && ingressEgressCoverageDigest
    ? Object.freeze({ id, projection, artifactPath, artifactDigest, fixtureDigest, ingressEgressCoverageDigest })
    : null;
}

function normalizeRuntimeValidators(value, pointer, findings, limits) {
  if (!Array.isArray(value)) {
    add(findings, 'projection-runtime-validators-invalid', pointer, 'runtimeValidators must be an array');
    return [];
  }
  if (value.length > limits.maxRuntimeValidators) {
    add(findings, 'projection-runtime-validators-limit', pointer, 'runtime validator count exceeds the configured admission limit');
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.length, limits.maxRuntimeValidators); index += 1) {
    const item = normalizeRuntimeValidator(value[index], `${pointer}/${index}`, findings);
    if (!item) continue;
    if (seen.has(item.id)) {
      add(findings, 'projection-runtime-validator-duplicate', `${pointer}/${index}/id`, 'runtime validator id is duplicated');
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeProjectionManifest(value, options = {}) {
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...(options.limits ?? {}) });
  const findings = [];
  const allowed = new Set([
    'schema',
    'manifestId',
    'status',
    'contract',
    'inputs',
    'toolchains',
    'declarations',
    'projections',
    'outputs',
    'representationDeltas',
    'runtimeValidators',
  ]);
  if (!objectShape(value, '#', allowed, allowed, findings, 'projection-manifest')) {
    return Object.freeze({ manifest: null, findings: Object.freeze(findings), limits });
  }
  if (value.schema !== PROJECTION_MANIFEST_SCHEMA) {
    add(findings, 'projection-manifest-schema-invalid', '#/schema', 'manifest schema identifier is unsupported');
  }
  if (value.status !== 'passed') {
    add(findings, 'projection-manifest-status-invalid', '#/status', 'manifest status must be passed');
  }
  const manifestId = normalizeDigest(value.manifestId, '#/manifestId', findings, 'projection-manifest-id-invalid');
  const contract = normalizeContract(value.contract, '#/contract', findings);
  const inputs = normalizeInputs(value.inputs, '#/inputs', findings);
  const toolchains = normalizeToolchains(value.toolchains, '#/toolchains', findings, limits);
  const declarations = normalizeStringArray(value.declarations, '#/declarations', findings, {
    limit: limits.maxDeclarations,
    normalize: (item, pointer, itemFindings) => normalizeText(
      item,
      pointer,
      itemFindings,
      512,
      'projection-declaration-invalid',
    ),
    duplicateRule: 'projection-declaration-duplicate',
    invalidRule: 'projection-declarations-invalid',
  });
  const projections = normalizeProjections(value.projections, '#/projections', findings, limits);
  const outputs = normalizeOutputs(value.outputs, '#/outputs', findings, limits);
  const representationDeltas = normalizeDeltas(value.representationDeltas, '#/representationDeltas', findings, limits);
  const runtimeValidators = normalizeRuntimeValidators(value.runtimeValidators, '#/runtimeValidators', findings, limits);
  const manifest = manifestId && contract && inputs
    ? Object.freeze({
        schema: PROJECTION_MANIFEST_SCHEMA,
        manifestId,
        status: 'passed',
        contract,
        inputs,
        toolchains: Object.freeze(toolchains),
        declarations: Object.freeze(declarations),
        projections: Object.freeze(projections),
        outputs: Object.freeze(outputs),
        representationDeltas: Object.freeze(representationDeltas),
        runtimeValidators: Object.freeze(runtimeValidators),
      })
    : null;
  return Object.freeze({ manifest, findings: Object.freeze(findings), limits });
}

export { normalizeFileDescriptor };
