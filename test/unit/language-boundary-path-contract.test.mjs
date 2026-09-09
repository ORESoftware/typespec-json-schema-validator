import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

test('absolute, backslash, and dot-segment evidence paths are refused', () => {
  const invalidPaths = ['/tmp/evidence.json', 'rust\\native.json', './rust.json', 'rust/../native.json'];
  for (const evidence of invalidPaths) {
    const result = verifyLanguageBoundaries({
      manifest: {
        schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
        minimumDistinctLanguages: 2,
        authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
        targets: [
          { language: 'rust', runtime: 'native', required: true, ingress: true, egress: true, evidence },
          { language: 'go', runtime: 'native', required: true, ingress: true, egress: true, evidence: 'go/native.json' },
        ],
      },
    });
    assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-evidence-path-invalid'), evidence);
  }
});
