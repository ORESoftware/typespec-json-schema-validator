import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

test('blank generator and toolchain identities stop evidence admission', () => {
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
      toolchain: { name: ' ', version: '' }, generator: { name: '', version: ' ' }, validation: { ingress: 'passed', egress: 'passed' },
    }]]),
  });
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-toolchain-identity-missing'));
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-generator-identity-missing'));
});
