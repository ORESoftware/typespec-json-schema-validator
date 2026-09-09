import { canonicalStringify } from '../canonical.mjs';
import {
  CASE_VERDICTS,
  DIGEST_PATTERN,
  IDENTIFIER_PATTERN,
  MAX_RUNTIME_ERRORS_PER_RESULT,
  RUNTIME_EVIDENCE_SCHEMA_V2,
  isPlainObject,
  normalizedText,
  runtimeValueShape,
  validBoundedText,
} from './constants.mjs';
import { makeRuntimeFinding } from './findings.mjs';
import { readRuntimeEnvelope } from './envelope.mjs';

const JSON_POINTER_PATTERN = /^(?:\/(?:[^~\/\u0000-\u001f\u007f]|~0|~1)*)*$/u;

function normalizeErrorParam(value, pointer, findings) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string'
    && value.length <= 128
    && IDENTIFIER_PATTERN.test(value)) return value;
  findings.push(makeRuntimeFinding({
    ruleId: 'runtime-error-param-invalid',
    pointer,
    message: 'validation error params may contain only bounded rule metadata, never raw rejected values',
    left: runtimeValueShape(value),
    right: 'null, boolean, finite number, or bounded identifier string',
  }));
  return null;
}

function normalizeErrorParams(value, pointer, findings) {
  if (!isPlainObject(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-error-params-invalid',
      pointer,
      message: 'validation error params must be a plain data object',
      left: runtimeValueShape(value),
      right: 'plain object',
    }));
    return Object.freeze({});
  }
  const keys = Object.keys(value).sort();
  if (keys.length > 16) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-error-param-limit-exceeded',
      pointer,
      message: 'validation error params exceed the 16-field bound',
      left: keys.length,
      right: 16,
    }));
  }
  const entries = [];
  for (const key of keys.slice(0, 16)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-error-param-invalid',
        pointer: `${pointer}/${key}`,
        message: 'validation error params must be own enumerable data values',
        left: 'non-data property',
        right: 'data property',
      }));
      continue;
    }
    if (!IDENTIFIER_PATTERN.test(key)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-error-param-key-invalid',
        pointer: `${pointer}/${key}`,
        message: 'validation error param names must be bounded lowercase identifiers',
        left: runtimeValueShape(key),
        right: 'bounded lowercase identifier',
      }));
      continue;
    }
    entries.push([key, normalizeErrorParam(descriptor.value, `${pointer}/${key}`, findings)]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeError(value, adapterId, caseId, index, pointer, findings) {
  const errorPointer = `${pointer}/errors/${index}`;
  if (!isPlainObject(value)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-error-invalid',
      pointer: errorPointer,
      message: `adapter ${adapterId} case ${caseId} validation error must be an object`,
      left: runtimeValueShape(value),
      right: 'object',
    }));
    return null;
  }
  value = readRuntimeEnvelope(value, ['path', 'code', 'params'], errorPointer, 'error', findings);
  const path = value.path;
  const code = normalizedText(value.code);
  if (typeof path !== 'string'
    || path.length > 512
    || !JSON_POINTER_PATTERN.test(path)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-error-path-invalid',
      pointer: `${errorPointer}/path`,
      message: 'validation error path must be a bounded RFC 6901 JSON Pointer',
      left: runtimeValueShape(path),
      right: 'RFC 6901 JSON Pointer up to 512 characters',
    }));
    return null;
  }
  if (!validBoundedText(code, 128) || !IDENTIFIER_PATTERN.test(code)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-error-code-invalid',
      pointer: `${errorPointer}/code`,
      message: 'validation error code must be a bounded lowercase identifier',
      left: runtimeValueShape(value.code),
      right: 'bounded lowercase identifier',
    }));
    return null;
  }
  return Object.freeze({
    path,
    code,
    params: normalizeErrorParams(value.params, `${errorPointer}/params`, findings),
  });
}

function normalizeErrors(value, adapterId, caseId, pointer, findings) {
  if (!Array.isArray(value)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-errors-invalid',
      pointer: `${pointer}/errors`,
      message: `adapter ${adapterId} case ${caseId} errors must be an array`,
      left: runtimeValueShape(value),
      right: 'array',
    }));
    return Object.freeze([]);
  }
  if (value.length > MAX_RUNTIME_ERRORS_PER_RESULT) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-error-limit-exceeded',
      pointer: `${pointer}/errors`,
      message: `adapter ${adapterId} case ${caseId} emitted too many validation errors`,
      left: value.length,
      right: MAX_RUNTIME_ERRORS_PER_RESULT,
    }));
  }
  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.length, MAX_RUNTIME_ERRORS_PER_RESULT); index += 1) {
    const error = normalizeError(value[index], adapterId, caseId, index, pointer, findings);
    if (!error) continue;
    const key = canonicalStringify(error);
    if (seen.has(key)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-result-error-duplicate',
        pointer: `${pointer}/errors/${index}`,
        message: `adapter ${adapterId} case ${caseId} emitted a duplicate stable validation error`,
        left: { path: error.path, code: error.code },
        right: 'unique stable validation errors',
      }));
      continue;
    }
    seen.add(key);
    normalized.push(error);
  }
  normalized.sort((left, right) => canonicalStringify(left).localeCompare(canonicalStringify(right)));
  return Object.freeze(normalized);
}

function validateDigest(value, pointer, label, findings) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-digest-invalid',
      pointer,
      message: `${label} must be a lowercase SHA-256 digest`,
      left: runtimeValueShape(value),
      right: '64 lowercase hexadecimal characters',
    }));
    return null;
  }
  return value;
}

export function normalizeResult(value, adapterId, index, findings, evidenceSchema) {
  const pointer = `#/adapters/${adapterId}/results/${index}`;
  if (!isPlainObject(value)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-invalid',
      pointer,
      message: `adapter ${adapterId} result must be an object`,
      left: runtimeValueShape(value),
      right: 'object',
    }));
    return null;
  }
  const semantic = evidenceSchema === RUNTIME_EVIDENCE_SCHEMA_V2;
  value = readRuntimeEnvelope(
    value,
    semantic
      ? ['caseId', 'declaration', 'verdict', 'inputDigest', 'outputDigest', 'errors']
      : ['caseId', 'declaration', 'verdict'],
    pointer,
    'result',
    findings,
  );

  const caseId = normalizedText(value.caseId);
  const declaration = normalizedText(value.declaration);
  const verdict = value.verdict;
  if (!validBoundedText(caseId) || !IDENTIFIER_PATTERN.test(caseId)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-case-id-invalid',
      pointer: `${pointer}/caseId`,
      message: `adapter ${adapterId} emitted an invalid case id`,
      left: runtimeValueShape(value.caseId),
      right: 'bounded lowercase identifier',
    }));
    return null;
  }
  if (!validBoundedText(declaration, 512)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-declaration-invalid',
      pointer: `${pointer}/declaration`,
      message: `adapter ${adapterId} case ${caseId} has an invalid declaration identity`,
      left: runtimeValueShape(value.declaration),
      right: 'non-empty bounded text without control characters',
    }));
    return null;
  }
  if (!CASE_VERDICTS.has(verdict)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-verdict-invalid',
      declaration,
      pointer: `${pointer}/verdict`,
      message: `adapter ${adapterId} case ${caseId} has an invalid verdict`,
      left: runtimeValueShape(verdict),
      right: [...CASE_VERDICTS].sort(),
    }));
    return null;
  }
  if (!semantic) return Object.freeze({ caseId, declaration, verdict });

  const inputDigest = validateDigest(value.inputDigest, `${pointer}/inputDigest`, 'inputDigest', findings);
  const errors = normalizeErrors(value.errors, adapterId, caseId, pointer, findings);
  let outputDigest = null;
  if (verdict === 'accepted') {
    outputDigest = validateDigest(value.outputDigest, `${pointer}/outputDigest`, 'outputDigest', findings);
    if (errors.length !== 0) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-result-accepted-errors-not-empty',
        declaration,
        pointer: `${pointer}/errors`,
        message: `adapter ${adapterId} accepted case ${caseId} but also reported validation errors`,
        left: errors.length,
        right: 0,
      }));
    }
  } else {
    if (value.outputDigest !== null) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-result-nonaccepted-output-digest-not-null',
        declaration,
        pointer: `${pointer}/outputDigest`,
        message: `adapter ${adapterId} case ${caseId} must not claim admitted output when it was not accepted`,
        left: runtimeValueShape(value.outputDigest),
        right: null,
      }));
    }
    if (verdict === 'rejected' && errors.length === 0) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-result-rejected-errors-empty',
        declaration,
        pointer: `${pointer}/errors`,
        message: `adapter ${adapterId} rejected case ${caseId} without stable validation error evidence`,
        left: 0,
        right: 'one or more stable validation errors',
      }));
    }
    if (verdict !== 'rejected' && errors.length !== 0) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-result-nonvalidation-errors-not-empty',
        declaration,
        pointer: `${pointer}/errors`,
        message: `adapter ${adapterId} case ${caseId} must not encode runtime/skipped/unsupported failures as validation errors`,
        left: errors.length,
        right: 0,
      }));
    }
  }
  return Object.freeze({ caseId, declaration, verdict, inputDigest, outputDigest, errors });
}
