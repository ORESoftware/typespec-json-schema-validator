import assert from 'node:assert/strict';
import test from 'node:test';

test('language boundary verifier is reachable through the public package export', async () => {
  const api = await import('@oresoftware/typespec-json-schema-validator/language-boundary-verification');
  assert.equal(typeof api.verifyLanguageBoundaries, 'function');
  assert.equal(
    api.LANGUAGE_BOUNDARY_MANIFEST_SCHEMA,
    'ores.typespec-json-schema-validator.language-boundaries/v1',
  );
  assert.equal(
    api.LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA,
    'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
  );
  assert.equal(
    api.LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
    'ores.typespec-json-schema-validator.language-boundary-verification/v1',
  );
});
