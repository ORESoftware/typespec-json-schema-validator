import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANGUAGE_BOUNDARY_MANIFEST_SCHEMA,
  verifyLanguageBoundaries,
} from '@oresoftware/typespec-json-schema-validator/language-boundary-verification';

test('published subpath exposes the immutable language-boundary verifier', () => {
  assert.equal(
    LANGUAGE_BOUNDARY_MANIFEST_SCHEMA,
    'ores.typespec-json-schema-validator.language-boundaries/v1',
  );
  const result = verifyLanguageBoundaries();
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(Object.isFrozen(result));
});
