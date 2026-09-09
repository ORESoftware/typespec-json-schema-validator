import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

test('abbreviated and symbolic source revisions are not evidence', () => {
  const result = verifyLanguageBoundaries({
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 2,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets: [
        { language: 'rust', runtime: 'native', required: true, ingress: true, egress: true, evidence: 'rust/native.json' },
        { language: 'go', runtime: 'native', required: true, ingress: true, egress: true, evidence: 'go/native.json' },
      ],
    },
    evidenceByPath: new Map([['rust/native.json', {
      schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
      language: 'rust', runtime: 'native', status: 'passed', sourceRevision: 'main', artifactDigest: `sha256:${'b'.repeat(64)}`,
      toolchain: { name: 'rustc', version: '1' }, generator: { name: 'api-docs', version: '1' }, validation: { ingress: 'passed', egress: 'passed' },
    }]]),
  });
  assert.ok(result.findings.some((entry) => entry.ruleId === 'boundary-source-revision-invalid'));
});
