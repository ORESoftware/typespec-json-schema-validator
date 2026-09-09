import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  createProtobufCompatibilityReceipt,
  failedProtobufCompatibilityReceipt,
  writeProtobufCompatibilityReceipt,
} from '../src/protobuf-compatibility.mjs';

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

function workspacePath(root, value, label) {
  if (typeof value !== 'string' || value === '' || value.includes('\\') || value.startsWith('/')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} must be a normalized relative POSIX path`);
  }
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, value);
  const local = relative(absoluteRoot, candidate);
  if (local === '' || local === '..' || isAbsolute(local)
    || local.startsWith('../') || local.startsWith('..\\')) {
    throw new Error(`${label} must remain inside the configured root`);
  }
  return candidate;
}

async function readJson(path, label) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new Error(`${label} must be a singly linked regular file`);
  }
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
  return value;
}

function maxFindings() {
  const raw = process.env.TSJSV_MAX_FINDINGS ?? '250';
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error('TSJSV_MAX_FINDINGS must be an integer between 1 and 10000');
  }
  return value;
}

function quiet() {
  const value = (process.env.TSJSV_QUIET ?? 'false').toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error('TSJSV_QUIET must be boolean');
}

const root = resolve(process.env.TSJSV_PROTOBUF_ROOT ?? '.');
let baseline = null;
let current = null;
let receipt;
let verificationPath;
let shouldQuiet = false;

try {
  const baselinePath = workspacePath(root, required('TSJSV_PROTOBUF_BASELINE'), 'protobuf baseline');
  const currentPath = workspacePath(root, required('TSJSV_PROTOBUF_CURRENT'), 'protobuf current projection');
  verificationPath = workspacePath(
    root,
    process.env.TSJSV_PROTOBUF_VERIFICATION
      ?? '.typespec-json-schema-validator/protobuf-compatibility.json',
    'protobuf compatibility receipt',
  );
  shouldQuiet = quiet();
  [baseline, current] = await Promise.all([
    readJson(baselinePath, 'protobuf baseline'),
    readJson(currentPath, 'protobuf current projection'),
  ]);
  receipt = createProtobufCompatibilityReceipt({ baseline, current, maxFindings: maxFindings() });
} catch (error) {
  receipt = failedProtobufCompatibilityReceipt({ baseline, current });
  try {
    verificationPath ??= workspacePath(
      root,
      process.env.TSJSV_PROTOBUF_VERIFICATION
        ?? '.typespec-json-schema-validator/protobuf-compatibility.json',
      'protobuf compatibility receipt',
    );
  } catch {
    verificationPath = resolve(root, '.typespec-json-schema-validator/protobuf-compatibility.json');
  }
  process.stderr.write(`Protobuf compatibility verification failed: ${error.message}\n`);
}

try {
  await writeProtobufCompatibilityReceipt(verificationPath, receipt);
} catch (error) {
  process.stderr.write(`could not write protobuf compatibility receipt: ${error.message}\n`);
  process.exitCode = 3;
}

if (process.exitCode !== 3) {
  if (!shouldQuiet) process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.status === 'passed' ? 0 : receipt.status === 'stopped_for_evaluation' ? 2 : 3;
}
