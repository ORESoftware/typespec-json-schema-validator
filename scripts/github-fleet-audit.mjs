#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { canonicalStringify } from '../src/canonical.mjs';
import { runGitHubFleetAudit } from '../src/github-fleet-audit.mjs';

const root = resolve(import.meta.dirname, '..');
const scopePath = resolve(root, process.env.TJSV_FLEET_SCOPE ?? 'security/github-fleet-audit-scope.json');
const receiptPath = resolve(root, process.env.TJSV_FLEET_RECEIPT ?? '.typespec-json-schema-validator/github-fleet-audit.json');
const admittedRevision = process.env.TJSV_ADMITTED_REVISION;
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

if (!admittedRevision) {
  throw new Error('TJSV_ADMITTED_REVISION is required and must be the admitted immutable TJSV main SHA');
}
if (!token) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required; unauthenticated fleet audits are refused');
}

const scope = JSON.parse(await readFile(scopePath, 'utf8'));
const receipt = await runGitHubFleetAudit({ scope, admittedRevision, token });
await mkdir(dirname(receiptPath), { recursive: true });
await writeFile(receiptPath, `${canonicalStringify(receipt, 2)}\n`, { encoding: 'utf8', flag: 'w' });
process.stdout.write(`${canonicalStringify({
  schema: receipt.schema,
  status: receipt.status,
  admittedRevision: receipt.admittedRevision,
  coverage: receipt.coverage,
  summary: receipt.summary ?? null,
  receiptPath,
}, 2)}\n`);

process.exitCode = receipt.status === 'passed' ? 0 : receipt.status === 'stopped_for_evaluation' ? 2 : 1;
