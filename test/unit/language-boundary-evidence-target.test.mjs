import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

test('node evidence cannot satisfy a browser target', () => {
  const target = { language: 'typescript', runtime: 'browser', required: true, ingress: true, egress: true, evidence: 'typescript/browser.json' };
  const result = verifyLanguageBoundaries({
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1', minimumDistinctLanguages: 2,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets: [target, { ...target, language: 'rust', runtime: 'native', evidence: 'rust/native.json' }],
    },
    evidenceByPath: new Map([['typescript/browser.json', {
      schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1', language: 'typescript', runtime: 'node', status: 'passed',
      sourceRevision: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}`,
      toolchain: { name: 'node', version: '1' }, generator: { name: 'api-docs', version: '1' }, validation: { ingress: 'passed', egress: 'passed' },
    }]]),
  });
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-evidence-target-mismatch'));
});
