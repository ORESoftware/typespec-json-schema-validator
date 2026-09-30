import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { emitTypeSpecJsonSchema } from '../../src/emitter.mjs';
import { inventoryTypeSpecSource } from '../../src/typespec-inventory.mjs';

test('escaped TypeSpec identifiers with path separators are rejected deterministically', () => {
  for (const source of [
    'model `../../outside` { value: string; }',
    'model `..\\\\outside` { value: string; }',
  ]) {
    const inventory = inventoryTypeSpecSource(source, 'hostile.tsp');
    assert.ok(
      inventory.errors.some((finding) => (
        finding.code === 'unsafe-escaped-identifier-path-separator'
      )),
      JSON.stringify(inventory.errors),
    );
  }
});

test('emitter refuses path-bearing escaped identifiers before compiler execution or output creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-path-boundary-'));
  const entry = join(root, 'main.tsp');
  const outputDir = join(root, 'generated');
  await writeFile(entry, 'model `../../outside` { value: string; }\n');

  await assert.rejects(
    emitTypeSpecJsonSchema({
      entry,
      outputDir,
      bundleId: 'typespec.generated.schema.json',
      tspBin: join(root, 'compiler-must-not-run'),
    }),
    /unsafe TypeSpec emitter input refused before compilation/u,
  );

  await assert.rejects(access(outputDir), { code: 'ENOENT' });
});
