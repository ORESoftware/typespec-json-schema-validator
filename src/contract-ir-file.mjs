import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { canonicalStringify, sha256 } from './canonical.mjs';

const IR_STATUSES = new Set(['passed', 'stopped_for_evaluation', 'failed']);
const HEX_256 = /^[a-f0-9]{64}$/u;

export class UnsafeContractIrDestinationError extends Error {
  constructor(reason) {
    super(`refusing to replace Contract IR destination: ${reason}`);
    this.name = 'UnsafeContractIrDestinationError';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSelfConsistent(value) {
  if (!isObject(value) || typeof value.irId !== 'string') return false;
  const body = { ...value };
  delete body.irId;
  return value.irId === sha256(canonicalStringify(body));
}

function isContractIr(value, schema) {
  return isObject(value)
    && value.schema === schema
    && typeof value.irId === 'string' && HEX_256.test(value.irId)
    && IR_STATUSES.has(value.status)
    && typeof value.admissible === 'boolean'
    && isObject(value.admission)
    && isObject(value.admission.receipt)
    && typeof value.admission.receipt.runId === 'string'
    && HEX_256.test(value.admission.receipt.runId)
    && Array.isArray(value.declarations)
    && Array.isArray(value.excludedDeclarations)
    && Array.isArray(value.outOfScopeDeclarations)
    && ((value.status === 'passed' && value.admissible === true)
      || (value.status !== 'passed' && value.admissible === false))
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
    throw new UnsafeContractIrDestinationError('target is not a regular, non-symlink file');
  }
  if (info.nlink !== 1) {
    throw new UnsafeContractIrDestinationError('target has multiple hard links');
  }
  let existing;
  try {
    existing = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new UnsafeContractIrDestinationError('existing file is not validator-owned Contract IR');
  }
  if (!isContractIr(existing, schema)) {
    throw new UnsafeContractIrDestinationError('existing file is not validator-owned Contract IR');
  }
  return info;
}

function unchanged(before, after) {
  return before !== null && after !== null
    && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

export async function writeContractIrFile(path, serializedIr, schema) {
  if (typeof serializedIr !== 'string' || typeof schema !== 'string' || schema === '') {
    throw new TypeError('Contract IR text and schema must be nonempty strings');
  }
  let next;
  try {
    next = JSON.parse(serializedIr);
  } catch {
    throw new TypeError('Contract IR is not serialized JSON');
  }
  if (!isContractIr(next, schema)) {
    throw new TypeError('Contract IR does not contain a recognized validator-owned envelope');
  }

  const absolute = resolve(path);
  const before = await inspectDestination(absolute, schema);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = join(dirname(absolute), `.tsjsv-contract-ir-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(serializedIr, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (before === null) {
      await link(temporary, absolute);
    } else {
      const after = await inspectDestination(absolute, schema);
      if (!unchanged(before, after)) {
        throw new UnsafeContractIrDestinationError('target changed during Contract IR generation');
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
