import {
  CASE_VERDICTS,
  IDENTIFIER_PATTERN,
  isPlainObject,
  normalizedText,
  validBoundedText,
} from './constants.mjs';
import { makeRuntimeFinding } from './findings.mjs';
import { readRuntimeEnvelope } from './envelope.mjs';

export function normalizeResult(value, adapterId, index, findings) {
  const pointer = `#/adapters/${adapterId}/results/${index}`;
  if (!isPlainObject(value)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-invalid',
      pointer,
      message: `adapter ${adapterId} result must be an object`,
      left: value,
      right: 'object',
    }));
    return null;
  }
  value = readRuntimeEnvelope(value,
    ['caseId', 'declaration', 'verdict'], pointer, 'result', findings);

  const caseId = normalizedText(value.caseId);
  const declaration = normalizedText(value.declaration);
  const verdict = value.verdict;
  if (!validBoundedText(caseId) || !IDENTIFIER_PATTERN.test(caseId)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-case-id-invalid',
      pointer: `${pointer}/caseId`,
      message: `adapter ${adapterId} emitted an invalid case id`,
      left: value.caseId,
      right: 'bounded lowercase identifier',
    }));
    return null;
  }
  if (!validBoundedText(declaration, 512)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-result-declaration-invalid',
      pointer: `${pointer}/declaration`,
      message: `adapter ${adapterId} case ${caseId} has an invalid declaration identity`,
      left: value.declaration,
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
      left: verdict,
      right: [...CASE_VERDICTS].sort(),
    }));
    return null;
  }
  return Object.freeze({ caseId, declaration, verdict });
}
