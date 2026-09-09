import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
  verifyLanguageBoundaries,
} from '../../src/language-boundary-verification.mjs';

const runId = 'b'.repeat(64);
const contractIrId = 'c'.repeat(64);
const report = () => ({
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
    summary: { probesEvaluated: 10, divergences: 0, refusals: 0 },
  },
});
const contractIr = () => ({
  schema: 'ores.typespec-json-schema-validator.contract-ir/v1',
  irId: contractIrId,
  status: 'passed',
  admissible: true,
  role: 'downstream-derived-parity-artifact',
  editableAuthority: false,
  declarations: [{ id: 'Domain.Item' }],
  excludedDeclarations: [],
  outOfScopeDeclarations: [],
  admission: { receipt: { runId } },
});
const target = (language, runtime, evidence, required = true) => ({
  language, runtime, evidence, required, ingress: true, egress: true,
});
const evidence = (language, runtime) => ({
  schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
  language,
  runtime,
  status: 'passed',
  sourceRevision: 'a'.repeat(40),
  artifactDigest: `sha256:${'d'.repeat(64)}`,
  contractIrId,
  receiptRunId: runId,
  toolchain: { name: 'node', version: '22.16.0' },
  generator: { name: 'api-docs', version: '1' },
  validation: { ingress: 'passed', egress: 'passed' },
});
const manifest = () => ({
  schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
  minimumDistinctLanguages: 2,
  authorities: {
    typeSpec: 'peer', jsonSchema: 'peer', generatedWitness: 'evidence_only',
  },
  targets: [
    target('rust', 'native', 'rust/native.json'),
    target('go', 'native', 'go/native.json'),
  ],
});

function passed(targets = manifest().targets) {
  return verifyLanguageBoundaries({
    manifest: { ...manifest(), targets },
    report: report(),
    contractIr: contractIr(),
    evidenceByPath: new Map([
      ['rust/native.json', evidence('rust', 'native')],
      ['go/native.json', evidence('go', 'native')],
    ]),
  });
}

test('admits an exact two-language boundary and freezes the receipt', () => {
  const result = passed();
  assert.equal(result.schema, LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA);
  assert.equal(result.status, 'passed');
  assert.equal(result.admissible, true);
  assert.equal(result.counts.findings, 0);
  assert.equal(result.counts.distinctRequiredLanguages, 2);
  assert.match(result.verificationId, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.binding));
  assert.ok(Object.isFrozen(result.counts));
  assert.ok(Object.isFrozen(result.findings));
});

test('target and evidence map ordering do not change the receipt', () => {
  const forward = passed();
  const reverse = verifyLanguageBoundaries({
    manifest: { ...manifest(), targets: [...manifest().targets].reverse() },
    report: report(),
    contractIr: contractIr(),
    evidenceByPath: new Map([
      ['go/native.json', evidence('go', 'native')],
      ['rust/native.json', evidence('rust', 'native')],
    ]),
  });
  assert.equal(reverse.verificationId, forward.verificationId);
});

test('duplicate targets and evidence paths fail closed', () => {
  const first = manifest().targets[0];
  const result = verifyLanguageBoundaries({
    manifest: { ...manifest(), targets: [first, { ...first }] },
  });
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'boundary-target-duplicate'));
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'boundary-evidence-path-duplicate'));
});

test('sparse target inventories are refused', () => {
  const targets = new Array(2);
  targets[1] = manifest().targets[1];
  const result = verifyLanguageBoundaries({ manifest: { ...manifest(), targets } });
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'boundary-targets-invalid'));
});

test('required languages cannot fall below the explicit minimum', () => {
  const result = verifyLanguageBoundaries({
    manifest: {
      ...manifest(),
      minimumDistinctLanguages: 3,
      targets: manifest().targets,
    },
  });
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'boundary-minimum-languages-not-met'));
});

test('generated evidence never replaces either peer authority', () => {
  const result = verifyLanguageBoundaries({
    manifest: {
      ...manifest(),
      authorities: {
        typeSpec: 'preferred', jsonSchema: 'generated', generatedWitness: 'authority',
      },
    },
  });
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'boundary-authority-roles-invalid'));
});
