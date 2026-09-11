import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNpmInvocation } from '../../scripts/npm-command.mjs';

test('npm-run scripts invoke npm_execpath through the current Node executable', () => {
  const invocation = resolveNpmInvocation(['--version'], {
    env: { npm_execpath: String.raw`C:\node\node_modules\npm\bin\npm-cli.js` },
    execPath: String.raw`C:\node\node.exe`,
    platform: 'win32',
  });

  assert.deepEqual(invocation, {
    executable: String.raw`C:\node\node.exe`,
    args: [String.raw`C:\node\node_modules\npm\bin\npm-cli.js`, '--version'],
    logicalCommand: 'npm',
  });
});

test('Windows fallback remains explicit npm.cmd without a shell', () => {
  const invocation = resolveNpmInvocation(['audit', '--json'], {
    env: {},
    execPath: String.raw`C:\node\node.exe`,
    platform: 'win32',
  });

  assert.deepEqual(invocation, {
    executable: 'npm.cmd',
    args: ['audit', '--json'],
    logicalCommand: 'npm',
  });
});

test('POSIX fallback remains npm', () => {
  const invocation = resolveNpmInvocation(['config', 'get', 'registry'], {
    env: {},
    execPath: '/usr/bin/node',
    platform: 'linux',
  });

  assert.deepEqual(invocation, {
    executable: 'npm',
    args: ['config', 'get', 'registry'],
    logicalCommand: 'npm',
  });
});

test('non-JavaScript npm_execpath values are not executed through Node', () => {
  const invocation = resolveNpmInvocation(['--version'], {
    env: { npm_execpath: String.raw`C:\node\npm.cmd` },
    execPath: String.raw`C:\node\node.exe`,
    platform: 'win32',
  });

  assert.equal(invocation.executable, 'npm.cmd');
  assert.deepEqual(invocation.args, ['--version']);
});
