import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWindowsShellFreeSpawn } from '../../scripts/windows-shellfree-spawn.mjs';

test('Windows npm.cmd is executed through the current Node process without a shell', () => {
  const result = normalizeWindowsShellFreeSpawn('npm.cmd', ['install', '--ignore-scripts'], {
    platform: 'win32',
    nodeExecutable: String.raw`C:\Program Files\nodejs\node.exe`,
    npmExecPath: String.raw`C:\hostedtoolcache\node\node_modules\npm\bin\npm-cli.js`,
  });
  assert.equal(result.command, String.raw`C:\Program Files\nodejs\node.exe`);
  assert.deepEqual(result.args, [
    String.raw`C:\hostedtoolcache\node\node_modules\npm\bin\npm-cli.js`,
    'install',
    '--ignore-scripts',
  ]);
});

test('Windows installed TJSV aliases bypass npm .cmd shims with tokenized argv', () => {
  const executable = String.raw`D:\consumer with spaces\node_modules\.bin\tjsv.cmd`;
  const result = normalizeWindowsShellFreeSpawn(executable, ['doctor', '--quiet'], {
    platform: 'win32',
    nodeExecutable: String.raw`C:\node\node.exe`,
  });
  assert.equal(result.command, String.raw`C:\node\node.exe`);
  assert.deepEqual(result.args, [
    String.raw`D:\consumer with spaces\node_modules\@oresoftware\typespec-json-schema-validator\bin\typespec-json-schema-validator.mjs`,
    'doctor',
    '--quiet',
  ]);
});

test('Windows adapter recognizes all package-owned compatibility aliases', () => {
  for (const alias of ['tjsv.cmd', 'tsjsv.cmd', 'typespec-json-schema-validator.cmd']) {
    const result = normalizeWindowsShellFreeSpawn(
      String.raw`D:\consumer\node_modules\.bin\${alias}`.replace('${alias}', alias),
      ['doctor'],
      { platform: 'win32', nodeExecutable: String.raw`C:\node\node.exe` },
    );
    assert.equal(result.command, String.raw`C:\node\node.exe`, alias);
    assert.match(result.args[0], /typespec-json-schema-validator\.mjs$/u, alias);
  }
});

test('non-owned commands and non-Windows platforms remain untouched', () => {
  assert.deepEqual(
    normalizeWindowsShellFreeSpawn(String.raw`C:\tools\other.cmd`, ['x'], {
      platform: 'win32',
      nodeExecutable: String.raw`C:\node\node.exe`,
    }),
    { command: String.raw`C:\tools\other.cmd`, args: ['x'] },
  );
  assert.deepEqual(
    normalizeWindowsShellFreeSpawn('npm', ['pack'], { platform: 'linux' }),
    { command: 'npm', args: ['pack'] },
  );
});

test('Windows npm translation fails closed when npm_execpath is absent or relative', () => {
  for (const npmExecPath of [undefined, 'node_modules/npm/bin/npm-cli.js']) {
    assert.throws(
      () => normalizeWindowsShellFreeSpawn('npm.cmd', ['pack'], {
        platform: 'win32',
        nodeExecutable: String.raw`C:\node\node.exe`,
        npmExecPath,
      }),
      /npm_execpath is unavailable or not absolute/u,
    );
  }
});
