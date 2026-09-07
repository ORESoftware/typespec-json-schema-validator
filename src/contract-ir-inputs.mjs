const HEX_256 = /^[a-f0-9]{64}$/u;

function requireCondition(condition, message) {
  if (!condition) throw new Error(`cannot build admissible Contract IR: ${message}`);
}

function fileClosure(files, lane, side) {
  requireCondition(Array.isArray(files) && files.length > 0, `${lane} ${side} file evidence must be a nonempty array`);
  const closure = new Map();
  for (const [index, file] of files.entries()) {
    const label = `${lane} ${side} file evidence at index ${index}`;
    requireCondition(file !== null && typeof file === 'object' && !Array.isArray(file), `${label} must be an object`);
    // Schema documents carry an absolute path as well as a relative identity.
    // Prefer the latter so a clean checkout may move without changing evidence.
    const key = Object.hasOwn(file, 'relativePath') ? 'relativePath' : 'path';
    requireCondition(Object.hasOwn(file, key), `${label} path is missing`);
    const path = file[key];
    requireCondition(typeof path === 'string' && path.length > 0 && !path.includes('\0'), `${label} path is invalid`);
    requireCondition(Object.hasOwn(file, 'sha256') && typeof file.sha256 === 'string' && HEX_256.test(file.sha256), `${label} SHA-256 is invalid`);
    requireCondition(!closure.has(path), `${lane} ${side} file evidence repeats path ${JSON.stringify(path)}`);
    closure.set(path, file.sha256);
  }
  return closure;
}

/**
 * Compare recorded raw-file evidence with freshly loaded source evidence.
 * Aggregate normalized-schema digests alone do not bind exact source bytes.
 * Paths are opaque identities, never resolved, normalized, or used for I/O.
 * In particular, ../ imports and prototype-like filenames remain distinct.
 */
export function assertExactSourceFiles({ report, typespecInventory, generatedCollection, authoredCollection }) {
  for (const [lane, recordedFiles, currentFiles] of [
    ['TypeSpec', report?.inputs?.typespec?.files, typespecInventory?.files],
    ['generated JSON Schema', report?.inputs?.generatedJsonSchema?.files, generatedCollection?.documents],
    ['authored JSON Schema', report?.inputs?.authoredJsonSchema?.files, authoredCollection?.documents],
  ]) {
    const recorded = fileClosure(recordedFiles, lane, 'receipt');
    const current = fileClosure(currentFiles, lane, 'current');
    const paths = [...new Set([...recorded.keys(), ...current.keys()])].sort();
    for (const path of paths) {
      requireCondition(recorded.has(path), `${lane} current file is absent from receipt: ${JSON.stringify(path)}`);
      requireCondition(current.has(path), `${lane} receipt file is absent from current inputs: ${JSON.stringify(path)}`);
      requireCondition(recorded.get(path) === current.get(path), `${lane} source-file SHA-256 no longer matches the receipt: ${JSON.stringify(path)}`);
    }
  }
}
