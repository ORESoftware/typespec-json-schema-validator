import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { canonicalStringify, sha256 } from './canonical.mjs';

const VERIFICATION_STATUSES = new Set(['passed', 'failed']);
const HEX_256 = /^[a-f0-9]{64}$/u;

export class UnsafeContractIrVerificationDestinationError extends Error {
  constructor(reason) {
    super(`refusing to replace Contract IR verification destination: ${reason}`);
    this.name = 'UnsafeContractIrVerificationDestinationError';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableDigest(value) {
  return value === null || (typeof value === 'string' && HEX_256.test(value));
}

function isSelfConsistent(value) {
  if (!isObject(value) || typeof value.verificationId !== 'string') return false;
  const body = { ...value };
  delete body.verificationId;
  return value.verificationId === sha256(canonicalStringify(body));
}

function isVerification(value, schema) {
  return isObject(value)
    && value.schema === schema
    && typeof value.verificationId === 'string' && HEX_256.test(value.verificationId)
    && VERIFICATION_STATUSES.has(value.status)
    && typeof value.admissible === 'boolean'
    && isNullableDigest(value.suppliedIrId)
    && isNullableDigest(value.computedIrId)
    && isNullableDigest(value.expectedIrId)
    && isNullableDigest(value.receiptRunId)
    && (value.error === null || typeof value.error === 'string')
    && ((value.status === 'passed'
      && value.admissible === true
      && value.error === null
      && value.suppliedIrId !== null
      && value.computedIrId !== null
      && value.expectedIrId !== null
      && value.receiptRunId !== null)
      || (value.status === 'failed' && value.admissible === false))
    && isSelfConsistent(value);
}

async function inspectDestination(path, schema) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new UnsafeContractIrVerificationDestinationError(
      'target is not a regular, non-symlink file',
    );
  }
  if (info.nlink !== 1) {
    throw new UnsafeContractIrVerificationDestinationError('target has multiple hard links');
  }
  let existing;
  try {
    existing = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new UnsafeContractIrVerificationDestinationError(
      'existing file is not validator-owned Contract IR verification evidence',
    );
  }
  if (!isVerification(existing, schema)) {
    throw new UnsafeContractIrVerificationDestinationError(
      'existing file is not validator-owned Contract IR verification evidence',
    );
  }
  return info;
}

function unchanged(before, after) {
  return before !== null && after !== null
    && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

export async function writeContractIrVerificationFile(path, serializedVerification, schema) {
  if (
    typeof serializedVerification !== 'string'
    || typeof schema !== 'string'
    || schema === ''
  ) {
    throw new TypeError('Contract IR verification text and schema must be nonempty strings');
  }
  let next;
  try {
    next = JSON.parse(serializedVerification);
  } catch {
    throw new TypeError('Contract IR verification is not serialized JSON');
  }
  if (!isVerification(next, schema)) {
    throw new TypeError(
      'Contract IR verification does not contain a recognized validator-owned envelope',
    );
  }

  const absolute = resolve(path);
  const before = await inspectDestination(absolute, schema);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = join(dirname(absolute), `.tsjsv-contract-ir-verification-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(serializedVerification, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (before === null) {
      await link(temporary, absolute);
    } else {
      const after = await inspectDestination(absolute, schema);
      if (!unchanged(before, after)) {
        throw new UnsafeContractIrVerificationDestinationError(
          'target changed during Contract IR verification',
        );
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
