export const RUNTIME_EVIDENCE_SCHEMA_V1 = 'ores.typespec-json-schema-validator.runtime-evidence/v1';
export const RUNTIME_EVIDENCE_SCHEMA_V2 = 'ores.typespec-json-schema-validator.runtime-evidence/v2';
// Compatibility alias: existing callers continue to emit v1 until they opt in to
// the stronger semantic evidence contract explicitly.
export const RUNTIME_EVIDENCE_SCHEMA = RUNTIME_EVIDENCE_SCHEMA_V1;
export const RUNTIME_EVIDENCE_SCHEMAS = new Set([
  RUNTIME_EVIDENCE_SCHEMA_V1,
  RUNTIME_EVIDENCE_SCHEMA_V2,
]);
export const RUNTIME_CONFORMANCE_REPORT_SCHEMA =
  'ores.typespec-json-schema-validator.runtime-conformance-report/v1';

export const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
export const ADAPTER_STATUSES = new Set(['passed', 'failed', 'skipped', 'unsupported']);
export const CASE_VERDICTS = new Set(['accepted', 'rejected', 'error', 'skipped', 'unsupported']);
export const EXPECTATIONS = new Set(['accepted', 'rejected']);
export const MAX_RUNTIME_ERRORS_PER_RESULT = 32;

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validBoundedText(value, maxLength = 256) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  let length = 0;
  for (const _character of value) {
    length += 1;
    if (length > maxLength) return false;
  }
  return length > 0;
}

export function runtimeValueShape(value) {
  if (value === null) return Object.freeze({ type: 'null' });
  if (Array.isArray(value)) return Object.freeze({ type: 'array', length: value.length });
  if (typeof value === 'string') return Object.freeze({ type: 'string', length: value.length });
  return Object.freeze({ type: typeof value });
}

export function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : value;
}

export function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}
