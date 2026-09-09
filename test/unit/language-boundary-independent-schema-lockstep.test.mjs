import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import { verifyLanguageBoundaries } from '../../src/language-boundary-verification.mjs';

const runId = '1'.repeat(64);
const irId = '2'.repeat(64);
const sourceRevision = '3'.repeat(40);
const artifactDigest = `sha256:${'4'.repeat(64)}`;

async function readSchema(name) {
  return JSON.parse(await readFile(new URL(`../../schema/${name}`, import.meta.url), 'utf8'));
}

let validatorsPromise;
async function independentValidators() {
  validatorsPromise ??= (async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const [manifestSchema, evidenceSchema, verificationSchema] = await Promise.all([
      readSchema('language-boundaries.schema.json'),
      readSchema('language-boundary-evidence.schema.json'),
      readSchema('language-boundary-verification.schema.json'),
    ]);
    return {
      manifest: ajv.compile(manifestSchema),
      evidence: ajv.compile(evidenceSchema),
      verification: ajv.compile(verificationSchema),
    };
  })();
  return validatorsPromise;
}

function target(language, runtime, evidence) {
  return {
    language,
    runtime,
    required: true,
    ingress: true,
    egress: true,
    evidence,
  };
}

function evidence(language, runtime) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language,
    runtime,
    status: 'passed',
    sourceRevision,
    artifactDigest,
    receiptRunId: runId,
    contractIrId: irId,
    toolchain: { name: `${language}-${runtime}`, version: '1.0.0' },
    generator: { name: 'api-docs', version: '1.0.0' },
    validation: { ingress: 'passed', egress: 'passed' },
  };
}

function input() {
  const targets = [
    target('rust', 'native', 'rust/native.json'),
    target('typescript', 'node', 'typescript/node.json'),
  ];
  return {
    report: {
      schema: 'ores.typespec-json-schema-validator.report/v1',
      runId,
      status: 'passed',
      zeroUnexplainedFindings: true,
      findings: [],
      coverage: { differentialInstanceValidation: true },
      differential: {
        summary: { probesEvaluated: 12, divergences: 0, refusals: 0 },
      },
    },
    contractIr: {
      schema: 'ores.typespec-json-schema-validator.contract-ir/v1',
      irId,
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
      declarations: [{ id: 'Contract.Item' }],
      excludedDeclarations: [],
      outOfScopeDeclarations: [],
      admission: {
        receipt: { runId },
        requirements: { differentialInstanceValidation: true },
      },
    },
    manifest: {
      schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      minimumDistinctLanguages: 2,
      authorities: {
        typeSpec: 'peer',
        jsonSchema: 'peer',
        generatedWitness: 'evidence_only',
      },
      targets,
    },
    evidenceByPath: new Map(targets.map((entry) => [
      entry.evidence,
      evidence(entry.language, entry.runtime),
    ])),
  };
}

function firstEvidence(value) {
  return value.evidenceByPath.get(value.manifest.targets[0].evidence);
}

function assertRuntimeStops(value, label) {
  const result = verifyLanguageBoundaries(value);
  assert.equal(result.status, 'stopped_for_evaluation', label);
  assert.equal(result.zeroUnexplainedFindings, false, label);
  assert.ok(result.findings.length > 0, label);
}

const manifestMutations = [
  ['unknown root property', (value) => { value.manifest.extra = true; }],
  ['minimum below two', (value) => { value.manifest.minimumDistinctLanguages = 1; }],
  ['minimum wrong type', (value) => { value.manifest.minimumDistinctLanguages = '2'; }],
  ['minimum above safe integer', (value) => { value.manifest.minimumDistinctLanguages = Number.MAX_SAFE_INTEGER + 1; }],
  ['authority role drift', (value) => { value.manifest.authorities.generatedWitness = 'authority'; }],
  ['unknown authority property', (value) => { value.manifest.authorities.extra = true; }],
  ['target boolean string', (value) => { value.manifest.targets[0].required = 'true'; }],
  ['unknown target property', (value) => { value.manifest.targets[0].extra = true; }],
  ['leading target whitespace', (value) => { value.manifest.targets[0].language = ' rust'; }],
  ['embedded target control', (value) => { value.manifest.targets[0].language = 'ru\u0000st'; }],
  ['target token over 256 characters', (value) => { value.manifest.targets[0].runtime = 'r'.repeat(257); }],
  ['absolute evidence path', (value) => { value.manifest.targets[0].evidence = '/rust/native.json'; }],
  ['backslash evidence path', (value) => { value.manifest.targets[0].evidence = 'rust\\native.json'; }],
  ['dot evidence path', (value) => { value.manifest.targets[0].evidence = './rust.json'; }],
  ['parent evidence path', (value) => { value.manifest.targets[0].evidence = 'rust/../native.json'; }],
  ['double slash evidence path', (value) => { value.manifest.targets[0].evidence = 'rust//native.json'; }],
  ['trailing slash evidence path', (value) => { value.manifest.targets[0].evidence = 'rust/native/'; }],
  ['leading path whitespace', (value) => { value.manifest.targets[0].evidence = ' rust/native.json'; }],
  ['trailing path whitespace', (value) => { value.manifest.targets[0].evidence = 'rust/native.json '; }],
  ['embedded path control', (value) => { value.manifest.targets[0].evidence = 'rust/na\u0000tive.json'; }],
  ['path over 2048 characters', (value) => { value.manifest.targets[0].evidence = 'p'.repeat(2049); }],
];

const evidenceMutations = [
  ['unknown root property', (value) => { firstEvidence(value).extra = true; }],
  ['schema identity drift', (value) => { firstEvidence(value).schema = 'other/v1'; }],
  ['unknown status', (value) => { firstEvidence(value).status = 'ok'; }],
  ['leading language whitespace', (value) => { firstEvidence(value).language = ' rust'; }],
  ['embedded runtime control', (value) => { firstEvidence(value).runtime = 'na\u0000tive'; }],
  ['source revision symbolic', (value) => { firstEvidence(value).sourceRevision = 'main'; }],
  ['source revision uppercase', (value) => { firstEvidence(value).sourceRevision = 'A'.repeat(40); }],
  ['artifact digest missing prefix', (value) => { firstEvidence(value).artifactDigest = '4'.repeat(64); }],
  ['artifact digest uppercase', (value) => { firstEvidence(value).artifactDigest = `sha256:${'A'.repeat(64)}`; }],
  ['receipt digest short', (value) => { firstEvidence(value).receiptRunId = '1'.repeat(63); }],
  ['receipt digest uppercase', (value) => { firstEvidence(value).receiptRunId = 'A'.repeat(64); }],
  ['Contract IR digest short', (value) => { firstEvidence(value).contractIrId = '2'.repeat(63); }],
  ['unknown toolchain property', (value) => { firstEvidence(value).toolchain.extra = true; }],
  ['blank toolchain name', (value) => { firstEvidence(value).toolchain.name = ' '; }],
  ['toolchain control character', (value) => { firstEvidence(value).toolchain.version = '1.0\u0000'; }],
  ['unknown generator property', (value) => { firstEvidence(value).generator.extra = true; }],
  ['unknown validation property', (value) => { firstEvidence(value).validation.extra = true; }],
  ['missing validation field', (value) => { delete firstEvidence(value).validation.egress; }],
  ['invalid validation status', (value) => { firstEvidence(value).validation.ingress = 'skipped'; }],
  ['validation wrong type', (value) => { firstEvidence(value).validation = null; }],
];

test('Ajv Draft 2020-12 independently validates every public language-boundary schema', async () => {
  const validators = await independentValidators();
  const value = input();
  assert.equal(validators.manifest(value.manifest), true, JSON.stringify(validators.manifest.errors));
  for (const record of value.evidenceByPath.values()) {
    assert.equal(validators.evidence(record), true, JSON.stringify(validators.evidence.errors));
  }
});

test('schema-valid 2048-character evidence-path contract is not narrowed to token length at runtime', async () => {
  const validators = await independentValidators();
  const value = input();
  const previous = value.manifest.targets[0].evidence;
  const longPath = 'p'.repeat(2048);
  const record = value.evidenceByPath.get(previous);
  value.evidenceByPath.delete(previous);
  value.manifest.targets[0].evidence = longPath;
  value.evidenceByPath.set(longPath, record);

  assert.equal(validators.manifest(value.manifest), true, JSON.stringify(validators.manifest.errors));
  const result = verifyLanguageBoundaries(value);
  assert.equal(result.status, 'passed');
  assert.equal(result.counts.admittedEvidence, 2);
});

test('every sampled schema-invalid manifest envelope also fails runtime admission', async () => {
  const validators = await independentValidators();
  for (const [label, mutate] of manifestMutations) {
    const value = input();
    mutate(value);
    assert.equal(validators.manifest(value.manifest), false, `${label}: independent schema unexpectedly accepted mutation`);
    assertRuntimeStops(value, label);
  }
});

test('every sampled schema-invalid evidence envelope also fails runtime admission', async () => {
  const validators = await independentValidators();
  for (const [label, mutate] of evidenceMutations) {
    const value = input();
    mutate(value);
    const record = firstEvidence(value);
    assert.equal(validators.evidence(record), false, `${label}: independent schema unexpectedly accepted mutation`);
    const result = verifyLanguageBoundaries(value);
    assert.equal(result.status, 'stopped_for_evaluation', label);
    assert.equal(result.zeroUnexplainedFindings, false, label);
    assert.equal(result.counts.admittedEvidence, 1, `${label}: invalid evidence must not count as admitted`);
  }
});

test('both passed and stopped verifier receipts independently validate against the public receipt schema', async () => {
  const validators = await independentValidators();

  const passed = verifyLanguageBoundaries(input());
  assert.equal(passed.status, 'passed');
  assert.equal(validators.verification(passed), true, JSON.stringify(validators.verification.errors));

  const stoppedInput = input();
  stoppedInput.evidenceByPath.delete('rust/native.json');
  const stopped = verifyLanguageBoundaries(stoppedInput);
  assert.equal(stopped.status, 'stopped_for_evaluation');
  assert.equal(validators.verification(stopped), true, JSON.stringify(validators.verification.errors));
});

test('independent receipt schema rejects structural drift in emitted-decision envelopes', async () => {
  const validators = await independentValidators();
  const canonical = structuredClone(verifyLanguageBoundaries(input()));
  const mutations = [
    ['missing verification id', (value) => { delete value.verificationId; }],
    ['unknown receipt property', (value) => { value.extra = true; }],
    ['invalid status', (value) => { value.status = 'failed'; }],
    ['negative count', (value) => { value.counts.findings = -1; }],
    ['authority ranking', (value) => { value.binding.typeSpecAuthority = 'primary'; }],
  ];
  for (const [label, mutate] of mutations) {
    const value = structuredClone(canonical);
    mutate(value);
    assert.equal(validators.verification(value), false, label);
  }
});

test('schema-valid cross-object conditions remain explicit runtime policy', async () => {
  const validators = await independentValidators();

  const duplicate = input();
  duplicate.manifest.targets[1].language = 'rust';
  duplicate.manifest.targets[1].runtime = 'native';
  const duplicateEvidence = duplicate.evidenceByPath.get('typescript/node.json');
  duplicateEvidence.language = 'rust';
  duplicateEvidence.runtime = 'native';
  assert.equal(validators.manifest(duplicate.manifest), true);
  assert.equal(validators.evidence(duplicateEvidence), true);
  assertRuntimeStops(duplicate, 'duplicate composite target identity');

  const revisionSplice = input();
  revisionSplice.evidenceByPath.get('typescript/node.json').sourceRevision = 'f'.repeat(40);
  assert.equal(validators.evidence(revisionSplice.evidenceByPath.get('typescript/node.json')), true);
  assertRuntimeStops(revisionSplice, 'cross-target source revision splice');

  const receiptMismatch = input();
  receiptMismatch.evidenceByPath.get('typescript/node.json').receiptRunId = '9'.repeat(64);
  assert.equal(validators.evidence(receiptMismatch.evidenceByPath.get('typescript/node.json')), true);
  assertRuntimeStops(receiptMismatch, 'cross-object receipt binding mismatch');
});
