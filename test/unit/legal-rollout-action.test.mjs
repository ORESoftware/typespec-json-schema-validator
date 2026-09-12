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
  assert.match(action, /receipt=\%s/u);
  assert.match(action, /parity_report=\%s/u);
  assert.match(action, /contract_ir=\%s/u);
});

test('legal rollout action is shell-safe and validates untrusted scalar inputs', () => {
  assert.doesNotMatch(action, /\beval\b/u);
  assert.match(action, /case "\$INPUT_RELEASE" in/u);
  assert.match(action, /INPUT_MIN_EXTERNAL.*\^\(0\|\[1-9\]\[0-9\]\*\)\$/su);
  assert.match(action, /legal_args=\(/u);
});
