import assert from 'node:assert/strict';
import test from 'node:test';
import { ADDITIVE_PROJECTION_IDS } from '../../src/projection-admission/index.mjs';

test('additive projection lane names remain stable', () => {
  assert.deepEqual(ADDITIVE_PROJECTION_IDS, ['protobuf', 'wit', 'dafny']);
  assert.equal(Object.isFrozen(ADDITIVE_PROJECTION_IDS), true);
});
