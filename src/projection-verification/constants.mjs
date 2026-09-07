import {
  DEFAULT_LIMITS,
  IDENTIFIER_PATTERN,
  MEDIA_TYPE_PATTERN,
  boundedText,
  isPlainObject,
  validDigest,
  validIdentifier,
  validRelativePath,
} from '../projection-admission/constants.mjs';

export const PROJECTION_VERIFICATION_POLICY_SCHEMA =
  'ores.typespec-json-schema-validator.projection-verification-policy/v1';
export const PROJECTION_VERIFICATION_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.projection-verification-receipt/v1';

export { IDENTIFIER_PATTERN, MEDIA_TYPE_PATTERN, validDigest, validIdentifier, validRelativePath };
export const MAX_POLICY_BYTES = 4 * 1024 * 1024;
export const MAX_RECEIPT_RULES = 250;
export const MAX_DECLARATIONS = DEFAULT_LIMITS.maxDeclarations;
export const MAX_TOOLCHAINS = DEFAULT_LIMITS.maxToolchains;
export const MAX_PROJECTIONS = DEFAULT_LIMITS.maxProjections;
export const MAX_OUTPUTS = DEFAULT_LIMITS.maxOutputs;
export const MAX_DELTAS = DEFAULT_LIMITS.maxRepresentationDeltas;
export const MAX_RUNTIME_VALIDATORS = DEFAULT_LIMITS.maxRuntimeValidators;

export class ProjectionVerificationPolicyError extends Error {}
export class UnsafeProjectionVerificationReceiptDestinationError extends Error {}

export function isObject(value) {
  return isPlainObject(value);
}

export function validDeclarationId(value) {
  return boundedText(value, 512) && value.trim() === value;
}

export function assertCondition(condition, message) {
  if (!condition) throw new ProjectionVerificationPolicyError(message);
}

export function assertExactObject(value, label, keys) {
  assertCondition(isObject(value), `${label} must be an object`);
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !allowed.has(key));
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  assertCondition(unknown.length === 0, `${label} contains unsupported properties`);
  assertCondition(missing.length === 0, `${label} is missing required properties`);
}
