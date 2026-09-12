import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const actionPath = resolve(root, 'legal-rollout-action/action.yml');
const action = await readFile(actionPath, 'utf8');

test('legal rollout action compiles peer authorities before admission', () => {
  assert.match(action, /node "\$cli" check/u);
  assert.match(action, /--contract-ir "\$contract_ir"/u);
  assert.match(action, /node "\$cli" "\$\{legal_args\[@\]\}"/u);
  assert.match(action, /--parity-report "\$parity_report"/u);
  assert.match(action, /--project-root "\$project_root"/u);
});

test('legal rollout action exposes receipt and Contract IR evidence', () => {
  assert.match(action, /^outputs:/mu);
  assert.match(action, /printf 'receipt=%s\\n'/u);
  assert.match(action, /printf 'parity_report=%s\\n'/u);
  assert.match(action, /printf 'contract_ir=%s\\n'/u);
});

test('legal rollout action is shell-safe and validates untrusted scalar inputs', () => {
  assert.doesNotMatch(action, /\beval\b/u);
  assert.match(action, /case "\$INPUT_RELEASE" in/u);
  assert.match(action, /min_external must be a non-negative integer/u);
  assert.match(action, /min_internal must be a non-negative integer/u);
  assert.match(action, /legal_args=\(/u);
});
