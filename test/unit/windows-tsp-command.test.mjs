import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { nodeModuleOverlayCandidate, normalizeSpawnCommand } from '../../src/emitter.mjs';

test('Windows npm tsp.cmd is executed through node without a shell', () => {
  const original = String.raw`D:\tools\node_modules\.bin\tsp.cmd`;
  const result = normalizeSpawnCommand(original, ['--version'], {
    platform: 'win32',
    nodeExecutable: String.raw`C:\Program Files\nodejs\node.exe`,
  });
  assert.equal(result.command, String.raw`C:\Program Files\nodejs\node.exe`);
  assert.deepEqual(result.args, [
    String.raw`D:\tools\node_modules\@typespec\compiler\cmd\tsp.js`,
    '--version',
  ]);
});

test('Windows translation preserves TypeSpec argv as separate tokens', () => {
  const original = String.raw`D:\tools\node_modules\.bin\tsp.cmd`;
  const args = ['compile', String.raw`D:\work\contract with spaces\main.tsp`, '--warn-as-error'];
  const result = normalizeSpawnCommand(original, args, {
    platform: 'win32',
    nodeExecutable: String.raw`C:\node\node.exe`,
  });
  assert.deepEqual(result.args.slice(1), args);
});

test('explicit JavaScript TypeSpec commands use Node on Windows', () => {
  const script = String.raw`D:\work\test helpers\fake-tsp.mjs`;
  const result = normalizeSpawnCommand(script, ['compile', 'main.tsp'], {
    platform: 'win32',
    nodeExecutable: String.raw`C:\node\node.exe`,
  });
  assert.equal(result.command, String.raw`C:\node\node.exe`);
  assert.deepEqual(result.args, [script, 'compile', 'main.tsp']);
});

test('non-TypeSpec commands and non-Windows platforms are left untouched', () => {
  assert.deepEqual(
    normalizeSpawnCommand('/usr/bin/tsp', ['--version'], { platform: 'linux' }),
    { command: '/usr/bin/tsp', args: ['--version'] },
  );
  const other = String.raw`D:\tools\node_modules\.bin\other.cmd`;
  assert.deepEqual(
    normalizeSpawnCommand(other, ['x'], { platform: 'win32', nodeExecutable: 'node.exe' }),
    { command: other, args: ['x'] },
  );
});

test('pinned module overlay accepts native and TypeSpec-normalized Windows separators', () => {
  const moduleRoot = join(process.cwd(), 'overlay-root');
  const expected = join(moduleRoot, 'node_modules', '@typespec', 'json-schema');

  assert.equal(
    nodeModuleOverlayCandidate(String.raw`D:\consumer\node_modules\@typespec\json-schema`, moduleRoot),
    expected,
  );
  assert.equal(
    nodeModuleOverlayCandidate('D:/consumer/node_modules/@typespec/json-schema', moduleRoot),
    expected,
  );
  assert.equal(nodeModuleOverlayCandidate(String.raw`D:\consumer\src\main.tsp`, moduleRoot), null);
});
