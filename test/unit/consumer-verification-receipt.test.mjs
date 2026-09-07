import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  CONSUMER_VERIFICATION_RECEIPT_SCHEMA,
  createConsumerVerificationReceipt,
  failedConsumerVerificationReceipt,
  writeConsumerVerificationReceipt,
} from '../../src/consumer-verification-receipt.mjs';

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
    declarationIds: ['Example.User', 'Example.Role'],
    error: null,
  };
}

test('consumer verification receipts are deterministic, scope-bound, and self-digesting', () => {
  const first = createConsumerVerificationReceipt(passedResult());
  const second = createConsumerVerificationReceipt(passedResult());
  assert.equal(first.schema, CONSUMER_VERIFICATION_RECEIPT_SCHEMA);
  assert.equal(first.status, 'passed');
  assert.equal(first.admissible, true);
  assert.equal(first.failureCode, null);
  assert.deepEqual(first.declarationIds, ['Example.Role', 'Example.User']);
  assert.equal(canonicalStringify(first), canonicalStringify(second));
  const body = { ...first };
  delete body.verificationId;
  assert.equal(first.verificationId, sha256(canonicalStringify(body)));
});

test('durable receipt schema is distinct from the transient canonical verifier result', () => {
  const receipt = createConsumerVerificationReceipt(passedResult());
  assert.notEqual(
    receipt.schema,
    'ores.typespec-json-schema-validator.contract-ir-verification/v1',
  );
});

test('missing or inconsistent identifiers and scope cannot become passed evidence', () => {
  for (const mutate of [
    (value) => { value.declarationIds = []; },
    (value) => { value.suppliedIrId = 'not-a-digest'; },
    (value) => { value.computedIrId = hex('c'); },
    (value) => { value.expectedIrId = null; },
    (value) => { value.receiptRunId = null; },
    (value) => { value.status = 'failed'; },
  ]) {
    const result = passedResult();
    mutate(result);
    const receipt = createConsumerVerificationReceipt(result);
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.admissible, false);
    assert.equal(receipt.failureCode, 'consumer-verification-failed');
  }
});

test('failure receipts contain bounded codes rather than exception text', () => {
  const receipt = failedConsumerVerificationReceipt({
    contractIr: { irId: hex('d'), declarations: [{ id: 'Example.User' }] },
    report: { runId: hex('e') },
    expectedDeclarations: ['Example.User'],
    error: new Error('/private/path secret value'),
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.admissible, false);
  assert.equal(receipt.failureCode, 'consumer-verification-failed');
  assert.equal(receipt.suppliedIrId, hex('d'));
  assert.equal(receipt.receiptRunId, hex('e'));
  assert.equal(JSON.stringify(receipt).includes('/private/path'), false);
  assert.equal(JSON.stringify(receipt).includes('secret value'), false);
});

test('published receipt schema is a closed Draft 2020-12 envelope', async () => {
  const schema = JSON.parse(
    await readFile(
      new URL('../../schema/consumer-verification-receipt.schema.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schema.const, CONSUMER_VERIFICATION_RECEIPT_SCHEMA);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('verificationId'));
  assert.ok(schema.required.includes('declarationIds'));
});

test('safe writer replaces its own evidence but refuses unrelated files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tsjsv-consumer-verification-'));
  const path = join(dir, 'verification.json');
  const passed = createConsumerVerificationReceipt(passedResult());
  await writeConsumerVerificationReceipt(path, passed);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).verificationId, passed.verificationId);

  const failed = failedConsumerVerificationReceipt();
  await writeConsumerVerificationReceipt(path, failed);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).status, 'failed');

  const unrelated = join(dir, 'source.json');
  await writeFile(unrelated, '{"authority":true}\n');
  await assert.rejects(
    writeConsumerVerificationReceipt(unrelated, passed),
    /not validator-owned consumer verification evidence/,
  );
  assert.equal(await readFile(unrelated, 'utf8'), '{"authority":true}\n');
});

test('safe writer refuses symbolic-link destinations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tsjsv-consumer-verification-link-'));
  const target = join(dir, 'target.json');
  const link = join(dir, 'verification.json');
  await writeFile(target, '{}');
  await symlink(target, link);
  await assert.rejects(
    writeConsumerVerificationReceipt(link, createConsumerVerificationReceipt(passedResult())),
    /non-symlink/,
  );
});
