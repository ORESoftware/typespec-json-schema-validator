import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePortableSpawn } from '../../scripts/portable-spawn.mjs';

test('non-Windows commands are preserved byte-for-byte', () => {
  assert.deepEqual(
    resolvePortableSpawn('npm', ['pack', '--json'], { platform: 'linux', execPath: '/node' }),
    { command: 'npm', args: ['pack', '--json'] },
  );
});

test('Windows npm.cmd is re-executed through Node without a shell', () => {
  assert.deepEqual(
    resolvePortableSpawn('C:\\node\\npm.cmd', ['pack', '--json'], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      npmExecPath: 'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
    }),
    {
      command: 'C:\\node\\node.exe',
      args: ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', 'pack', '--json'],
    },
  );
});

test('Windows npm.cmd derives npm-cli.js when npm_execpath is another shim', () => {
  assert.deepEqual(
    resolvePortableSpawn('C:\\node\\npm.cmd', ['install'], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      npmExecPath: 'C:\\node\\npm.cmd',
    }),
    {
      command: 'C:\\node\\node.exe',
      args: ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', 'install'],
    },
  );
});

test('all installed TJSV aliases resolve to the canonical packaged JS entrypoint', () => {
  for (const alias of ['tjsv', 'tsjsv', 'typespec-json-schema-validator']) {
    const resolved = resolvePortableSpawn(
      `C:\\work\\consumer\\node_modules\\.bin\\${alias}.cmd`,
      ['doctor', '--quiet'],
      { platform: 'win32', execPath: 'C:\\node\\node.exe' },
    );
    assert.equal(resolved.command, 'C:\\node\\node.exe');
    assert.deepEqual(resolved.args, [
      'C:\\work\\consumer\\node_modules\\@oresoftware\\typespec-json-schema-validator\\bin\\typespec-json-schema-validator.mjs',
      'doctor',
      '--quiet',
    ]);
  }
});

test('unapproved Windows .cmd shims fail closed', () => {
  assert.throws(
    () => resolvePortableSpawn('C:\\tools\\unknown.cmd', ['arg'], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
    }),
    /refuses unapproved Windows command shim/u,
  );
});
