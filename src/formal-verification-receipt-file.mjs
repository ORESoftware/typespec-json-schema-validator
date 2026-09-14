import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { canonicalStringify, isPlainObject, sha256 } from './canonical.mjs';
import { FORMAL_VERIFICATION_RECEIPT_SCHEMA } from './formal-verification.mjs';

const RECEIPT_KEYS = new Set([
  'schema', 'status', 'authority', 'behaviorContractDigest', 'formalManifestDigest',
  'bindings', 'dafny', 'proofRuns', 'findings', 'verificationId',
]);

export class UnsafeFormalVerificationReceiptDestinationError extends Error {
  constructor(reason) {
    super(`refusing to replace formal verification receipt destination: ${reason}`);
    this.name = 'UnsafeFormalVerificationReceiptDestinationError';
  }
}

function isOwnedReceipt(value) {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== RECEIPT_KEYS.size) return false;
  if (!Object.keys(value).every((key) => RECEIPT_KEYS.has(key))) return false;
  if (value.schema !== FORMAL_VERIFICATION_RECEIPT_SCHEMA) return false;
  if (!['passed', 'stopped_for_evaluation'].includes(value.status)) return false;
  if (typeof value.verificationId !== 'string') return false;
  const body = { ...value };
  delete body.verificationId;
  return value.verificationId === `sha256:${sha256(canonicalStringify(body))}`;
}

async function inspectDestination(path) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new UnsafeFormalVerificationReceiptDestinationError('target is not a regular non-symlink file');
  }
  if (info.nlink !== 1) {
    throw new UnsafeFormalVerificationReceiptDestinationError('target has multiple hard links');
  }
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new UnsafeFormalVerificationReceiptDestinationError('existing file is not validator-owned formal evidence');
  }
  if (!isOwnedReceipt(value)) {
    throw new UnsafeFormalVerificationReceiptDestinationError('existing file is not validator-owned formal evidence');
  }
  return info;
}

function unchanged(before, after) {
  return before !== null && after !== null
    && before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

export async function writeFormalVerificationReceipt(path, receipt) {
  if (!isOwnedReceipt(receipt)) throw new TypeError('formal verification receipt envelope is invalid');
  const absolute = resolve(path);
  const before = await inspectDestination(absolute);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = join(dirname(absolute), `.tjsv-formal-verification-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(`${canonicalStringify(receipt, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (before === null) {
      await link(temporary, absolute);
    } else {
      const after = await inspectDestination(absolute);
      if (!unchanged(before, after)) {
        throw new UnsafeFormalVerificationReceiptDestinationError('target changed during formal verification');
      }
      await rename(temporary, absolute);
    }
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return absolute;
}
