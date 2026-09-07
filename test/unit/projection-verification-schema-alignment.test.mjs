import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  IDENTIFIER_PATTERN,
  MAX_DECLARATIONS,
  MAX_DELTAS,
  MAX_OUTPUTS,
  MAX_PROJECTIONS,
  MAX_RECEIPT_RULES,
  MAX_RUNTIME_VALIDATORS,
  MAX_TOOLCHAINS,
  MEDIA_TYPE_PATTERN,
} from '../../src/projection-verification/constants.mjs';

async function schema(name) {
  return JSON.parse(await readFile(new URL(`../../schema/${name}`, import.meta.url), 'utf8'));
}

test('projection policy schema publishes runtime grammars and cardinalities exactly', async () => {
  const value = await schema('projection-verification-policy.schema.json');
  assert.equal(value.$defs.identifier.pattern, IDENTIFIER_PATTERN.source);
  assert.equal(value.$defs.output.properties.mediaType.pattern, MEDIA_TYPE_PATTERN.source);
  assert.equal(value.$defs.output.properties.mediaType.maxLength, 255);
  assert.equal(value.$defs.toolchain.properties.version.maxLength, 256);
  assert.equal(value.properties.expectedDeclarations.maxItems, MAX_DECLARATIONS);
  assert.equal(value.properties.toolchains.maxItems, MAX_TOOLCHAINS);
  assert.equal(value.properties.requiredProjections.maxItems, MAX_PROJECTIONS);
  assert.equal(value.properties.outputs.maxItems, MAX_OUTPUTS);
  assert.equal(value.properties.approvedDeltas.maxItems, MAX_DELTAS);
  assert.equal(value.properties.runtimeValidators.maxItems, MAX_RUNTIME_VALIDATORS);
});

test('projection receipt schema publishes the runtime finding grammar and bound exactly', async () => {
  const value = await schema('projection-verification-receipt.schema.json');
  assert.equal(value.$defs.identifier.pattern, IDENTIFIER_PATTERN.source);
  assert.equal(value.properties.findingRuleIds.maxItems, MAX_RECEIPT_RULES);
});

test('published path grammar accepts single-segment paths and rejects runtime refusal examples', async () => {
  const value = await schema('projection-verification-policy.schema.json');
  const pattern = new RegExp(value.$defs.relativePath.pattern, 'u');
  const accepted = ['operations/api-ir.json', 'generated/protobuf/accounts.proto', 'a'];
  const rejected = [
    '',
    '/absolute/path',
    './relative/path',
    '../escape',
    'nested/../escape',
    'nested/./file',
    'double//separator',
    'windows\\path',
    'trailing/',
  ];
  for (const candidate of accepted) assert.equal(pattern.test(candidate), true, candidate);
  for (const candidate of rejected) assert.equal(pattern.test(candidate), false, candidate);
});
