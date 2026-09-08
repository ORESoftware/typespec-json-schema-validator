import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStringify, sha256 } from '../../src/canonical.mjs';
import { verifyProjectionContract } from '../../src/projection-admission/index.mjs';

const digest = (value) => sha256(String(value));
const digestJson = (value) => sha256(canonicalStringify(value));

function fixture() {
  const sourceDigests = {
    typespec: digest('typespec'),
    generatedJsonSchema: digest('generated'),
    authoredJsonSchema: digest('authored'),
  };
  const parityReceipt = {
    schema: 'ores.typespec-json-schema-validator.report/v1',
    runId: digest('run'),
    status: 'passed',
    zeroUnexplainedFindings: true,
    findings: [],
    coverage: {
      directDeclarationInventory: true,
      typespecGeneratedJsonSchemaComparison: true,
      differentialInstanceValidation: true,
    },
    inputs: {
      typespec: { digest: sourceDigests.typespec },
      generatedJsonSchema: { digest: sourceDigests.generatedJsonSchema },
      authoredJsonSchema: { digest: sourceDigests.authoredJsonSchema },
    },
  };
  const body = {
    schema: 'ores.typespec-json-schema-validator.contract-ir/v1',
    status: 'passed',
    admissible: true,
    role: 'downstream-derived-parity-artifact',
    editableAuthority: false,
    authorities: {
      typespec: 'independently-authored',
      jsonSchema: 'independently-authored',
      generatedJsonSchema: 'comparison-evidence-only',
      precedence: 'none',
    },
    admission: {
      receipt: {
        schema: parityReceipt.schema,
        runId: parityReceipt.runId,
        digest: digestJson(parityReceipt),
        status: 'passed',
        zeroUnexplainedFindings: true,
      },
      requirements: {
        exactInputDigests: true,
        directDeclarationInventory: true,
        generatedSchemaComparison: true,
        differentialInstanceValidation: true,
        zeroUnexplainedFindings: true,
      },
      scope: {
        admittedDeclarations: 0,
        excludedDeclarations: 0,
        outOfScopeDeclarations: 0,
        complete: true,
      },
    },
    provenance: {
      typespec: { role: 'independently-authored-authority', digest: sourceDigests.typespec },
      generatedJsonSchema: { role: 'comparison-evidence-only', digest: sourceDigests.generatedJsonSchema },
      authoredJsonSchema: { role: 'independently-authored-authority', digest: sourceDigests.authoredJsonSchema },
    },
    declarations: [],
    excludedDeclarations: [],
    outOfScopeDeclarations: [],
  };
  return {
    parityReceipt,
    sourceDigests,
    contractIr: { ...body, irId: digestJson(body) },
  };
}

function ruleIds(result) {
  return result.findings.map((finding) => finding.ruleId);
}

test('projection contract verification requires independently observed current source digests', () => {
  const value = fixture();
  const result = verifyProjectionContract({
    contractIr: value.contractIr,
    parityReceipt: value.parityReceipt,
  });

  assert.equal(result.binding, null);
  assert.deepEqual(ruleIds(result), ['projection-current-source-evidence-missing']);
});

test('projection contract verification requires exactly all three source lanes', () => {
  const value = fixture();
  const result = verifyProjectionContract({
    contractIr: value.contractIr,
    parityReceipt: value.parityReceipt,
    expectedSourceDigests: {
      typespec: value.sourceDigests.typespec,
      generatedJsonSchema: value.sourceDigests.generatedJsonSchema,
      extra: digest('extra'),
    },
  });

  assert.equal(result.binding, null);
  assert.ok(ruleIds(result).includes('projection-current-source-closure-invalid'));
  assert.ok(ruleIds(result).includes('projection-current-source-digest-invalid'));
});

test('projection contract verification binds only a complete matching current closure', () => {
  const value = fixture();
  const result = verifyProjectionContract({
    contractIr: value.contractIr,
    parityReceipt: value.parityReceipt,
    expectedSourceDigests: value.sourceDigests,
  });

  assert.equal(result.findings.length, 0);
  assert.equal(result.binding.contractIrId, value.contractIr.irId);
  assert.deepEqual(result.binding.sourceDigests, value.sourceDigests);
});
