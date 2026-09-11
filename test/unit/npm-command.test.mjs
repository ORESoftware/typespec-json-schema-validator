import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNpmLaunch } from '../../src/npm-command.mjs';

test('non-Windows npm launch preserves argv and uses PATH', () => {
  assert.deepEqual(resolveNpmLaunch(['audit', '--json'], { platform: 'linux' }), {
    command: 'npm',
    args: ['audit', '--json'],
    source: 'path',
  });
});

test('Windows direct action invocation uses npm bundled with the active Node runtime', () => {
  const node = 'C:\\hostedtoolcache\\windows\\node\\22.16.0\\x64\\node.exe';
  const npmCli = 'C:\\hostedtoolcache\\windows\\node\\22.16.0\\x64\\node_modules\\npm\\bin\\npm-cli.js';
  const result = resolveNpmLaunch(['--version'], {
    platform: 'win32',
    execPath: node,
    env: {},
    exists: (candidate) => candidate === npmCli,
  });

  assert.deepEqual(result, {
    command: node,
    args: [npmCli, '--version'],
    source: 'node-bundled-cli',
  });
});

test('Windows may use an existing npm_execpath only inside the active Node installation', () => {
  const node = 'C:\\node\\22.16.0\\node.exe';
  const configured = 'C:\\node\\22.16.0\\tools\\npm\\npm-cli.js';
  const result = resolveNpmLaunch(['config', 'get', 'registry'], {
    platform: 'win32',
    execPath: node,
    env: { npm_execpath: configured },
    exists: (candidate) => candidate === configured,
  });

  assert.deepEqual(result, {
    command: node,
    args: [configured, 'config', 'get', 'registry'],
    source: 'trusted-npm-execpath',
  });
});

test('Windows refuses an npm_execpath outside the active Node installation', () => {
  const untrusted = 'D:\\untrusted\\npm-cli.js';
  assert.throws(() => resolveNpmLaunch(['audit'], {
    platform: 'win32',
    execPath: 'C:\\node\\22.16.0\\node.exe',
    env: { npm_execpath: untrusted },
    exists: (candidate) => candidate === untrusted,
  }), /npm CLI JS entry point is unavailable/u);
});

test('npm argv rejects NUL-bearing values before process creation', () => {
  assert.throws(
    () => resolveNpmLaunch(['audit', 'bad\u0000value'], { platform: 'linux' }),
    /NUL-free strings/u,
  );
});
