import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

const authorityModel = Object.freeze({
  typeSpec: 'peer',
  jsonSchema: 'peer',
  generatedWitness: 'evidence_only',
});

function target(language, runtime, required = true) {
  return {
    language,
    runtime,
    required,
    ingress: true,
    egress: true,
    evidence: `${language}/${runtime}.json`,
  };
}

function verify(targets, minimumDistinctLanguages = 2) {
  return verifyLanguageBoundaries({
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages,
      authorities: authorityModel,
      targets,
    },
    evidenceByPath: new Map(),
  });
}

test('multiple runtimes of one language do not satisfy a cross-language contract boundary', () => {
  const result = verify([
    target('typescript', 'node'),
    target('typescript', 'browser'),
  ]);

  assert.equal(result.counts.requiredTargets, 2);
  assert.equal(result.counts.distinctRequiredLanguages, 1);
  assert.ok(result.findings.some(
    (finding) => finding.ruleId === 'boundary-required-language-count-insufficient',
  ));
});

test('two required languages satisfy the language-cardinality boundary independent of runtime names', () => {
  const result = verify([
    target('typescript', 'node'),
    target('rust', 'native'),
  ]);

  assert.equal(result.counts.requiredTargets, 2);
  assert.equal(result.counts.distinctRequiredLanguages, 2);
  assert.equal(result.findings.some(
    (finding) => finding.ruleId === 'boundary-required-language-count-insufficient',
  ), false);
});

test('optional language targets cannot satisfy the required cross-language minimum', () => {
  const result = verify([
    target('typescript', 'node'),
    target('rust', 'native', false),
  ]);

  assert.equal(result.counts.requiredTargets, 1);
  assert.equal(result.counts.distinctRequiredLanguages, 1);
  assert.ok(result.findings.some(
    (finding) => finding.ruleId === 'boundary-required-language-count-insufficient',
  ));
});
