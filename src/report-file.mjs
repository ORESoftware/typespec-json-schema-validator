import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const RECEIPT_STATUSES = new Set(['passed', 'stopped_for_evaluation', 'failed']);

export class UnsafeReportDestinationError extends Error {
  constructor(reason) {
    super(`refusing to replace report destination: ${reason}`);
    this.name = 'UnsafeReportDestinationError';
  }
}

// Recognize our receipt envelope, not arbitrary JSON or JSON Schema documents.
// This is a file-ownership guard, not a substitute for report-schema validation.
function isReceipt(value, schema) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.schema === schema
    && typeof value.runId === 'string' && /^[a-f0-9]{64}$/.test(value.runId)
    && RECEIPT_STATUSES.has(value.status)
    && typeof value.zeroUnexplainedFindings === 'boolean'
    && Array.isArray(value.findings);
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
    throw new UnsafeReportDestinationError('target is not a regular, non-symlink file');
  }
  if (info.nlink !== 1) {
    throw new UnsafeReportDestinationError('target has multiple hard links');
  }
  let existing;
  try {
    existing = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // Never include file contents (or the JSON parser's source excerpt) in errors.
    throw new UnsafeReportDestinationError('existing file is not a validator receipt');
  }
  if (!isReceipt(existing, schema)) {
    throw new UnsafeReportDestinationError('existing file is not a validator receipt');
  }
  return info;
}

function unchanged(before, after) {
  return before !== null && after !== null
    && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

/**
 * Publish complete receipt bytes without truncating an existing unrelated file.
 * Existing valid receipts may be replaced; other existing destinations fail closed.
 * The caller serializes first, so serialization failure has no filesystem effects.
 * This does not sandbox hostile concurrent writers or isolate input directories.
 */
export async function writeReportFile(path, serializedReport, schema) {
  if (typeof serializedReport !== 'string' || typeof schema !== 'string' || schema === '') {
    throw new TypeError('receipt text and schema must be nonempty strings');
  }
  let next;
  try {
    next = JSON.parse(serializedReport);
  } catch {
    throw new TypeError('report is not serialized JSON');
  }
  if (!isReceipt(next, schema)) {
    throw new TypeError('report does not contain a recognized validator receipt envelope');
  }

  const absolute = resolve(path);
  const before = await inspectDestination(absolute, schema);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = join(dirname(absolute), `.tsjsv-report-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(serializedReport, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (before === null) {
      // Atomic no-clobber publication: a concurrently created target wins.
      await link(temporary, absolute);
    } else {
      const after = await inspectDestination(absolute, schema);
      if (!unchanged(before, after)) {
        throw new UnsafeReportDestinationError('target changed during report generation');
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
