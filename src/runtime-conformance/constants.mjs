export const RUNTIME_EVIDENCE_SCHEMA = 'ores.typespec-json-schema-validator.runtime-evidence/v1';
export const RUNTIME_CONFORMANCE_REPORT_SCHEMA =
  'ores.typespec-json-schema-validator.runtime-conformance-report/v1';
export const CONTRACT_IR_SCHEMA = 'ores.typespec-json-schema-validator.contract-ir/v1';
export const CONTRACT_IR_VERIFICATION_SCHEMA =
  'ores.typespec-json-schema-validator.contract-ir-verification/v1';
export const PARITY_REPORT_SCHEMA = 'ores.typespec-json-schema-validator.report/v1';

export const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
export const ADAPTER_STATUSES = new Set(['passed', 'failed', 'skipped', 'unsupported']);
export const CASE_VERDICTS = new Set(['accepted', 'rejected', 'error', 'skipped', 'unsupported']);
export const EXPECTATIONS = new Set(['accepted', 'rejected']);

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validBoundedText(value, maxLength = 256) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/u.test(value);
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
