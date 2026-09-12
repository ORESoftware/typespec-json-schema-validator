import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  LEGAL_APPROVED_BANNER,
  LEGAL_DRAFT_BANNER,
  LEGAL_ROLLOUT_MANIFEST_SCHEMA,
  auditLegalRollout,
  parseStrictJson,
} from '../../src/legal-rollout/index.mjs';
import { sha256 } from '../../src/canonical.mjs';

function documentText(classification, title, banner = LEGAL_DRAFT_BANNER) {
  const label = classification[0].toUpperCase() + classification.slice(1);
  return `# ${title}\n\n> **${banner}**\n>\n> Counsel must approve and localize this blank template before use.\n\n**Classification:** ${label} — agreement template\n\n**Template version:** [VERSION]\n\n**Provider initials:** ________  **Counterparty initials:** ________\n\n## Terms\n\n[COUNSEL TO COMPLETE MATERIAL TERMS]\n\n## Signatures\n\nBy: ______________________________  Date: ____________________\n\nName: [SIGNER NAME]\n\nTitle/Capacity: [SIGNER CAPACITY]\n\nInitials: ________\n\n**Executed-copy location:** [APPROVED RECORDS SYSTEM — NEVER GIT]\n`;
}

async function corpus({ approved = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-legal-'));
  await mkdir(join(root, 'docs/legal/external'), { recursive: true });
  await mkdir(join(root, 'docs/legal/internal'), { recursive: true });
  const documents = [];
  for (const [classification, count] of [['external', 5], ['internal', 3]]) {
    for (let index = 1; index <= count; index += 1) {
      const id = `${classification}-${index}`;
      const path = `docs/legal/${classification}/${id}.md`;
      const text = documentText(
        classification,
        `${classification} agreement ${index}`,
        approved ? LEGAL_APPROVED_BANNER : LEGAL_DRAFT_BANNER,
      );
      await writeFile(join(root, path), text, 'utf8');
      documents.push({
        id,
        path,
        classification,
        agreementType: `${classification}-agreement-${index}`,
        sha256: sha256(Buffer.from(text)),
        status: approved ? 'approved' : 'draft',
        required: true,
        ...(approved ? {
          effectiveDate: '2026-09-06',
          approvalRecord: `LEGAL-APPROVAL-${classification}-${index}`,
        } : {}),
      });
    }
  }
  const manifest = {
    schema: LEGAL_ROLLOUT_MANIFEST_SCHEMA,
    repository: 'example/legal-docs',
    legalRoot: 'docs/legal',
    releaseApproved: approved,
    documents,
  };
  return { root, manifest };
}

async function withCorpus(options, callback) {
  const fixture = await corpus(options);
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

test('strict JSON parsing rejects duplicate object keys', () => {
  assert.throws(
    () => parseStrictJson('{"schema":"one","schema":"two"}', 'manifest'),
    /duplicate JSON object key/u,
  );
});

test('draft legal corpus passes integrity admission with five external and three internal types', async () => {
  await withCorpus({}, async ({ root, manifest }) => {
    const result = await auditLegalRollout({ manifest, projectRoot: root });
    assert.deepEqual(result.findings, []);
    assert.equal(result.coverage.documents, 8);
    assert.equal(result.coverage.externalAgreementTypes, 5);
    assert.equal(result.coverage.internalAgreementTypes, 3);
    assert.equal(result.coverage.completeInventory, true);
  });
});

test('tampered legal document produces a digest mismatch without exposing document text', async () => {
  await withCorpus({}, async ({ root, manifest }) => {
    const target = join(root, manifest.documents[0].path);
    const original = await readFile(target, 'utf8');
    await writeFile(target, `${original}\nunauthorized edit\n`, 'utf8');
    const result = await auditLegalRollout({ manifest, projectRoot: root });
    const finding = result.findings.find((item) => item.ruleId === 'legal-document-digest-mismatch');
    assert.ok(finding);
    assert.equal(finding.path, manifest.documents[0].path);
    assert.doesNotMatch(JSON.stringify(finding), /unauthorized edit/u);
  });
});

test('unmanifested Markdown evidence is rejected', async () => {
  await withCorpus({}, async ({ root, manifest }) => {
    const path = 'docs/legal/external/untracked.md';
    await writeFile(join(root, path), documentText('external', 'untracked'), 'utf8');
    const result = await auditLegalRollout({ manifest, projectRoot: root });
    assert.ok(result.findings.some((item) =>
      item.ruleId === 'legal-rollout-unmanifested-document' && item.path === path));
    assert.equal(result.coverage.completeInventory, false);
  });
});

test('release mode rejects draft documents and an unapproved aggregate manifest', async () => {
  await withCorpus({}, async ({ root, manifest }) => {
    const result = await auditLegalRollout({ manifest, projectRoot: root, release: true });
    assert.ok(result.findings.some((item) => item.ruleId === 'legal-rollout-release-not-approved'));
    assert.equal(
      result.findings.filter((item) => item.ruleId === 'legal-document-release-status').length,
      8,
    );
  });
});

test('release mode admits explicitly approved templates with immutable approval references', async () => {
  await withCorpus({ approved: true }, async ({ root, manifest }) => {
    const result = await auditLegalRollout({ manifest, projectRoot: root, release: true });
    assert.deepEqual(result.findings, []);
    assert.equal(result.coverage.completeInventory, true);
  });
});

test('classification folder and body marker must agree with the manifest', async () => {
  await withCorpus({}, async ({ root, manifest }) => {
    manifest.documents[0].classification = 'internal';
    const result = await auditLegalRollout({ manifest, projectRoot: root });
    assert.ok(result.findings.some((item) => item.ruleId === 'legal-manifest-document-boundary'));
  });
});
