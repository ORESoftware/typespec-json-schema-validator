import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import { CONTRACT_IR_SCHEMA, CONTRACT_IR_VERIFICATION_SCHEMA } from '../../src/contract-ir.mjs';
import { compareRuntimeEvidence, RUNTIME_EVIDENCE_SCHEMA } from '../../src/runtime-conformance/index.mjs';

// Synthetic unit fixtures, not claims that a compiler or native adapter ran.
function inputs() {
  const inputDigest = 'a'.repeat(64);
  const corpusDigest = 'b'.repeat(64);
  const body = {
    schema: CONTRACT_IR_SCHEMA, status: 'passed', admissible: true,
    role: 'downstream-derived-parity-artifact', editableAuthority: false,
    authorities: {
      typespec: 'independently-authored', jsonSchema: 'independently-authored',
      generatedJsonSchema: 'comparison-evidence-only', precedence: 'none',
    },
    admission: { receipt: {
      schema: 'ores.typespec-json-schema-validator.report/v1',
      runId: inputDigest, digest: 'c'.repeat(64), status: 'passed', zeroUnexplainedFindings: true,
    } },
    provenance: {
      typespec: { digest: 'd'.repeat(64) },
      generatedJsonSchema: { digest: 'e'.repeat(64) },
      authoredJsonSchema: { digest: 'f'.repeat(64) },
    },
    declarations: [{ id: 'Example.User' }], excludedDeclarations: [], outOfScopeDeclarations: [],
  };
  const contractIr = { ...body, irId: sha256(canonicalStringify(body)) };
  return {
    contractIr,
    contractIrVerification: {
      schema: CONTRACT_IR_VERIFICATION_SCHEMA, status: 'passed', admissible: true,
      suppliedIrId: contractIr.irId, computedIrId: contractIr.irId,
      expectedIrId: contractIr.irId, receiptRunId: inputDigest, error: null,
    },
    expectedInputDigest: inputDigest, expectedCorpusDigest: corpusDigest,
    expectedCases: [{ id: 'user.valid', declaration: 'Example.User', expectation: 'accepted' }],
    requiredAdapters: ['rust-serde'],
    evidence: {
      schema: RUNTIME_EVIDENCE_SCHEMA, contractIrId: contractIr.irId, inputDigest, corpusDigest,
      adapters: [{
        id: 'rust-serde', language: 'rust', runtime: 'rust', validator: 'serde',
        toolchain: 'rustc', status: 'passed',
        results: [{ caseId: 'user.valid', declaration: 'Example.User', verdict: 'accepted' }],
      }],
    },
  };
}

test('exact synthetic evidence still passes the runtime conformance decision', () => {
  const report = compareRuntimeEvidence(inputs());
  assert.equal(report.status, 'passed');
  assert.equal(report.zeroUnexplainedFindings, true);
});

for (const [name, select] of [
  ['evidence', value => value],
  ['adapter', value => value.adapters[0]],
  ['result', value => value.adapters[0].results[0]],
]) {
  test(`${name} envelope drift stops admission even when every verdict matches`, () => {
    const value = inputs();
    select(value.evidence).stdout = 'untrusted-payload-must-not-appear-in-report';
    const report = compareRuntimeEvidence(value);
    assert.equal(report.status, 'stopped_for_evaluation');
    assert.equal(report.zeroUnexplainedFindings, false);
    assert.ok(report.findings.some(finding => finding.ruleId === `runtime-${name}-fields-invalid`));
    assert.ok(!JSON.stringify(report).includes('untrusted-payload-must-not-appear-in-report'));
  });
}
