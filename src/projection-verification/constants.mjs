export const PROJECTION_VERIFICATION_POLICY_SCHEMA =
  'ores.typespec-json-schema-validator.projection-verification-policy/v1';
export const PROJECTION_VERIFICATION_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.projection-verification-receipt/v1';

export const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
export const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
export const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
export const MAX_POLICY_BYTES = 4 * 1024 * 1024;
export const MAX_RECEIPT_RULES = 250;
export const MAX_TOOLCHAINS = 128;
export const MAX_OUTPUTS = 100_000;
export const MAX_DELTAS = 10_000;
export const MAX_RUNTIME_VALIDATORS = 10_000;

export class ProjectionVerificationPolicyError extends Error {}
export class UnsafeProjectionVerificationReceiptDestinationError extends Error {}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function validIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

export function validRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1024
    && !value.includes('\\')
    && !value.startsWith('/')
    && !value.startsWith('./')
    && !value.endsWith('/')
    && !value.includes('//')
    && !value.split('/').some((part) => part === '' || part === '.' || part === '..');
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
