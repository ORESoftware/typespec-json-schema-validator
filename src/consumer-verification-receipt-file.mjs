import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { canonicalStringify, sha256 } from './canonical.mjs';

const HEX_256 = /^[a-f0-9]{64}$/u;
const FAILURE_CODES = new Set(['consumer-verification-failed']);

export class UnsafeConsumerVerificationReceiptDestinationError extends Error {
  constructor(reason) {
    super(`refusing to replace consumer verification receipt destination: ${reason}`);
    this.name = 'UnsafeConsumerVerificationReceiptDestinationError';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableDigest(value) {
  return value === null || (typeof value === 'string' && HEX_256.test(value));
}

function identitiesAreNormalized(values) {
  return Array.isArray(values)
    && values.every((value) => typeof value === 'string' && value !== '' && value.trim() === value)
    && values.every((value, index) => index === 0 || values[index - 1] < value);
}

function isSelfConsistent(value) {
  if (!isObject(value) || typeof value.verificationId !== 'string') return false;
  const body = { ...value };
  delete body.verificationId;
  return value.verificationId === sha256(canonicalStringify(body));
}

function isReceipt(value, schema) {
  const passed = value?.status === 'passed';
  return isObject(value)
    && value.schema === schema
    && typeof value.verificationId === 'string'
    && HEX_256.test(value.verificationId)
    && (value.status === 'passed' || value.status === 'failed')
    && typeof value.admissible === 'boolean'
    && isNullableDigest(value.suppliedIrId)
    && isNullableDigest(value.computedIrId)
    && isNullableDigest(value.expectedIrId)
    && isNullableDigest(value.receiptRunId)
    && identitiesAreNormalized(value.declarationIds)
    && (value.failureCode === null || FAILURE_CODES.has(value.failureCode))
    && (passed
      ? value.admissible === true
        && value.suppliedIrId !== null
        && value.computedIrId === value.suppliedIrId
        && value.expectedIrId === value.suppliedIrId
        && value.receiptRunId !== null
        && value.declarationIds.length > 0
        && value.failureCode === null
      : value.admissible === false && value.failureCode !== null)
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
    throw new UnsafeConsumerVerificationReceiptDestinationError(
      'target is not a regular, non-symlink file',
    );
  }
  if (info.nlink !== 1) {
    throw new UnsafeConsumerVerificationReceiptDestinationError(
      'target has multiple hard links',
    );
  }
  let existing;
  try {
    existing = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new UnsafeConsumerVerificationReceiptDestinationError(
      'existing file is not validator-owned consumer verification evidence',
    );
  }
  if (!isReceipt(existing, schema)) {
    throw new UnsafeConsumerVerificationReceiptDestinationError(
      'existing file is not validator-owned consumer verification evidence',
    );
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

export async function writeConsumerVerificationReceiptFile(path, serializedReceipt, schema) {
  if (
    typeof serializedReceipt !== 'string'
    || typeof schema !== 'string'
    || schema === ''
  ) {
    throw new TypeError('consumer verification receipt text and schema must be nonempty strings');
  }
  let next;
  try {
    next = JSON.parse(serializedReceipt);
  } catch {
    throw new TypeError('consumer verification receipt is not serialized JSON');
  }
  if (!isReceipt(next, schema)) {
    throw new TypeError(
      'consumer verification receipt does not contain a recognized validator-owned envelope',
    );
  }

  const absolute = resolve(path);
  const before = await inspectDestination(absolute, schema);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = join(
    dirname(absolute),
    `.tsjsv-consumer-verification-${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(serializedReceipt, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (before === null) {
      await link(temporary, absolute);
    } else {
      const after = await inspectDestination(absolute, schema);
      if (!unchanged(before, after)) {
        throw new UnsafeConsumerVerificationReceiptDestinationError(
          'target changed during consumer verification',
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
