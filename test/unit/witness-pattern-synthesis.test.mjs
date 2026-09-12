import assert from 'node:assert/strict';
import test from 'node:test';
import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import { synthesizeInstance } from '../../src/witness.mjs';

const schema = {
  type: 'object',
  required: ['service', 'contractSha256'],
  properties: {
    service: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '^[A-Za-z][A-Za-z0-9._-]*$',
    },
    contractSha256: {
      type: 'string',
      pattern: '^[0-9a-f]{64}$',
    },
  },
  unevaluatedProperties: false,
};

test('common anchored character-class patterns synthesize valid deterministic witnesses', () => {
  const resolver = new SchemaResolver();
  const record = resolver.addDocument(schema, 'pattern-witness.json');
  const synthesized = synthesizeInstance({
    schema,
    base: record.base,
    resolver,
    mode: 'full',
  });
  assert.equal(synthesized.complete, true);
  assert.match(synthesized.instance.service, /^[A-Za-z][A-Za-z0-9._-]*$/u);
  assert.equal(synthesized.instance.service, 'A');
  assert.match(synthesized.instance.contractSha256, /^[0-9a-f]{64}$/u);
  assert.equal(synthesized.instance.contractSha256, '0'.repeat(64));
  const verdict = validateInstance({
    schema,
    instance: synthesized.instance,
    resolver,
    base: record.base,
  });
  assert.equal(verdict.valid, true, JSON.stringify(verdict.errors));
});
