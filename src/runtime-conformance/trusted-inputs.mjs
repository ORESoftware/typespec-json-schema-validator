import {
  DIGEST_PATTERN,
  EXPECTATIONS,
  IDENTIFIER_PATTERN,
  isPlainObject,
  normalizedText,
  runtimeValueShape,
  validBoundedText,
} from './constants.mjs';
import { makeRuntimeFinding } from './findings.mjs';

export function normalizeExpectedCases(expectedCases, findings, options = {}) {
  const requireInputDigest = options.requireInputDigest === true;
  if (!Array.isArray(expectedCases)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-corpus-invalid',
      pointer: '#/expectedCases',
      message: 'expectedCases must be an array supplied by the trusted corpus loader',
      left: expectedCases,
      right: 'array',
    }));
    return [];
  }

  const normalized = [];
  const seen = new Set();
  if (expectedCases.length === 0) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-corpus-empty',
      pointer: '#/expectedCases',
      message: 'trusted runtime corpus must contain at least one asserted case',
      left: 0,
      right: 'one or more accepted/rejected cases',
    }));
  }
  for (let index = 0; index < expectedCases.length; index += 1) {
    const value = expectedCases[index];
    const pointer = `#/expectedCases/${index}`;
    if (!isPlainObject(value)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-corpus-case-invalid',
        pointer,
        message: 'corpus case must be an object',
        left: value,
        right: 'object',
      }));
      continue;
    }
    const id = normalizedText(value.id);
    const declaration = normalizedText(value.declaration);
    const expectation = value.expectation;
    if (!validBoundedText(id) || !IDENTIFIER_PATTERN.test(id)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-corpus-case-id-invalid',
        pointer: `${pointer}/id`,
        message: 'corpus case id must be a bounded lowercase identifier',
        left: value.id,
        right: 'lowercase letters, digits, dot, underscore, or hyphen',
      }));
      continue;
    }
    if (seen.has(id)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-corpus-case-duplicate',
        declaration,
        pointer: `${pointer}/id`,
        message: `trusted corpus contains duplicate case id ${id}`,
        left: id,
        right: 'unique case id',
      }));
      continue;
    }
    seen.add(id);
    if (!validBoundedText(declaration, 512)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-corpus-declaration-invalid',
        pointer: `${pointer}/declaration`,
        message: `corpus case ${id} has an invalid declaration identity`,
        left: value.declaration,
        right: 'non-empty bounded text without control characters',
      }));
      continue;
    }
    if (!EXPECTATIONS.has(expectation)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-corpus-expectation-invalid',
        declaration,
        pointer: `${pointer}/expectation`,
        message: `corpus case ${id} must have an accepted or rejected expectation`,
        left: expectation,
        right: [...EXPECTATIONS].sort(),
      }));
      continue;
    }

    let inputDigest;
    if (requireInputDigest) {
      inputDigest = value.inputDigest;
      if (typeof inputDigest !== 'string' || !DIGEST_PATTERN.test(inputDigest)) {
        findings.push(makeRuntimeFinding({
          ruleId: 'runtime-corpus-case-input-digest-invalid',
          declaration,
          pointer: `${pointer}/inputDigest`,
          message: `trusted corpus case ${id} must bind the canonical input used by runtime-evidence/v2`,
          left: runtimeValueShape(inputDigest),
          right: '64 lowercase hexadecimal characters',
        }));
        continue;
      }
    }

    normalized.push(Object.freeze(requireInputDigest
      ? { id, declaration, expectation, inputDigest }
      : { id, declaration, expectation }));
  }
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeRequiredAdapters(requiredAdapters, findings) {
  if (!Array.isArray(requiredAdapters)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-required-adapters-invalid',
      pointer: '#/requiredAdapters',
      message: 'requiredAdapters must be an array',
      left: requiredAdapters,
      right: 'array',
    }));
    return [];
  }

  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < requiredAdapters.length; index += 1) {
    const value = requiredAdapters[index];
    const descriptor = typeof value === 'string' ? { id: value } : value;
    const pointer = `#/requiredAdapters/${index}`;
    if (!isPlainObject(descriptor)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-required-adapter-invalid',
        pointer,
        message: 'required adapter must be an id string or descriptor object',
        left: value,
        right: 'string or object',
      }));
      continue;
    }
    const id = normalizedText(descriptor.id);
    if (!validBoundedText(id) || !IDENTIFIER_PATTERN.test(id)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-required-adapter-id-invalid',
        pointer: `${pointer}/id`,
        message: 'required adapter id must be a bounded lowercase identifier',
        left: descriptor.id,
        right: 'lowercase letters, digits, dot, underscore, or hyphen',
      }));
      continue;
    }
    if (seen.has(id)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-required-adapter-duplicate',
        pointer: `${pointer}/id`,
        message: `required adapter ${id} is listed more than once`,
        left: id,
        right: 'unique adapter id',
      }));
      continue;
    }
    seen.add(id);
    const language = descriptor.language === undefined ? undefined : normalizedText(descriptor.language);
    const validator = descriptor.validator === undefined ? undefined : normalizedText(descriptor.validator);
    for (const [field, text] of [['language', language], ['validator', validator]]) {
      if (text !== undefined && !validBoundedText(text, 128)) {
        findings.push(makeRuntimeFinding({
          ruleId: 'runtime-required-adapter-descriptor-invalid',
          pointer: `${pointer}/${field}`,
          message: `required adapter ${id} has an invalid ${field}`,
          left: descriptor[field],
          right: 'non-empty bounded text without control characters',
        }));
      }
    }
    normalized.push(Object.freeze({ id, language, validator }));
  }
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}
