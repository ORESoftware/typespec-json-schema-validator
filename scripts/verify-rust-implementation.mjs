#!/usr/bin/env node
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { canonicalStringify } from '../src/canonical.mjs';
import { verifyImplementationProofs } from '../src/implementation-verification.mjs';

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function removeIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const root = resolve(process.cwd());
const behaviorPath = resolve(root, required('TSJSV_IMPLEMENTATION_BEHAVIOR'));
const formalReceiptPath = resolve(root, required('TSJSV_IMPLEMENTATION_FORMAL_RECEIPT'));
const manifestPath = resolve(root, required('TSJSV_IMPLEMENTATION_MANIFEST'));
const receiptPath = resolve(root, process.env.TSJSV_IMPLEMENTATION_VERIFICATION
  ?? '.typespec-json-schema-validator/implementation-verification.json');

await removeIfPresent(receiptPath);

const receipt = await verifyImplementationProofs({
  root,
  behaviorContract: await readJson(behaviorPath),
  formalReceipt: await readJson(formalReceiptPath),
  manifest: await readJson(manifestPath),
  cargoBin: process.env.TSJSV_IMPLEMENTATION_CARGO_BIN ?? 'cargo',
  verusBin: process.env.TSJSV_IMPLEMENTATION_VERUS_BIN ?? 'verus',
  gitBin: process.env.TSJSV_IMPLEMENTATION_GIT_BIN ?? 'git',
});

await mkdir(dirname(receiptPath), { recursive: true });
const temporary = `${receiptPath}.tmp-${process.pid}`;
await writeFile(temporary, `${canonicalStringify(receipt, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
await rename(temporary, receiptPath);

if (receipt.status !== 'passed') {
  process.exitCode = 1;
}
