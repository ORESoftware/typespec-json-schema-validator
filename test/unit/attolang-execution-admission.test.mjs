import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

const sha = 'a'.repeat(40);
const execution = Object.freeze({
  sourceExtension: '.atto', backend: 'llvm',
  compilerRevision: sha, runnerRevision: 'b'.repeat(40),
  exactHead: true, guestExecuted: true, executedSteps: 7,
  negativeCasesPassed: true,
});
const target = {
  language: 'attolang', runtime: 'llvm', required: true,
  ingress: true, egress: true, evidence: 'attolang/llvm.json',
};
const evidence = {
  schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
  language: 'attolang', runtime: 'llvm', status: 'passed',
  sourceRevision: sha, artifactDigest: `sha256:${'c'.repeat(64)}`,
  receiptRunId: 'd'.repeat(64), contractIrId: 'e'.repeat(64),
  toolchain: { name: 'atto-compiler', version: '1' },
  generator: { name: 'ato-test', version: '1' },
  validation: { ingress: 'passed', egress: 'passed' },
  execution,
};
function findings(value) {
  return verifyLanguageBoundaries({
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 2,
      authorities: { typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only' },
      targets: [target, { language: 'rust', runtime: 'native', required: true, ingress: true, egress: true, evidence: 'rust/native.json' }],
    },
    evidenceByPath: new Map([[target.evidence, value]]),
  }).findings;
}
const hasGuestMissing = value => findings(value).some(x => x.ruleId === 'boundary-attolang-guest-execution-missing');

test('AttoLang candidate requires a declared guest execution envelope, not merely passing host parity', () => {
  assert.equal(hasGuestMissing(evidence), false);
  assert.equal(hasGuestMissing({ ...evidence, execution: undefined }), true);
  assert.equal(hasGuestMissing({ ...evidence, execution: {} }), true);
});
test('AttoLang rejects forged/non-executed metadata and stale or mismatched backend', () => {
  for (const [field, value] of [
    ['sourceExtension', '.ores'],
    ['backend', 'java'],
    ['compilerRevision', 'latest'],
    ['runnerRevision', '0'.repeat(39)],
    ['exactHead', false],
    ['guestExecuted', false],
    ['executedSteps', 0],
    ['executedSteps', -1],
    ['executedSteps', 1.5],
    ['negativeCasesPassed', false],
  ]) {
    assert.equal(hasGuestMissing({ ...evidence, execution: { ...execution, [field]: value } }), true, field);
  }
  assert.equal(hasGuestMissing({ ...evidence, execution: { ...execution, fabricated: true } }), true);
});
test('AttoLang envelope is not a substitute for a valid runtime evidence status', () => {
  assert.ok(findings({ ...evidence, status: 'failed' }).some(x => x.ruleId === 'boundary-evidence-not-passed'));
});
