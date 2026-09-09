import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

test('optional evidence is validated when supplied but may remain absent', () => {
  const result = verifyLanguageBoundaries({
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 2,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets: [
        { language: 'rust', runtime: 'native', required: true, ingress: true, egress: true, evidence: 'rust/native.json' },
        { language: 'go', runtime: 'native', required: true, ingress: true, egress: true, evidence: 'go/native.json' },
        { language: 'dart', runtime: 'flutter', required: false, ingress: true, egress: true, evidence: 'dart/flutter.json' },
      ],
    },
    evidenceByPath: new Map([['dart/flutter.json', { schema: 'unknown' }]]),
  });
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-evidence-schema-invalid'));
});
