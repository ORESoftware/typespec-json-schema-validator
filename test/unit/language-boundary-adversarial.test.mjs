import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
  verifyLanguageBoundaries,
} from '../../src/language-boundary-verification.mjs';

const runId = 'b'.repeat(64);
const irId = 'c'.repeat(64);

function report() {
  return {
    schema: 'ores.typespec-json-schema-validator.report/v1',
    runId,
    status: 'passed',
    zeroUnexplainedFindings: true,
    findings: [],
    authorities: {
      typespec: {
        authority: 'independently-authored',
        generatedJsonSchemaRole: 'comparison-evidence-only',
      },
      jsonSchema: { authority: 'independently-authored' },
      precedence: 'none',
    },
    coverage: { differentialInstanceValidation: true },
    differential: {
      summary: { probesEvaluated: 12, divergences: 0, refusals: 0 },
    },
  };
}

function contractIr() {
  return {
    schema: 'ores.typespec-json-schema-validator.contract-ir/v1',
    irId,
    status: 'passed',
    admissible: true,
    role: 'downstream-derived-parity-artifact',
    editableAuthority: false,
    declarations: [{ id: 'Domain.Item' }],
    excludedDeclarations: [],
    outOfScopeDeclarations: [],
    admission: { receipt: { runId } },
  };
}

function target(overrides = {}) {
  return {
    language: 'rust',
    runtime: 'native',
    required: true,
    ingress: true,
    egress: true,
    evidence: 'rust/native.json',
    ...overrides,
  };
}

function manifest(targets = [target(), target({ language: 'go', evidence: 'go/native.json' })]) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
    minimumDistinctLanguages: 2,
    authorities: {
      typeSpec: 'peer',
      jsonSchema: 'peer',
      generatedWitness: 'evidence_only',
    },
    targets,
  };
}

function evidence(overrides = {}) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language: 'rust',
    runtime: 'native',
    status: 'passed',
    sourceRevision: 'a'.repeat(40),
    artifactDigest: `sha256:${'d'.repeat(64)}`,
    contractIrId: irId,
    receiptRunId: runId,
    toolchain: { name: 'rustc', version: '1.95.0' },
    generator: { name: 'api-docs', version: '1' },
    validation: { ingress: 'passed', egress: 'passed' },
    ...overrides,
  };
}

function verifyWithRustEvidence(value, overrides = {}) {
  return verifyLanguageBoundaries({
    manifest: overrides.manifest ?? manifest(),
    report: overrides.report ?? report(),
    contractIr: overrides.contractIr ?? contractIr(),
    evidenceByPath: new Map([
      ['rust/native.json', value],
      ['go/native.json', evidence({ language: 'go' })],
    ]),
  });
}

function has(result, ruleId) {
  return result.findings.some((entry) => entry.ruleId === ruleId);
}

test('evidence requires exact parity receipt and Contract IR bindings', () => {
  const result = verifyWithRustEvidence(evidence({ contractIrId: 'e'.repeat(64), receiptRunId: 'f'.repeat(64) }));
  assert.ok(has(result, 'boundary-evidence-contract-ir-mismatch'));
  assert.ok(has(result, 'boundary-evidence-receipt-mismatch'));
});

test('uppercase and mutable digest labels are rejected', () => {
  const result = verifyWithRustEvidence(evidence({ artifactDigest: `sha256:${'B'.repeat(64)}` }));
  assert.ok(has(result, 'boundary-artifact-digest-invalid'));
});

test('truthy values cannot replace explicit passed validation evidence', () => {
  const result = verifyWithRustEvidence(evidence({ validation: { ingress: true, egress: 1 } }));
  assert.ok(has(result, 'boundary-ingress-not-verified'));
  assert.ok(has(result, 'boundary-egress-not-verified'));
});

test('prototype-inherited evidence cannot satisfy a required path', () => {
  const inherited = Object.create({ 'rust/native.json': evidence() });
  const result = verifyLanguageBoundaries({
    manifest: manifest(),
    report: report(),
    contractIr: contractIr(),
    evidenceByPath: inherited,
  });
  assert.ok(has(result, 'boundary-evidence-missing'));
});

test('symbolic or abbreviated source revisions are not immutable evidence', () => {
  for (const sourceRevision of ['main', 'abc1234']) {
    const result = verifyWithRustEvidence(evidence({ sourceRevision }));
    assert.ok(has(result, 'boundary-source-revision-invalid'), sourceRevision);
  }
});

test('missing or failed evidence status never becomes an implicit pass', () => {
  const missingStatus = evidence();
  delete missingStatus.status;
  assert.ok(has(verifyWithRustEvidence(missingStatus), 'boundary-evidence-not-passed'));
  assert.ok(has(verifyWithRustEvidence(evidence({ status: 'failed' })), 'boundary-evidence-not-passed'));
});

test('evidence for one runtime cannot satisfy another runtime target', () => {
  const result = verifyWithRustEvidence(evidence({ runtime: 'browser' }));
  assert.ok(has(result, 'boundary-evidence-target-mismatch'));
});

test('optional evidence is validated whenever it is supplied', () => {
  const optional = target({ language: 'dart', runtime: 'flutter', required: false, evidence: 'dart/flutter.json' });
  const result = verifyLanguageBoundaries({
    manifest: manifest([...manifest().targets, optional]),
    report: report(),
    contractIr: contractIr(),
    evidenceByPath: new Map([
      ['rust/native.json', evidence()],
      ['go/native.json', evidence({ language: 'go' })],
      ['dart/flutter.json', { schema: 'unknown' }],
    ]),
  });
  assert.ok(has(result, 'boundary-evidence-schema-invalid'));
});

test('absolute, backslash, dot-segment, repeated-separator, and inherited-name paths are refused', () => {
  const invalidPaths = [
    '/tmp/evidence.json',
    'rust\\native.json',
    './rust.json',
    'rust/../native.json',
    'rust//native.json',
    'toString',
  ];
  for (const path of invalidPaths) {
    const result = verifyLanguageBoundaries({
      manifest: manifest([target({ evidence: path }), target({ language: 'go', evidence: 'go/native.json' })]),
    });
    assert.ok(has(result, 'boundary-evidence-path-invalid'), path);
  }
});

test('string booleans cannot replace target booleans', () => {
  const result = verifyLanguageBoundaries({
    manifest: manifest([
      target({ required: 'true', ingress: 'true', egress: 'true' }),
      target({ language: 'go', evidence: 'go/native.json' }),
    ]),
  });
  assert.ok(has(result, 'boundary-target-flags-invalid'));
});

test('required targets cannot disable ingress or egress', () => {
  const result = verifyLanguageBoundaries({
    manifest: manifest([
      target({ ingress: false }),
      target({ language: 'go', evidence: 'go/native.json', egress: false }),
    ]),
  });
  assert.ok(has(result, 'boundary-required-ingress-disabled'));
  assert.ok(has(result, 'boundary-required-egress-disabled'));
});

test('blank and whitespace-padded target identities stop admission', () => {
  const result = verifyLanguageBoundaries({
    manifest: manifest([
      target({ language: ' rust ', runtime: '' }),
      target({ language: 'go', evidence: 'go/native.json' }),
    ]),
  });
  assert.ok(has(result, 'boundary-target-identity-invalid'));
});

test('blank generator and toolchain identities stop admission', () => {
  const result = verifyWithRustEvidence(evidence({
    toolchain: { name: ' ', version: '' },
    generator: { name: '', version: ' ' },
  }));
  assert.ok(has(result, 'boundary-toolchain-identity-missing'));
  assert.ok(has(result, 'boundary-generator-identity-missing'));
});

test('verification always returns a versioned self-digesting receipt', () => {
  const result = verifyLanguageBoundaries();
  assert.equal(result.schema, LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.counts.findings, result.findings.length);
  assert.match(result.verificationId, /^sha256:[0-9a-f]{64}$/u);
});
