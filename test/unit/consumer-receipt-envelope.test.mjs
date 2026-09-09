import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import {
  UnsafeConsumerVerificationReceiptDestinationError,
  writeConsumerVerificationReceiptFile,
} from '../../src/consumer-verification-receipt-file.mjs';

const SCHEMA = 'ores.typespec-json-schema-validator.consumer-verification-receipt/v1';
const scratch = fileURLToPath(new URL('../../tmp/', import.meta.url));

function envelope(overrides = {}) {
  const body = {
    schema: SCHEMA,
    status: 'passed',
    admissible: true,
    suppliedIrId: 'a'.repeat(64),
    computedIrId: 'a'.repeat(64),
    expectedIrId: 'a'.repeat(64),
    receiptRunId: 'b'.repeat(64),
    declarationIds: ['Example.User'],
    failureCode: null,
    ...overrides,
  };
  delete body.verificationId;
  return { ...body, verificationId: sha256(canonicalStringify(body)) };
}

function serialized(value) {
  return `${canonicalStringify(value, 2)}\n`;
}

async function destination() {
  await mkdir(scratch, { recursive: true });
  // Retain only synthetic fixtures under ignored tmp/ for failed-test diagnosis.
  return join(await mkdtemp(join(scratch, 'receipt-envelope-')), 'receipt.json');
}

const invalidEnvelopes = [
  ['unknown property', () => envelope({ operatorNotes: 'independently authored content' })],
  ['prototype-sensitive own property', () => envelope(JSON.parse('{"__proto__":{"keep":true}}'))],
  ['513 ASCII characters', () => envelope({ declarationIds: ['A'.repeat(513)] })],
  ['513 supplementary Unicode characters', () => envelope({ declarationIds: ['\u{1f680}'.repeat(513)] })],
  ['unknown property on failed evidence', () => envelope({
    status: 'failed', admissible: false, failureCode: 'consumer-verification-failed', notes: 'keep',
  })],
  ['overlong identity on failed evidence', () => envelope({
    status: 'failed', admissible: false, failureCode: 'consumer-verification-failed',
    declarationIds: ['A'.repeat(513)],
  })],
];

for (const [label, make] of invalidEnvelopes) {
  test(`refuse new receipt with ${label}, even with a valid self-digest`, async () => {
    const path = await destination();
    await assert.rejects(writeConsumerVerificationReceiptFile(path, serialized(make()), SCHEMA), TypeError);
    await assert.rejects(lstat(path), { code: 'ENOENT' });
    assert.deepEqual(await readdir(dirname(path)), []);
  });

  test(`preserve existing receipt-shaped document with ${label} byte-for-byte`, async () => {
    const path = await destination();
    const original = serialized(make());
    await writeFile(path, original);
    await assert.rejects(
      writeConsumerVerificationReceiptFile(path, serialized(envelope()), SCHEMA),
      UnsafeConsumerVerificationReceiptDestinationError,
    );
    assert.equal(await readFile(path, 'utf8'), original);
    assert.deepEqual(await readdir(dirname(path)), ['receipt.json']);
  });
}

for (const [label, identity] of [
  ['512 ASCII characters', 'A'.repeat(512)],
  ['512 supplementary Unicode characters', '\u{1f680}'.repeat(512)],
  ['512 decomposed Unicode code points', 'e\u0301'.repeat(256)],
]) {
  test(`accept and replace valid receipts with ${label}`, async () => {
    const path = await destination();
    const value = serialized(envelope({ declarationIds: [identity] }));
    await writeConsumerVerificationReceiptFile(path, value, SCHEMA);
    assert.equal(await readFile(path, 'utf8'), value);
    await writeConsumerVerificationReceiptFile(path, value, SCHEMA);
    assert.equal(await readFile(path, 'utf8'), value);
  });
}

test('every recognized envelope field remains mandatory', async () => {
  const path = await destination();
  for (const key of Object.keys(envelope())) {
    const value = envelope();
    delete value[key];
    // Rehash the incomplete body where possible; omission must not be hidden by digest failure.
    if (key !== 'verificationId') {
      delete value.verificationId;
      value.verificationId = sha256(canonicalStringify(value));
    }
    await assert.rejects(writeConsumerVerificationReceiptFile(path, serialized(value), SCHEMA), TypeError, key);
  }
  await assert.rejects(lstat(path), { code: 'ENOENT' });
});

test('failed and passed evidence can still replace each other', async () => {
  const path = await destination();
  const passed = serialized(envelope());
  const failed = serialized(envelope({
    status: 'failed', admissible: false, suppliedIrId: null, computedIrId: null,
    expectedIrId: null, receiptRunId: null, declarationIds: [], failureCode: 'consumer-verification-failed',
  }));
  for (const text of [passed, failed, passed]) {
    await writeConsumerVerificationReceiptFile(path, text, SCHEMA);
    assert.equal(await readFile(path, 'utf8'), text);
  }
});

test('invalid new evidence cannot overwrite an existing valid receipt', async () => {
  const path = await destination();
  const original = serialized(envelope());
  await writeFile(path, original);
  await assert.rejects(
    writeConsumerVerificationReceiptFile(path, serialized(envelope({ extra: true })), SCHEMA), TypeError,
  );
  assert.equal(await readFile(path, 'utf8'), original);
});

test('symbolic links and hard links are still refused without changing their targets', async () => {
  const path = await destination();
  const original = serialized(envelope());
  await writeFile(path, original);
  const symbolic = `${path}.symlink`;
  const hard = `${path}.hardlink`;
  // Windows uses file symlink semantics; hosts without symlink privileges must report failure.
  await symlink(path, symbolic, 'file');
  await assert.rejects(
    writeConsumerVerificationReceiptFile(symbolic, original, SCHEMA),
    UnsafeConsumerVerificationReceiptDestinationError,
  );
  await link(path, hard);
  await assert.rejects(
    writeConsumerVerificationReceiptFile(path, original, SCHEMA),
    UnsafeConsumerVerificationReceiptDestinationError,
  );
  assert.equal(await readFile(path, 'utf8'), original);
  assert.equal(await readFile(hard, 'utf8'), original);
});
