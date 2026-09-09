import {
  ADAPTER_STATUSES,
  IDENTIFIER_PATTERN,
  isPlainObject,
  normalizedText,
  validBoundedText,
} from './constants.mjs';
import { makeRuntimeFinding } from './findings.mjs';
import { readRuntimeEnvelope } from './envelope.mjs';

export function normalizeAdapterMetadata(value, index, findings) {
  const pointer = `#/adapters/${index}`;
  if (!isPlainObject(value)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-adapter-invalid',
      pointer,
      message: 'runtime adapter evidence must be an object',
      left: value,
      right: 'object',
    }));
    return null;
  }

  value = readRuntimeEnvelope(value,
    ['id', 'language', 'runtime', 'validator', 'toolchain', 'status', 'results'],
    pointer, 'adapter', findings);

  const id = normalizedText(value.id);
  if (!validBoundedText(id) || !IDENTIFIER_PATTERN.test(id)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-adapter-id-invalid',
      pointer: `${pointer}/id`,
      message: 'runtime adapter id must be a bounded lowercase identifier',
      left: value.id,
      right: 'lowercase letters, digits, dot, underscore, or hyphen',
    }));
    return null;
  }

  const textFields = {};
  for (const [field, maxLength] of [['language', 128], ['runtime', 128], ['validator', 128], ['toolchain', 512]]) {
    const text = normalizedText(value[field]);
    if (!validBoundedText(text, maxLength)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-adapter-metadata-invalid',
        pointer: `${pointer}/${field}`,
        message: `adapter ${id} must declare bounded ${field} metadata`,
        left: value[field],
        right: 'non-empty text without control characters',
      }));
    } else {
      textFields[field] = text;
    }
  }

  if (!ADAPTER_STATUSES.has(value.status)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-adapter-status-invalid',
      pointer: `${pointer}/status`,
      message: `adapter ${id} has an invalid status`,
      left: value.status,
      right: [...ADAPTER_STATUSES].sort(),
    }));
  }

  return Object.freeze({
    id,
    pointer,
    status: value.status,
    results: value.results,
    textFields: Object.freeze(textFields),
  });
}
