import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { LEGAL_DRAFT_BANNER, LEGAL_ROLLOUT_MANIFEST_SCHEMA } from '../../src/legal-rollout/index.mjs';
import { sha256 } from '../../src/canonical.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const cli = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const typespec = resolve(packageRoot, 'schema/legal-rollout-manifest.tsp');
const schema = resolve(packageRoot, 'schema/legal-rollout-manifest.schema.json');

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function legalText(classification, id) {
  const label = classification[0].toUpperCase() + classification.slice(1);
  return `# ${id}\n\n> **${LEGAL_DRAFT_BANNER}**\n>\n> Counsel review is required before use.\n\n**Classification:** ${label} — agreement template\n\n[PARTY LEGAL NAME]\n\n**Party initials:** ________\n\n## Signatures\n\nBy: ______________________________  Date: ____________________\n\nName: [SIGNER NAME]\n\nTitle/Capacity: [SIGNER CAPACITY]\n\nInitials: ________\n\n**Executed-copy location:** [APPROVED RECORDS SYSTEM — NEVER GIT]\n`;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-legal-cli-'));
  const documents = [];
  for (const [classification, count] of [['external', 5], ['internal', 3]]) {
    for (let index = 1; index <= count; index += 1) {
      const id = `${classification}-${index}`;
      const path = `docs/legal/${classification}/${id}.md`;
      const content = legalText(classification, id);
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content, 'utf8');
      documents.push({
        id,
        path,
        classification,
        agreementType: `${classification}-agreement-${index}`,
        sha256: sha256(Buffer.from(content)),
        status: 'draft',
        required: true,
      });
    }
  }
  const manifest = {
    schema: LEGAL_ROLLOUT_MANIFEST_SCHEMA,
    repository: 'example/legal-docs',
    legalRoot: 'docs/legal',
    releaseApproved: false,
    documents,
  };
  const manifestPath = join(root, 'docs/legal/manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { root, manifest, manifestPath };
}

test('CLI admits exact peer authorities and rejects later document tampering', async () => {
  const { root, manifest, manifestPath } = await fixture();
  try {
    const parityReport = join(root, '.legal-rollout/parity.json');
    const contractIr = join(root, '.legal-rollout/contract-ir.json');
    const outputDir = join(root, '.legal-rollout/generated');
    const receipt = join(root, '.legal-rollout/receipt.json');

    const check = run([
      'check',
      '--typespec', typespec,
      '--schema', schema,
      '--output-dir', outputDir,
      '--bundle-id', 'legal-rollout.generated.schema.json',
      '--report', parityReport,
      '--contract-ir', contractIr,
      '--quiet',
    ], root);
    assert.equal(check.status, 0, `check failed\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`);

    const admitted = run([
      'legal-rollout',
      '--manifest', manifestPath,
      '--typespec', typespec,
      '--schema', schema,
      '--parity-report', parityReport,
      '--contract-ir', contractIr,
      '--project-root', root,
      '--legal-root', 'docs/legal',
      '--report', receipt,
      '--quiet',
    ], root);
    const passed = JSON.parse(await readFile(receipt, 'utf8'));
    assert.equal(admitted.status, 0, `admission failed: ${JSON.stringify(passed.findings)}`);
    assert.equal(passed.schema, 'ores.legal-rollout.receipt/v1');
    assert.equal(passed.status, 'passed');
    assert.equal(passed.admission.contractIr.admissible, true);
    assert.deepEqual(passed.admission.manifestLaneVerdicts, {
      'typespec-generated-json-schema': true,
      'authored-json-schema': true,
    });
    assert.equal(passed.coverage.documents, 8);

    const target = join(root, manifest.documents[0].path);
    await writeFile(target, `${await readFile(target, 'utf8')}\ntampered\n`, 'utf8');
    const rejected = run([
      'legal-rollout',
      '--manifest', manifestPath,
      '--typespec', typespec,
      '--schema', schema,
      '--parity-report', parityReport,
      '--contract-ir', contractIr,
      '--project-root', root,
      '--legal-root', 'docs/legal',
      '--report', receipt,
      '--quiet',
    ], root);
    assert.equal(rejected.status, 2, `tamper run did not stop\nstdout:\n${rejected.stdout}\nstderr:\n${rejected.stderr}`);
    const stopped = JSON.parse(await readFile(receipt, 'utf8'));
    assert.equal(stopped.status, 'stopped_for_evaluation');
    assert.ok(stopped.findings.some((item) => item.ruleId === 'legal-document-digest-mismatch'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI release mode fails closed while required documents remain draft', async () => {
  const { root, manifestPath } = await fixture();
  try {
    const parityReport = join(root, '.legal-rollout/parity.json');
    const contractIr = join(root, '.legal-rollout/contract-ir.json');
    const receipt = join(root, '.legal-rollout/receipt.json');
    const check = run([
      'check',
      '--typespec', typespec,
      '--schema', schema,
      '--output-dir', join(root, '.legal-rollout/generated'),
      '--bundle-id', 'legal-rollout.generated.schema.json',
      '--report', parityReport,
      '--contract-ir', contractIr,
      '--quiet',
    ], root);
    assert.equal(check.status, 0, check.stderr);

    const release = run([
      'legal-rollout',
      '--manifest', manifestPath,
      '--typespec', typespec,
      '--schema', schema,
      '--parity-report', parityReport,
      '--contract-ir', contractIr,
      '--project-root', root,
      '--release',
      '--report', receipt,
      '--quiet',
    ], root);
    assert.equal(release.status, 2, release.stderr);
    const stopped = JSON.parse(await readFile(receipt, 'utf8'));
    assert.equal(stopped.status, 'stopped_for_evaluation');
    assert.ok(stopped.findings.some((item) => item.ruleId === 'legal-rollout-release-not-approved'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legal CLI rejects invalid options without rewriting its evidence inputs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-legal-usage-'));
  const evidence = join(root, 'evidence.json');
  const receipt = join(root, 'receipt.json');
  const original = '{"sentinel":"input evidence must remain intact"}\n';
  await writeFile(evidence, original);
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const option of [
    '--min-external=-1', '--min-internal=1.5',
    '--min-external=9007199254740993', '--release=perhaps', '--unknown-legal-option=1',
  ]) {
    const result = run([
      'legal-rollout', '--manifest', evidence, '--parity-report', evidence,
      '--contract-ir', evidence, '--typespec', typespec, '--schema', schema,
      '--project-root', root, '--report', receipt, option, '--quiet',
    ], root);
    assert.equal(result.status, 3, `${option}: ${result.stderr}`);
    assert.equal(await readFile(evidence, 'utf8'), original);
    await assert.rejects(readFile(receipt), { code: 'ENOENT' });
  }
});
