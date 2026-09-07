import {
  DIGEST_PATTERN,
  RUNTIME_EVIDENCE_SCHEMA,
  isPlainObject,
  positiveSafeInteger,
} from './constants.mjs';
import { normalizeAdapter } from './adapter.mjs';
import { makeRuntimeFinding, sortRuntimeFindings } from './findings.mjs';

function validateDigest(value, pointer, label, findings) {
  if (!DIGEST_PATTERN.test(value ?? '')) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-evidence-invalid-digest',
      pointer,
      message: `${label} must be a lowercase SHA-256 digest`,
      left: value,
      right: '64 lowercase hexadecimal characters',
    }));
    return null;
  }
  return value;
}

export {
  normalizeExpectedCases,
  normalizeRequiredAdapters,
} from './trusted-inputs.mjs';

export function validateRuntimeEvidence(value, options = {}) {
  const maxAdapters = positiveSafeInteger(options.maxAdapters ?? 64, 'maxAdapters');
  const maxResultsPerAdapter = positiveSafeInteger(
    options.maxResultsPerAdapter ?? 100_000,
    'maxResultsPerAdapter',
  );
  const findings = [];
  if (!isPlainObject(value)) {
    const finding = makeRuntimeFinding({
      ruleId: 'runtime-evidence-invalid',
      pointer: '#',
      message: 'runtime evidence must be an object',
      left: value,
      right: 'object',
    });
    return { normalized: null, findings: [finding] };
  }

  if (value.schema !== RUNTIME_EVIDENCE_SCHEMA) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-evidence-schema-mismatch',
      pointer: '#/schema',
      message: 'runtime evidence schema identifier is missing or unsupported',
      left: value.schema,
      right: RUNTIME_EVIDENCE_SCHEMA,
    }));
  }
  const contractIrId = validateDigest(
    value.contractIrId,
    '#/contractIrId',
    'contractIrId',
    findings,
  );
  const inputDigest = validateDigest(value.inputDigest, '#/inputDigest', 'inputDigest', findings);
  const corpusDigest = validateDigest(value.corpusDigest, '#/corpusDigest', 'corpusDigest', findings);

  if (!Array.isArray(value.adapters)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-evidence-adapters-invalid',
      pointer: '#/adapters',
      message: 'runtime evidence adapters must be an array',
      left: value.adapters,
      right: 'array',
    }));
    return {
      normalized: Object.freeze({
        schema: value.schema,
        contractIrId,
        inputDigest,
        corpusDigest,
        adapters: Object.freeze([]),
      }),
      findings: sortRuntimeFindings(findings),
    };
  }
  if (value.adapters.length === 0) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-evidence-adapters-empty',
      pointer: '#/adapters',
      message: 'runtime evidence must contain at least one executed adapter',
      left: 0,
      right: 'one or more adapters',
    }));
  }
  if (value.adapters.length > maxAdapters) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-adapter-limit-exceeded',
      pointer: '#/adapters',
      message: `runtime evidence contains ${value.adapters.length} adapters; maximum is ${maxAdapters}`,
      left: value.adapters.length,
      right: maxAdapters,
    }));
  }

  const adapters = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.adapters.length, maxAdapters); index += 1) {
    const adapter = normalizeAdapter(value.adapters[index], index, findings, maxResultsPerAdapter);
    if (!adapter) continue;
    if (seen.has(adapter.id)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-adapter-duplicate',
        pointer: `#/adapters/${index}/id`,
        message: `runtime evidence contains duplicate adapter ${adapter.id}`,
        left: adapter.id,
        right: 'unique adapter id',
      }));
      continue;
    }
    seen.add(adapter.id);
    adapters.push(adapter);
  }

  const normalized = Object.freeze({
    schema: value.schema,
    contractIrId,
    inputDigest,
    corpusDigest,
    adapters: Object.freeze(adapters.sort((left, right) => left.id.localeCompare(right.id))),
  });
  return { normalized, findings: sortRuntimeFindings(findings) };
}
