import { isAbsolute, relative, resolve } from 'node:path';
import { sha256 } from '../canonical.mjs';
import { DEFAULT_LIMITS, isPlainObject, validRelativePath } from './constants.mjs';
import { fileLimit, readProjectionFile } from './safe-file.mjs';

function safeInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !isAbsolute(rel) && !rel.startsWith('../') && !rel.startsWith(`..\\`);
}

function limitOption(options, key, fallback) {
  if (!isPlainObject(options)) throw new TypeError('projection I/O options must be an object');
  return fileLimit(options[key] === undefined ? fallback : options[key], key);
}

export async function loadProjectionManifest(path, options = {}) {
  const maxBytes = limitOption(options, 'maxBytes', DEFAULT_LIMITS.maxBytes);
  const bytes = await readProjectionFile(path, maxBytes);
  try {
    // Retain the existing JSON.parse rejection of a leading BOM. Invalid UTF-8
    // must never be silently replaced before parsing or evidence comparison.
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    throw new Error('projection manifest must contain valid UTF-8 JSON');
  }
}

export async function hashProjectionFiles(rootPath, descriptors, options = {}) {
  if (typeof rootPath !== 'string' || rootPath.length === 0 || rootPath.includes('\0')) {
    throw new TypeError('projection root must be a nonempty string');
  }
  if (!Array.isArray(descriptors)) throw new TypeError('projection file descriptors must be an array');
  const root = resolve(rootPath);
  const maxFiles = limitOption(options, 'maxFiles', DEFAULT_LIMITS.maxOutputs);
  const maxBytes = limitOption(options, 'maxBytes', DEFAULT_LIMITS.maxBytes);
  const maxTotalFileBytes = limitOption(options, 'maxTotalFileBytes', DEFAULT_LIMITS.maxTotalFileBytes);
  if (descriptors.length > maxFiles) throw new Error('projection file count exceeds the configured limit');
  const seen = new Set();
  // Snapshot identities and metadata before the first await; caller mutation
  // must not switch a path after it has been validated.
  const requested = Array.from(descriptors, (descriptor) => {
    if (!isPlainObject(descriptor) || !Object.hasOwn(descriptor, 'path') || !validRelativePath(descriptor.path)) {
      throw new Error('projection file path must be a normalized relative POSIX path');
    }
    const snapshot = { ...descriptor };
    if (seen.has(snapshot.path)) throw new Error('projection file path is duplicated');
    seen.add(snapshot.path);
    if (!safeInside(root, resolve(root, snapshot.path))) throw new Error('projection file path escapes the configured root');
    return snapshot;
  });
  const result = [];
  let total = 0;
  for (const descriptor of requested) {
    const remaining = maxTotalFileBytes - total;
    let bytes;
    try {
      bytes = await readProjectionFile(resolve(root, descriptor.path), Math.min(maxBytes, remaining));
    } catch (error) {
      if (remaining < maxBytes && error.message === 'projection evidence file exceeds the configured byte limit') {
        throw new Error('projection files exceed the configured aggregate byte limit');
      }
      throw error;
    }
    total += bytes.length;
    result.push(Object.freeze({
      ...descriptor,
      path: descriptor.path,
      sha256: sha256(bytes),
      size: bytes.length,
    }));
  }
  return Object.freeze(result.sort((left, right) => left.path.localeCompare(right.path)));
}
