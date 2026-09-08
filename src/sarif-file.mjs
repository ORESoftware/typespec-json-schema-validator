import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const SARIF_VERSION = '2.1.0';
const SARIF_TOOL_NAME = '@oresoftware/typespec-json-schema-validator';
const REPORT_SCHEMA = 'ores.typespec-json-schema-validator.report/v1';

export class UnsafeSarifDestinationError extends Error {
  constructor(reason) {
    super(`refusing to replace SARIF destination: ${reason}`);
    this.name = 'UnsafeSarifDestinationError';
  }
}

function isOwnedSarif(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (value.version !== SARIF_VERSION || !Array.isArray(value.runs) || value.runs.length !== 1) {
    return false;
  }
  const run = value.runs[0];
  return run !== null
    && typeof run === 'object'
    && !Array.isArray(run)
    && run.tool?.driver?.name === SARIF_TOOL_NAME
    && run.properties?.reportSchema === REPORT_SCHEMA
    && typeof run.properties?.reportRunId === 'string'
    && /^[a-f0-9]{64}$/.test(run.properties.reportRunId);
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
    throw new UnsafeSarifDestinationError('target is not a regular, non-symlink file');
  }
  if (info.nlink !== 1) {
    throw new UnsafeSarifDestinationError('target has multiple hard links');
  }
  let existing;
  try {
    existing = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new UnsafeSarifDestinationError('existing file is not validator-owned SARIF');
  }
  if (!isOwnedSarif(existing)) {
    throw new UnsafeSarifDestinationError('existing file is not validator-owned SARIF');
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
 * Publish complete validator-owned SARIF bytes without truncating an unrelated file.
 * Existing SARIF produced by this tool may be replaced; every other existing target fails closed.
 */
export async function writeSarifFile(path, serializedSarif) {
  if (typeof serializedSarif !== 'string' || serializedSarif === '') {
    throw new TypeError('SARIF text must be a nonempty string');
  }
  let next;
  try {
    next = JSON.parse(serializedSarif);
  } catch {
    throw new TypeError('SARIF is not serialized JSON');
  }
  if (!isOwnedSarif(next)) {
    throw new TypeError('SARIF does not contain a recognized validator-owned envelope');
  }

  const absolute = resolve(path);
  const before = await inspectDestination(absolute);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = join(dirname(absolute), `.tsjsv-sarif-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(serializedSarif, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (before === null) {
      await link(temporary, absolute);
    } else {
      const after = await inspectDestination(absolute);
      if (!unchanged(before, after)) {
        throw new UnsafeSarifDestinationError('target changed during SARIF generation');
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
