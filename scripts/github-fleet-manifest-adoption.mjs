#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { canonicalStringify } from '../src/canonical.mjs';
import { auditFleetManifestAdoption } from '../src/github-fleet-manifest-adoption.mjs';

const root = resolve(import.meta.dirname, '..');
const fleetReceiptPath = resolve(
  root,
  process.env.TJSV_FLEET_RECEIPT ?? '.typespec-json-schema-validator/github-fleet-audit.json',
);
const receiptPath = resolve(
  root,
  process.env.TJSV_FLEET_MANIFEST_RECEIPT
    ?? '.typespec-json-schema-validator/github-fleet-manifest-adoption.json',
);
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

if (!token) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required; unauthenticated fleet adoption audits are refused');
}

const fleetReceipt = JSON.parse(await readFile(fleetReceiptPath, 'utf8'));
const receipt = await auditFleetManifestAdoption({ fleetReceipt, token });
await mkdir(dirname(receiptPath), { recursive: true });
await writeFile(receiptPath, `${canonicalStringify(receipt, 2)}\n`, { encoding: 'utf8', flag: 'w' });

process.stdout.write(`${canonicalStringify({
  schema: receipt.schema,
  status: receipt.status,
  summary: receipt.summary,
  migrationQueue: receipt.migrationQueue,
  receiptPath,
}, 2)}\n`);

process.exitCode = receipt.status === 'passed' ? 0 : receipt.status === 'stopped_for_evaluation' ? 2 : 1;
