import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { positiveSafeInteger } from './constants.mjs';

export async function loadRuntimeEvidence(path, options = {}) {
  const absolute = resolve(path);
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  positiveSafeInteger(maxBytes, 'runtime evidence maxBytes');
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`runtime evidence path must be a regular non-symbolic-link file: ${absolute}`);
  }
  if (metadata.size > maxBytes) {
    throw new Error(`runtime evidence exceeds ${maxBytes} bytes: ${absolute}`);
  }
  const raw = await readFile(absolute, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid runtime evidence JSON in ${absolute}: ${error.message}`, { cause: error });
  }
}
