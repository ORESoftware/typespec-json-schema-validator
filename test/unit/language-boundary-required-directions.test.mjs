import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

test('required targets cannot disable ingress or egress under the default policy', () => {
  const result = verifyLanguageBoundaries({
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 2,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets: [
        { language: 'rust', runtime: 'native', required: true, ingress: false, egress: true, evidence: 'rust/native.json' },
        { language: 'go', runtime: 'native', required: true, ingress: true, egress: false, evidence: 'go/native.json' },
      ],
    },
  });
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-required-ingress-disabled'));
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-required-egress-disabled'));
});
