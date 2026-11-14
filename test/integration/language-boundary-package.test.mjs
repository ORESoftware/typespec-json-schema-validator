import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANGUAGE_BOUNDARY_MANIFEST_SCHEMA,
  verifyLanguageBoundaries,
} from '@oresoftware/typespec-json-schema-validator/language-boundary-verification';

test('public package subpath exposes the fail-closed language-boundary verifier', () => {
  assert.equal(
    LANGUAGE_BOUNDARY_MANIFEST_SCHEMA,
    'ores.typespec-json-schema-validator.language-boundaries/v1',
  );
  const result = verifyLanguageBoundaries();
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.schema, 'ores.typespec-json-schema-validator.language-boundary-verification/v1');
  assert.ok(Object.isFrozen(result));
});
