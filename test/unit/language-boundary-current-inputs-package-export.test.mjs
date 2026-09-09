import assert from 'node:assert/strict';
import test from 'node:test';

test('current-input language boundary verifier is reachable through the public package export', async () => {
  const api = await import('@oresoftware/typespec-json-schema-validator/language-boundary-current-inputs');
  assert.equal(typeof api.verifyLanguageBoundariesAgainstCurrentInputs, 'function');
});
