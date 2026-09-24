import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSchemaNodeForComparison } from '../../src/canonical.mjs';

const cases = [
  ['EnvironmentValues', '#/$defs/EnvironmentValue', 128, undefined],
  ['SecretEnvironmentSources', '#/$defs/EnvironmentKey', 128, undefined],
  ['Services', '#/$defs/ServiceDocument', 128, 1],
];

for (const [name, ref, maxProperties, minProperties] of cases) {
  test(`${name} accepts TypeSpec Record<T> and authored additionalProperties as comparison-equivalent`, () => {
    const generated = {
      type: 'object',
      ...(minProperties === undefined ? {} : { minProperties }),
      maxProperties,
      properties: {},
      unevaluatedProperties: { $ref: ref },
    };
    const authored = {
      type: 'object',
      ...(minProperties === undefined ? {} : { minProperties }),
      maxProperties,
      additionalProperties: { $ref: ref },
    };
    assert.deepEqual(
      normalizeSchemaNodeForComparison(generated),
      normalizeSchemaNodeForComparison(authored),
    );
  });
}
