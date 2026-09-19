import assert from 'node:assert/strict';
import { cp, mkdtemp } from 'node:fs/promises';
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
