import { makeRuntimeFinding } from './findings.mjs';
import { normalizeAdapterMetadata } from './adapter-metadata.mjs';
import { normalizeResult } from './result.mjs';

export function normalizeAdapter(value, index, findings, maxResultsPerAdapter) {
  const metadata = normalizeAdapterMetadata(value, index, findings);
  if (!metadata) return null;
  const { id, pointer, status, textFields, results: rawResults } = metadata;

  if (!Array.isArray(rawResults)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-adapter-results-invalid',
      pointer: `${pointer}/results`,
      message: `adapter ${id} results must be an array`,
      left: rawResults,
      right: 'array',
    }));
    return Object.freeze({ id, ...textFields, status, results: Object.freeze([]) });
  }

  if (rawResults.length > maxResultsPerAdapter) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-adapter-result-limit-exceeded',
      pointer: `${pointer}/results`,
      message: `adapter ${id} emitted ${rawResults.length} results; maximum is ${maxResultsPerAdapter}`,
      left: rawResults.length,
      right: maxResultsPerAdapter,
    }));
  }

  const results = [];
  const seen = new Set();
  for (let resultIndex = 0; resultIndex < Math.min(rawResults.length, maxResultsPerAdapter); resultIndex += 1) {
    const result = normalizeResult(rawResults[resultIndex], id, resultIndex, findings);
    if (!result) continue;
    if (seen.has(result.caseId)) {
      findings.push(makeRuntimeFinding({
        ruleId: 'runtime-result-duplicate',
        declaration: result.declaration,
        pointer: `${pointer}/results/${resultIndex}/caseId`,
        message: `adapter ${id} emitted duplicate case ${result.caseId}`,
        left: result.caseId,
        right: 'unique case id',
      }));
      continue;
    }
    seen.add(result.caseId);
    results.push(result);
  }

  return Object.freeze({
    id,
    ...textFields,
    status,
    results: Object.freeze(results.sort((left, right) => left.caseId.localeCompare(right.caseId))),
  });
}
