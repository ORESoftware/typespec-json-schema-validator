import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const action = await readFile(
  new URL('../../actions/verify-contract-ir/action.yml', import.meta.url),
  'utf8',
);

test('consumer verification action is composite and lockfile-pinned', () => {
  assert.match(action, /runs:\n  using: composite/);
  assert.match(action, /working-directory: \$\{\{ github\.action_path \}\}\/\.\.\/\.\./);
  assert.match(action, /npm ci --omit=dev/);
  assert.doesNotMatch(action, /npm install\b/);
  assert.doesNotMatch(action, /\beval\b/);
});

test('consumer action requires the complete admission chain and scope', () => {
  for (const input of [
    'contract_ir',
    'report',
    'typespec',
    'generated_schema',
    'schema',
    'expected_declarations',
  ]) {
    assert.match(action, new RegExp(`\\n  ${input}:[\\s\\S]*?required: true`));
  }
  assert.match(action, /TSJSV_VERIFY_IR/);
  assert.match(action, /TSJSV_VERIFY_REPORT/);
  assert.match(action, /TSJSV_VERIFY_TYPESPEC/);
  assert.match(action, /TSJSV_VERIFY_GENERATED/);
  assert.match(action, /TSJSV_VERIFY_AUTHORED/);
  assert.match(action, /TSJSV_VERIFY_DECLARATIONS/);
});

test('consumer action publishes separate deterministic evidence', () => {
  assert.match(action, /verification:/);
  assert.match(action, /consumer-verification\.json/);
  assert.match(action, /TSJSV_VERIFY_VERIFICATION/);
  assert.match(action, /scripts\/verify-consumer\.mjs/);
  assert.doesNotMatch(action, /\bcp\b/);
  assert.doesNotMatch(action, /checkout@/);
  assert.doesNotMatch(action, /curl|wget/);
});
