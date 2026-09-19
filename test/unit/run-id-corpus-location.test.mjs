import assert from 'node:assert/strict';
import { cp, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runValidate } from '../../src/run.mjs';

const fixtures = resolve(import.meta.dirname, '../fixtures');

async function copiedCorpus(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const target = join(root, 'instances');
  await cp(join(fixtures, 'corpus/instances'), target, { recursive: true });
  return target;
}

function options(instances) {
  return {
    command: 'validate',
    authoredSchema: join(fixtures, 'corpus/authored.schema.json'),
    generatedSchema: join(fixtures, 'corpus/generated.schema.json'),
    instances,
    maxFindings: 250,
    maxProbes: 32,
    probes: true,
    formatAssertion: false,
  };
}

test('runId is stable when an identical explicit corpus moves between temp directories', async () => {
  const leftPath = await copiedCorpus('tjsv-corpus-location-a-');
  const rightPath = await copiedCorpus('tjsv-corpus-location-b-');
  assert.notEqual(leftPath, rightPath);

  const left = await runValidate(options(leftPath));
  const right = await runValidate(options(rightPath));

  assert.equal(left.status, 'passed');
  assert.equal(right.status, 'passed');
  assert.notEqual(
    left.configuration.differential.instanceCorpus,
    right.configuration.differential.instanceCorpus,
    'the diagnostic location should still report where each corpus was read',
  );
  assert.match(left.configuration.differential.instanceCorpusDigest, /^[a-f0-9]{64}$/u);
  assert.equal(
    left.configuration.differential.instanceCorpusDigest,
    right.configuration.differential.instanceCorpusDigest,
    'semantic corpus identity must be independent of the temp root',
  );
  assert.equal(
    left.runId,
    right.runId,
    'receipt identity must not depend on an invocation-specific filesystem path',
  );
});

test('runId changes when explicit corpus content changes', async () => {
  const baselinePath = await copiedCorpus('tjsv-corpus-content-a-');
  const mutatedPath = await copiedCorpus('tjsv-corpus-content-b-');
  await writeFile(
    join(mutatedPath, 'Widget/valid/minimal.json'),
    '{ "name": "changed", "status": "on" }\n',
  );

  const baseline = await runValidate(options(baselinePath));
  const mutated = await runValidate(options(mutatedPath));

  assert.equal(baseline.status, 'passed');
  assert.equal(mutated.status, 'passed');
  assert.notEqual(
    baseline.configuration.differential.instanceCorpusDigest,
    mutated.configuration.differential.instanceCorpusDigest,
    'semantic corpus identity must include instance content',
  );
  assert.notEqual(baseline.runId, mutated.runId, 'receipt identity must include instance content');
});

test('runId changes when explicit corpus-relative layout changes', async () => {
  const baselinePath = await copiedCorpus('tjsv-corpus-layout-a-');
  const renamedPath = await copiedCorpus('tjsv-corpus-layout-b-');
  await rename(
    join(renamedPath, 'Widget/valid/minimal.json'),
    join(renamedPath, 'Widget/valid/renamed.json'),
  );

  const baseline = await runValidate(options(baselinePath));
  const renamed = await runValidate(options(renamedPath));

  assert.equal(baseline.status, 'passed');
  assert.equal(renamed.status, 'passed');
  assert.notEqual(
    baseline.configuration.differential.instanceCorpusDigest,
    renamed.configuration.differential.instanceCorpusDigest,
    'semantic corpus identity must include corpus-relative paths',
  );
  assert.notEqual(baseline.runId, renamed.runId, 'receipt identity must include corpus-relative layout');
});
