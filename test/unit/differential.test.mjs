import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { canonicalStringify } from '../../src/canonical.mjs';
import { crossValidate, loadInstanceCorpus } from '../../src/differential.mjs';
import { loadSchemaCollection } from '../../src/json-schema.mjs';
import { runValidate } from '../../src/run.mjs';

const fixtures = resolve(import.meta.dirname, '../fixtures');

async function lanes(fixture) {
  const [authoredCollection, generatedCollection] = await Promise.all([
    loadSchemaCollection(join(fixtures, fixture, 'authored.schema.json'), { requireDialect: true }),
    loadSchemaCollection(join(fixtures, fixture, 'generated.schema.json'), { requireDialect: true }),
  ]);
  return { authoredCollection, generatedCollection };
}

function declarationMap(names) {
  return names.map((name) => ({ typespec: `Example.${name}`, generated: name, authored: name }));
}

test('equivalent authorities agree on every probe', async () => {
  const { authoredCollection, generatedCollection } = await lanes('pass');
  const result = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: declarationMap(['Role', 'User']),
    maxProbes: 48,
  });
  assert.equal(result.summary.divergences, 0, canonicalStringify(result.findings.slice(0, 2)));
  assert.equal(result.summary.refusals, 0);
  assert.ok(result.summary.probesEvaluated > 20, 'the probe corpus must be non-trivial');
  assert.equal(result.summary.agreements, result.summary.probesEvaluated);
  assert.equal(result.findings.length, 0);
  assert.ok(result.declarations.every((declaration) => declaration.behaviorallyIndistinguishable));
});

test('drifting authorities produce witness instances rather than opinions', async () => {
  const { authoredCollection, generatedCollection } = await lanes('drift');
  const result = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: declarationMap(['Role', 'User']),
    maxProbes: 48,
  });
  assert.ok(result.summary.divergences > 0);
  const divergences = result.findings.filter((finding) => finding.ruleId === 'instance-verdict-divergence');
  assert.equal(divergences.length, result.summary.divergences);
  for (const finding of divergences) {
    assert.ok(finding.witness, 'every divergence must carry the instance that proves it');
    assert.notEqual(finding.left.valid, finding.right.valid);
    assert.equal(finding.severity, 'error');
    assert.equal(finding.resolutionState, 'unexplained');
    assert.match(finding.fingerprint, /^[a-f0-9]{64}$/u);
  }
});

test('an enum member present in only one authority is caught by domain probing', async () => {
  const { authoredCollection, generatedCollection } = await lanes('drift');
  const result = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: declarationMap(['Role']),
    maxProbes: 48,
  });
  const witnesses = result.findings
    .filter((finding) => finding.ruleId === 'instance-verdict-divergence')
    .map((finding) => finding.witness.instance);
  assert.ok(
    witnesses.includes('owner'),
    `expected the extra authored enum member to be witnessed, received ${canonicalStringify(witnesses)}`,
  );
});

test('structurally different but behaviourally identical authorities produce no divergence', async () => {
  const { authoredCollection, generatedCollection } = await lanes('equivalent');
  const result = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: declarationMap(['Status', 'Widget']),
    maxProbes: 64,
  });
  assert.equal(result.summary.divergences, 0, canonicalStringify(result.findings.slice(0, 2)));
  assert.ok(result.summary.probesEvaluated > 40);
  assert.equal(result.summary.behaviorallyIndistinguishableDeclarations, 2);
});

test('the differential lane is symmetric in the two authorities', async () => {
  const { authoredCollection, generatedCollection } = await lanes('drift');
  const forward = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: declarationMap(['Role', 'User']),
    maxProbes: 48,
  });
  const reverse = crossValidate({
    generatedCollection: authoredCollection,
    authoredCollection: generatedCollection,
    declarationMap: declarationMap(['Role', 'User']),
    maxProbes: 48,
  });
  assert.equal(forward.summary.divergences, reverse.summary.divergences);
  assert.equal(forward.summary.probesEvaluated, reverse.summary.probesEvaluated);
});

test('results are byte-identical across repeated runs', async () => {
  const { authoredCollection, generatedCollection } = await lanes('drift');
  const run = () =>
    canonicalStringify(
      crossValidate({
        generatedCollection,
        authoredCollection,
        declarationMap: declarationMap(['Role', 'User']),
        maxProbes: 48,
      }),
    );
  assert.equal(run(), run());
});

test('the instance corpus honours the valid/invalid directory contract', async () => {
  const corpus = await loadInstanceCorpus(join(fixtures, 'corpus/instances'));
  assert.equal(corpus.length, 5);
  const expectations = corpus.map((item) => `${item.declaration}:${item.expectation}`).sort();
  assert.deepEqual(expectations, [
    'Widget:accepted',
    'Widget:accepted',
    'Widget:null',
    'Widget:rejected',
    'Widget:rejected',
  ]);
});

test('a satisfied corpus produces no findings', async () => {
  const { authoredCollection, generatedCollection } = await lanes('corpus');
  const corpus = await loadInstanceCorpus(join(fixtures, 'corpus/instances'));
  const result = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: declarationMap(['Status', 'Widget']),
    corpus,
    maxProbes: 32,
  });
  assert.equal(result.findings.length, 0, canonicalStringify(result.findings));
  assert.equal(result.summary.corpusInstances, 5);
});

test('a violated corpus expectation is reported even when both authorities agree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-corpus-'));
  await mkdir(join(root, 'Widget/invalid'), { recursive: true });
  await writeFile(join(root, 'Widget/invalid/actually-valid.json'), '{"name":"n","status":"on"}\n');
  const corpus = await loadInstanceCorpus(root);
  const { authoredCollection, generatedCollection } = await lanes('corpus');
  const result = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: declarationMap(['Widget']),
    corpus,
    maxProbes: 8,
  });
  const finding = result.findings.find((item) => item.ruleId === 'corpus-instance-accepted');
  assert.ok(finding, canonicalStringify(result.findings));
  assert.match(finding.message, /declared rejected/u);
});

test('a corpus targeting an unknown declaration fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-corpus-unknown-'));
  await mkdir(join(root, 'Absent'), { recursive: true });
  await writeFile(join(root, 'Absent/instance.json'), '{}\n');
  const corpus = await loadInstanceCorpus(root);
  const { authoredCollection, generatedCollection } = await lanes('corpus');
  const result = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: declarationMap(['Widget']),
    corpus,
    maxProbes: 4,
  });
  assert.ok(result.findings.some((finding) => finding.ruleId === 'corpus-declaration-unknown'));
});

test('validate builds a deterministic receipt without invoking the TypeSpec compiler', async () => {
  const options = {
    command: 'validate',
    authoredSchema: join(fixtures, 'equivalent/authored.schema.json'),
    generatedSchema: join(fixtures, 'equivalent/generated.schema.json'),
    maxFindings: 250,
    maxProbes: 64,
    probes: true,
    formatAssertion: false,
  };
  const first = await runValidate(options);
  const second = await runValidate(options);
  assert.equal(first.status, 'passed');
  assert.equal(first.runId, second.runId);
  assert.equal(first.inputs.typespec, null);
  assert.equal(first.coverage.differentialInstanceValidation, true);
  assert.equal(first.coverage.directDeclarationInventory, false);
  assert.equal(first.differential.summary.divergences, 0);
  assert.equal(first.counts.differentialFindings, 0);
});

test('validate stops for evaluation when the authorities diverge', async () => {
  const report = await runValidate({
    command: 'validate',
    authoredSchema: join(fixtures, 'drift/authored.schema.json'),
    generatedSchema: join(fixtures, 'drift/generated.schema.json'),
    maxFindings: 250,
    maxProbes: 64,
    probes: true,
    formatAssertion: false,
  });
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(report.zeroUnexplainedFindings, false);
  assert.ok(report.counts.differentialFindings > 0);
  assert.ok(report.findings.every((finding) => finding.resolutionState === 'unexplained'));
});

test('disabling probes records the absent evidence instead of claiming a pass', async () => {
  const report = await runValidate({
    command: 'validate',
    authoredSchema: join(fixtures, 'drift/authored.schema.json'),
    generatedSchema: join(fixtures, 'drift/generated.schema.json'),
    maxFindings: 250,
    maxProbes: 64,
    probes: false,
    formatAssertion: false,
  });
  assert.equal(report.coverage.differentialInstanceValidation, false);
  assert.equal(report.differential.disabled, true);
  assert.equal(report.configuration.differential.enabled, false);
});
