import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalStringify } from '../canonical.mjs';
import {
  MAX_DELTAS,
  MAX_OUTPUTS,
  MAX_POLICY_BYTES,
  MAX_RUNTIME_VALIDATORS,
  MAX_TOOLCHAINS,
  MEDIA_TYPE_PATTERN,
  PROJECTION_VERIFICATION_POLICY_SCHEMA,
  ProjectionVerificationPolicyError,
  assertCondition,
  assertExactObject,
  isObject,
  validDigest,
  validIdentifier,
  validRelativePath,
} from './constants.mjs';

function normalizePathDescriptor(value, label) {
  assertExactObject(value, label, ['path']);
  assertCondition(validRelativePath(value.path), `${label}.path must be a normalized relative POSIX path`);
  return Object.freeze({ path: value.path });
}

function normalizeOutputDescriptor(value, label) {
  assertExactObject(value, label, ['path', 'mediaType', 'projection']);
  assertCondition(validRelativePath(value.path), `${label}.path must be a normalized relative POSIX path`);
  assertCondition(
    typeof value.mediaType === 'string'
      && value.mediaType.length <= 255
      && MEDIA_TYPE_PATTERN.test(value.mediaType),
    `${label}.mediaType must be a bounded lowercase media type`,
  );
  assertCondition(validIdentifier(value.projection), `${label}.projection must be a bounded lowercase identifier`);
  return Object.freeze({
    path: value.path,
    mediaType: value.mediaType,
    projection: value.projection,
  });
}

function normalizeToolchain(value, label) {
  assertExactObject(value, label, ['id', 'version', 'artifactDigest']);
  assertCondition(validIdentifier(value.id), `${label}.id must be a bounded lowercase identifier`);
  assertCondition(
    typeof value.version === 'string'
      && value.version.length > 0
      && value.version.length <= 256
      && !/[\u0000-\u001f\u007f]/u.test(value.version),
    `${label}.version must be bounded text without control characters`,
  );
  assertCondition(validDigest(value.artifactDigest), `${label}.artifactDigest must be a lowercase SHA-256 digest`);
  return Object.freeze({
    id: value.id,
    version: value.version,
    artifactDigest: value.artifactDigest,
  });
}

function normalizeArray(value, label, limit) {
  assertCondition(Array.isArray(value), `${label} must be an array`);
  assertCondition(value.length <= limit, `${label} exceeds its admission limit`);
  return value;
}

function normalizeIdentifierArray(value, label, { requireNonEmpty = false } = {}) {
  normalizeArray(value, label, 256);
  if (requireNonEmpty) assertCondition(value.length > 0, `${label} must not be empty`);
  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    assertCondition(validIdentifier(item), `${label}[${index}] must be a bounded lowercase identifier`);
    assertCondition(!seen.has(item), `${label} must not contain duplicate identifiers`);
    seen.add(item);
    normalized.push(item);
  }
  return Object.freeze(normalized.sort((left, right) => left.localeCompare(right)));
}

function canonicalClone(value, label) {
  try {
    return JSON.parse(canonicalStringify(value));
  } catch {
    throw new ProjectionVerificationPolicyError(`${label} must be JSON-compatible data`);
  }
}

export function normalizeProjectionVerificationPolicy(value) {
  const keys = [
    'schema',
    'inputs',
    'toolchains',
    'requiredProjections',
    'outputs',
    'approvedDeltas',
    'runtimeValidators',
  ];
  assertExactObject(value, 'projection verification policy', keys);
  assertCondition(
    value.schema === PROJECTION_VERIFICATION_POLICY_SCHEMA,
    `projection verification policy schema must be ${PROJECTION_VERIFICATION_POLICY_SCHEMA}`,
  );

  const inputKeys = ['operationInventory', 'projectionMetadata', 'emitterConfiguration'];
  assertExactObject(value.inputs, 'projection verification policy inputs', inputKeys);
  const inputs = Object.freeze(Object.fromEntries(inputKeys.map((key) => [
    key,
    normalizePathDescriptor(value.inputs[key], `projection verification policy inputs.${key}`),
  ])));
  const inputPaths = Object.values(inputs).map((item) => item.path);
  assertCondition(new Set(inputPaths).size === inputPaths.length, 'projection verification input paths must be unique');

  const toolchains = normalizeArray(value.toolchains, 'projection verification policy toolchains', MAX_TOOLCHAINS)
    .map((item, index) => normalizeToolchain(item, `projection verification policy toolchains[${index}]`))
    .sort((left, right) => left.id.localeCompare(right.id));
  assertCondition(toolchains.length > 0, 'projection verification policy toolchains must not be empty');
  assertCondition(
    new Set(toolchains.map((item) => item.id)).size === toolchains.length,
    'projection verification toolchain ids must be unique',
  );

  const outputs = normalizeArray(value.outputs, 'projection verification policy outputs', MAX_OUTPUTS)
    .map((item, index) => normalizeOutputDescriptor(item, `projection verification policy outputs[${index}]`))
    .sort((left, right) => left.path.localeCompare(right.path));
  assertCondition(outputs.length > 0, 'projection verification policy outputs must not be empty');
  assertCondition(
    new Set(outputs.map((item) => item.path)).size === outputs.length,
    'projection verification output paths must be unique',
  );

  const approvedDeltas = normalizeArray(
    value.approvedDeltas,
    'projection verification policy approvedDeltas',
    MAX_DELTAS,
  ).map((item) => canonicalClone(item, 'projection verification policy approvedDeltas'))
    .sort((left, right) => canonicalStringify(left).localeCompare(canonicalStringify(right)));
  const runtimeValidators = normalizeArray(
    value.runtimeValidators,
    'projection verification policy runtimeValidators',
    MAX_RUNTIME_VALIDATORS,
  ).map((item) => canonicalClone(item, 'projection verification policy runtimeValidators'))
    .sort((left, right) => canonicalStringify(left).localeCompare(canonicalStringify(right)));

  return Object.freeze({
    schema: PROJECTION_VERIFICATION_POLICY_SCHEMA,
    inputs,
    toolchains: Object.freeze(toolchains),
    requiredProjections: normalizeIdentifierArray(
      value.requiredProjections,
      'projection verification policy requiredProjections',
      { requireNonEmpty: true },
    ),
    outputs: Object.freeze(outputs),
    approvedDeltas: Object.freeze(approvedDeltas),
    runtimeValidators: Object.freeze(runtimeValidators),
  });
}

async function loadRegularJson(path, { maxBytes, label }) {
  const lexical = resolve(path);
  const lexicalInfo = await lstat(lexical);
  if (lexicalInfo.isSymbolicLink()) {
    throw new ProjectionVerificationPolicyError(`${label} must not be a symbolic link`);
  }
  if (!lexicalInfo.isFile() || lexicalInfo.nlink !== 1) {
    throw new ProjectionVerificationPolicyError(`${label} must be a singly linked regular file`);
  }
  if (lexicalInfo.size > maxBytes) {
    throw new ProjectionVerificationPolicyError(`${label} exceeds ${maxBytes} bytes`);
  }
  const canonical = await realpath(lexical);
  const canonicalInfo = await stat(canonical);
  if (!canonicalInfo.isFile() || canonicalInfo.nlink !== 1) {
    throw new ProjectionVerificationPolicyError(`${label} resolved target must be a singly linked regular file`);
  }
  const parsed = JSON.parse(await readFile(canonical, 'utf8'));
  if (!isObject(parsed)) throw new ProjectionVerificationPolicyError(`${label} must contain a JSON object`);
  return parsed;
}

export async function loadProjectionVerificationPolicy(path, options = {}) {
  const parsed = await loadRegularJson(path, {
    maxBytes: options.maxBytes ?? MAX_POLICY_BYTES,
    label: 'projection verification policy',
  });
  return normalizeProjectionVerificationPolicy(parsed);
}
