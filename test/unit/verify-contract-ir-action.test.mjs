import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const action = await readFile(
  new URL('../../verify-contract-ir/action.yml', import.meta.url),
  'utf8',
);

test('consumer verification action is composite and lockfile-pinned', () => {
  assert.match(action, /runs:\n  using: composite/);
  assert.match(action, /working-directory: \$\{\{ github\.action_path \}\}\/\.\./);
  assert.match(action, /npm ci --omit=dev/);
  assert.doesNotMatch(action, /npm install\b/);
  assert.doesNotMatch(action, /\beval\b/);
});

test('consumer verification action requires the complete admission chain', () => {
  for (const input of [
    'contract_ir',
    'parity_receipt',
    'typespec',
    'generated_schema',
    'schema',
  ]) {
    assert.match(action, new RegExp(`\\n  ${input}:[\\s\\S]*?required: true`));
  }
  assert.match(action, /verify-ir/);
  assert.match(action, /--contract-ir=\$\{TSJSV_CONTRACT_IR_INPUT\}/);
  assert.match(action, /--parity-receipt=\$\{TSJSV_PARITY_RECEIPT_INPUT\}/);
  assert.match(action, /--typespec=\$\{TSJSV_TYPESPEC_INPUT\}/);
  assert.match(action, /--generated-schema=\$\{TSJSV_GENERATED_SCHEMA_INPUT\}/);
  assert.match(action, /--schema=\$\{TSJSV_SCHEMA_INPUT\}/);
});

test('consumer verification action writes separate evidence and never copies authorities', () => {
  assert.match(action, /--verification=\$\{TSJSV_VERIFICATION_INPUT\}/);
  assert.match(action, /contract-ir-verification\.json/);
  assert.doesNotMatch(action, /\bcp\b/);
  assert.doesNotMatch(action, /checkout@/);
  assert.doesNotMatch(action, /curl|wget/);
});
