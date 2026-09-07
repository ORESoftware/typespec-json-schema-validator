import {
  canonicalStringify,
  stableFindingFingerprint,
} from '../canonical.mjs';

export function makeRuntimeFinding(input) {
  const finding = {
    severity: 'error',
    resolutionState: 'unexplained',
    comparison: 'runtime-conformance',
    ...input,
  };
  finding.fingerprint = stableFindingFingerprint(finding);
  return finding;
}

export function sortRuntimeFindings(findings) {
  return [...findings].sort((left, right) =>
    canonicalStringify([
      left.ruleId,
      left.declaration ?? '',
      left.pointer ?? '',
      left.fingerprint,
    ]).localeCompare(canonicalStringify([
      right.ruleId,
      right.declaration ?? '',
      right.pointer ?? '',
      right.fingerprint,
    ])),
  );
}
