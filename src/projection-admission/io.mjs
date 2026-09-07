import { lstat, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { sha256 } from '../canonical.mjs';
import { DEFAULT_LIMITS, validRelativePath } from './constants.mjs';

function safeInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith('../') && !rel.startsWith(`..\\`);
}

async function readSafeRegularFile(path, maxBytes) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error('projection evidence path must be a singly linked regular file');
  }
  if (stat.size > maxBytes) throw new Error('projection evidence file exceeds the configured byte limit');
  const bytes = await readFile(path);
  if (bytes.length !== stat.size) throw new Error('projection evidence file changed while it was read');
  return bytes;
}

export async function loadProjectionManifest(path, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_LIMITS.maxBytes;
  const bytes = await readSafeRegularFile(resolve(path), maxBytes);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('projection manifest must contain valid UTF-8 JSON');
  }
  return parsed;
}

export async function hashProjectionFiles(rootPath, descriptors, options = {}) {
  if (!Array.isArray(descriptors)) throw new TypeError('projection file descriptors must be an array');
  const root = resolve(rootPath);
  const maxFiles = options.maxFiles ?? DEFAULT_LIMITS.maxOutputs;
  const maxBytes = options.maxBytes ?? DEFAULT_LIMITS.maxBytes;
  const maxTotalFileBytes = options.maxTotalFileBytes ?? DEFAULT_LIMITS.maxTotalFileBytes;
  if (descriptors.length > maxFiles) throw new Error('projection file count exceeds the configured limit');
  const seen = new Set();
  const result = [];
  let total = 0;
  for (const descriptor of descriptors) {
    if (!descriptor || !validRelativePath(descriptor.path)) {
      throw new Error('projection file path must be a normalized relative POSIX path');
    }
    if (seen.has(descriptor.path)) throw new Error('projection file path is duplicated');
    seen.add(descriptor.path);
    const candidate = resolve(root, descriptor.path);
    if (!safeInside(root, candidate)) throw new Error('projection file path escapes the configured root');
    const bytes = await readSafeRegularFile(candidate, maxBytes);
    total += bytes.length;
    if (total > maxTotalFileBytes) throw new Error('projection files exceed the configured aggregate byte limit');
    result.push(Object.freeze({
      ...descriptor,
      path: descriptor.path,
      sha256: sha256(bytes),
      size: bytes.length,
    }));
  }
  return Object.freeze(result.sort((left, right) => left.path.localeCompare(right.path)));
}
