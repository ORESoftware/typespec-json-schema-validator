import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

test('truthy runtime validation fields do not equal passed evidence', () => {
  const target = { language: 'rust', runtime: 'native', required: true, ingress: true, egress: true, evidence: 'rust/native.json' };
  const result = verifyLanguageBoundaries({
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1', minimumDistinctLanguages: 2,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets: [target, { ...target, language: 'go', evidence: 'go/native.json' }],
    },
    evidenceByPath: new Map([['rust/native.json', {
      schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1', language: 'rust', runtime: 'native', status: 'passed',
      sourceRevision: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}`,
      toolchain: { name: 'rustc', version: '1' }, generator: { name: 'api-docs', version: '1' }, validation: { ingress: true, egress: 1 },
    }]]),
  });
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-ingress-not-verified'));
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-egress-not-verified'));
});
