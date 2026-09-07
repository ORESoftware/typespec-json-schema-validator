import { canonicalStringify, sha256 } from '../canonical.mjs';

export function makeProjectionFinding({ ruleId, pointer, message, projection, path }) {
  const body = {
    ruleId,
    severity: 'error',
    resolutionState: 'unexplained',
    comparison: 'downstream-projection-admission',
    pointer,
    message,
    ...(projection ? { projection } : {}),
    ...(path ? { path } : {}),
  };
  return Object.freeze({ ...body, fingerprint: sha256(canonicalStringify(body)) });
}

export function sortProjectionFindings(findings) {
  return [...findings].sort((left, right) =>
    canonicalStringify([left.ruleId, left.pointer, left.projection ?? '', left.path ?? '', left.fingerprint])
      .localeCompare(canonicalStringify([
        right.ruleId,
        right.pointer,
        right.projection ?? '',
        right.path ?? '',
        right.fingerprint,
      ])),
  );
}
