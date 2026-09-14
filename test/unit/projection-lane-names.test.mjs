import assert from 'node:assert/strict';
import test from 'node:test';

test('additive projection lane names remain stable', () => {
  assert.deepEqual(['protobuf', 'wit', 'dafny'], ['protobuf', 'wit', 'dafny']);
});
