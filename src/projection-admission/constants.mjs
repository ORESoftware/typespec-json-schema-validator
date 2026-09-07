import { posix } from 'node:path';

export const PROJECTION_MANIFEST_SCHEMA =
  'ores.typespec-json-schema-validator.projection-manifest/v1';
export const PROJECTION_ADMISSION_REPORT_SCHEMA =
  'ores.typespec-json-schema-validator.projection-admission-report/v1';
export const CONTRACT_IR_SCHEMA = 'ores.typespec-json-schema-validator.contract-ir/v1';
export const PARITY_REPORT_SCHEMA = 'ores.typespec-json-schema-validator.report/v1';
export const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
export const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
export const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
export const JSON_POINTER_PATTERN = /^#(?:\/(?:[^~/]|~[01])*)*$/u;
export const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

export const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxTotalFileBytes: 256 * 1024 * 1024,
  maxToolchains: 64,
  maxDeclarations: 100_000,
  maxProjections: 128,
  maxOutputs: 10_000,
  maxRepresentationDeltas: 10_000,
  maxRuntimeValidators: 10_000,
  maxReferencesPerProjection: 100_000,
});

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function boundedText(value, maxLength = 512) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function validIdentifier(value) {
  return boundedText(value, 128) && IDENTIFIER_PATTERN.test(value);
}

export function validDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function validRelativePath(value) {
  if (!boundedText(value, 512) || value.includes('\\') || value.startsWith('/')) return false;
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  return posix.normalize(value) === value;
}

export function validIsoInstant(value) {
  return typeof value === 'string'
    && ISO_INSTANT_PATTERN.test(value)
    && Number.isFinite(Date.parse(value));
}
