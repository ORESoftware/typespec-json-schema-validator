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

test('ordinary executables and non-Windows platforms remain untouched', () => {
  assert.deepEqual(
    normalizeWindowsShellFreeSpawn(String.raw`C:\tools\node.exe`, ['x'], {
      platform: 'win32',
      nodeExecutable: String.raw`C:\node\node.exe`,
    }),
    { command: String.raw`C:\tools\node.exe`, args: ['x'] },
  );
  assert.deepEqual(
    normalizeWindowsShellFreeSpawn('npm', ['pack'], { platform: 'linux' }),
    { command: 'npm', args: ['pack'] },
  );
});

test('unapproved Windows command shims fail closed before spawn', () => {
  assert.throws(
    () => normalizeWindowsShellFreeSpawn(String.raw`C:\tools\other.cmd`, ['x'], {
      platform: 'win32',
      nodeExecutable: String.raw`C:\node\node.exe`,
    }),
    /refuses unapproved Windows command shim/u,
  );
});

test('package-owned aliases fail closed outside node_modules .bin', () => {
  for (const executable of [
    String.raw`D:\consumer\.bin\tjsv.cmd`,
    String.raw`tjsv.cmd`,
  ]) {
    assert.throws(
      () => normalizeWindowsShellFreeSpawn(executable, ['doctor'], {
        platform: 'win32',
        nodeExecutable: String.raw`C:\node\node.exe`,
      }),
      /package-owned Windows shim/u,
    );
  }
});

test('Windows npm translation fails closed for invalid npm_execpath values', () => {
  for (const npmExecPath of [
    '',
    'node_modules/npm/bin/npm-cli.js',
    String.raw`C:\node\npm.cmd`,
  ]) {
    assert.throws(
      () => normalizeWindowsShellFreeSpawn('npm.cmd', ['pack'], {
        platform: 'win32',
        nodeExecutable: String.raw`C:\node\node.exe`,
        npmExecPath,
      }),
      /npm_execpath must be an absolute non-\.cmd entrypoint/u,
    );
  }
});
