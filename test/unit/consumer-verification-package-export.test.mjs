import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyConsumerContract } from '@oresoftware/typespec-json-schema-validator/consumer-verification';

test('consumer verification is available through the reviewed package subpath', () => {
  assert.equal(typeof verifyConsumerContract, 'function');
});
