import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

const target = (runtime, required) => ({
  language: 'oreslang',
  runtime,
  required,
  ingress: true,
  egress: true,
  evidence: `oreslang/${runtime}.json`,
});

function candidate() {
  return verifyLanguageBoundaries({
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 2,
      authorities: {
        typeSpec: 'peer',
        jsonSchema: 'peer',
        generatedWitness: 'evidence_only',
      },
      targets: [
        { language: 'rust', runtime: 'native', required: true, ingress: true,
          egress: true, evidence: 'rust/native.json' },
        target('graalvm-jvm', true),
        target('javascript-browser', false),
        target('wasm-browser', false),
      ],
    },
    evidenceByPath: new Map(),
  });
}

test('Oreslang JVM counts as a language but cannot pass without runtime evidence', () => {
  const result = candidate();
  assert.equal(result.counts.requiredTargets, 2);
  assert.equal(result.counts.distinctRequiredLanguages, 2);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some(f => f.ruleId === 'boundary-required-evidence-missing'
    && f.pointer.endsWith('/1/evidence')));
});

test('future Oreslang browser targets remain optional and cannot fake native coverage', () => {
  const result = candidate();
  assert.equal(result.counts.requiredTargets, 2);
  assert.equal(result.findings.some(f => f.ruleId === 'boundary-required-evidence-missing'
    && (f.pointer.endsWith('/2/evidence') || f.pointer.endsWith('/3/evidence'))), false);
});
