import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  createContractIrVerificationArtifact,
  failedContractIrVerification,
  writeContractIrVerification,
} from '../../src/contract-ir-verification.mjs';

const hex = (character) => character.repeat(64);

function passedResult() {
  return {
    schema: 'ores.typespec-json-schema-validator.contract-ir-verification/v1',
    status: 'passed',
    admissible: true,
    suppliedIrId: hex('a'),
    computedIrId: hex('a'),
    expectedIrId: hex('a'),
    receiptRunId: hex('b'),
    error: null,
  };
}

test('consumer verification evidence is deterministic and self-digesting', () => {
  const first = createContractIrVerificationArtifact(passedResult());
  const second = createContractIrVerificationArtifact(passedResult());
  assert.equal(first.status, 'passed');
  assert.equal(first.admissible, true);
  assert.equal(first.error, null);
  assert.equal(canonicalStringify(first), canonicalStringify(second));
  const body = { ...first };
  delete body.verificationId;
  assert.equal(first.verificationId, sha256(canonicalStringify(body)));
});

test('failed evidence refuses untrusted digest-shaped diagnostics', () => {
  const artifact = createContractIrVerificationArtifact({
    status: 'failed',
    admissible: false,
    suppliedIrId: 'not-a-digest',
    computedIrId: hex('c'),
    expectedIrId: null,
    receiptRunId: 'bad',
    error: null,
  });
  assert.equal(artifact.status, 'failed');
  assert.equal(artifact.admissible, false);
  assert.equal(artifact.suppliedIrId, null);
  assert.equal(artifact.receiptRunId, null);
  assert.equal(artifact.error, 'contract-ir-or-current-evidence-mismatch');
});

test('pre-verifier failures remain deterministic and never admissible', () => {
  const contractIr = { irId: hex('d'), declarations: [] };
  const report = { runId: hex('e') };
  const first = failedContractIrVerification({
    contractIr,
    report,
    error: new Error('Contract IR input is not valid JSON'),
  });
  const second = failedContractIrVerification({
    contractIr,
    report,
    error: new Error('Contract IR input is not valid JSON'),
  });
  assert.equal(first.status, 'failed');
  assert.equal(first.admissible, false);
  assert.equal(first.suppliedIrId, hex('d'));
  assert.equal(first.receiptRunId, hex('e'));
  assert.equal(canonicalStringify(first), canonicalStringify(second));
});

test('published verification schema is a closed Draft 2020-12 envelope', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../schema/contract-ir-verification.schema.json', import.meta.url), 'utf8'),
  );
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(
    schema.properties.schema.const,
    'ores.typespec-json-schema-validator.contract-ir-verification/v1',
  );
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('verificationId'));
});

test('safe writer replaces its own evidence but refuses unrelated files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tsjsv-ir-verification-'));
  const path = join(dir, 'verification.json');
  const passed = createContractIrVerificationArtifact(passedResult());
  await writeContractIrVerification(path, passed);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).verificationId, passed.verificationId);

  const failed = failedContractIrVerification({ error: 'stale input closure' });
  await writeContractIrVerification(path, failed);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).status, 'failed');

  const unrelated = join(dir, 'source.json');
  await writeFile(unrelated, '{"authority":true}\n');
  await assert.rejects(
    writeContractIrVerification(unrelated, passed),
    /not validator-owned Contract IR verification evidence/,
  );
  assert.equal(await readFile(unrelated, 'utf8'), '{"authority":true}\n');
});

test('safe writer refuses symbolic-link destinations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tsjsv-ir-verification-link-'));
  const target = join(dir, 'target.json');
  const link = join(dir, 'verification.json');
  await writeFile(target, '{}');
  await symlink(target, link);
  await assert.rejects(
    writeContractIrVerification(link, createContractIrVerificationArtifact(passedResult())),
    /non-symlink/,
  );
});
