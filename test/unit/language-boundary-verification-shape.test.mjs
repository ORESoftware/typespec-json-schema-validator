import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

test('verification receipt always carries versioned status, binding, counts, findings, and digest', () => {
  const result = verifyLanguageBoundaries();
  assert.equal(result.schema, 'ores.typespec-json-schema-validator.language-boundary-verification/v1');
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(typeof result.binding, 'object');
  assert.equal(result.counts.findings, result.findings.length);
  assert.match(result.verificationId, /^sha256:[0-9a-f]{64}$/);
});
