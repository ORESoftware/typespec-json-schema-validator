import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertIndependentOutput, preflightAdmissionOutput } from '../../src/consumer-admission-paths.mjs';

for (const [name, paths, root] of [['posix', path.posix, '/repo'], ['windows', path.win32, 'C:\\repo']]) {
  const input = paths.join(root, 'source');
  for (const output of [input, paths.join(input, 'receipt.json'), root, paths.join(root, 'other', '..', 'source')]) {
    test(`${name}: reject overlapping output ${output}`, () => {
      assert.throws(() => assertIndependentOutput(output, [input], paths), /overlaps/);
    });
  }
  test(`${name}: permit adjacent paths without prefix confusion`, () => {
    assert.doesNotThrow(() => assertIndependentOutput(paths.join(root, 'source-evidence', 'receipt.json'), [input], paths));
  });
  test(`${name}: reject relative input or output and missing scope`, () => {
    assert.throws(() => assertIndependentOutput('relative', [input], paths), TypeError);
    assert.throws(() => assertIndependentOutput(input, ['relative'], paths), TypeError);
    assert.throws(() => assertIndependentOutput(input, [], paths), TypeError);
  });
}
test('Windows paths compare casing without losing component boundaries', () => {
  assert.throws(() => assertIndependentOutput('c:\\REPO\\source\\receipt', ['C:\\repo\\SOURCE'], path.win32), /overlaps/);
});

test('read-only physical path preflight rejects links into input trees', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  await mkdir(path.join(root, 'tmp'), { recursive: true });
  const workspace = await mkdtemp(path.join(root, 'tmp', 'path-preflight-'));
  try {
    const input = path.join(workspace, 'source');
    await mkdir(input);
    await writeFile(path.join(input, 'keep'), 'unchanged');
    const alias = path.join(workspace, 'alias');
    await symlink(input, alias, 'dir');
    await assert.rejects(preflightAdmissionOutput(workspace, path.join(alias, 'new', 'receipt.json'), [input]), /overlaps/);
    assert.equal(await readFile(path.join(input, 'keep'), 'utf8'), 'unchanged');
    await assert.rejects(readFile(path.join(input, 'new', 'receipt.json')), { code: 'ENOENT' });
    await assert.rejects(preflightAdmissionOutput(workspace, path.join(workspace, 'receipt.json'), [workspace]), /overlaps/);
    await assert.doesNotReject(preflightAdmissionOutput(workspace, path.join(workspace, 'evidence', 'receipt.json'), [path.join(input, 'missing.json')]));
    const dangling = path.join(workspace, 'dangling');
    await symlink(path.join(workspace, 'absent'), dangling);
    await assert.rejects(preflightAdmissionOutput(workspace, path.join(dangling, 'receipt.json'), [input]), /unresolvable/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
