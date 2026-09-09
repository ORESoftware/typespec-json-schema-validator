import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

test('blank and whitespace-padded target identities stop admission', () => {
  const result = verifyLanguageBoundaries({
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 2,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets: [
        { language: ' rust ', runtime: '', required: true, ingress: true, egress: true, evidence: 'rust/native.json' },
        { language: 'go', runtime: 'native', required: true, ingress: true, egress: true, evidence: 'go/native.json' },
      ],
    },
  });
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-target-identity-invalid'));
});
