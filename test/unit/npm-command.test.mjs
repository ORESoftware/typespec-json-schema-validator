import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNpmInvocation } from '../../src/npm-command.mjs';

const WINDOWS_NODE = 'C:\\hostedtoolcache\\windows\\node\\22.16.0\\x64\\node.exe';
const WINDOWS_NPM = 'C:\\hostedtoolcache\\windows\\node\\22.16.0\\x64\\node_modules\\npm\\bin\\npm-cli.js';
const EXPLICIT_NPM = 'C:\\custom\\npm\\bin\\npm-cli.js';

test('non-Windows npm uses the direct command without shell mediation', () => {
  assert.deepEqual(resolveNpmInvocation({
    command: 'npm',
    args: ['--version'],
    platform: 'linux',
    execPath: '/usr/bin/node',
    npmExecPath: null,
    isFile: () => false,
  }), {
    executable: 'npm',
    argv: ['--version'],
    source: 'direct-command',
    error: null,
  });
});

test('Windows prefers an explicit absolute npm_execpath when it exists', () => {
  const result = resolveNpmInvocation({
    command: 'npm',
    args: ['audit', '--json'],
    platform: 'win32',
    execPath: WINDOWS_NODE,
    npmExecPath: EXPLICIT_NPM,
    isFile: (path) => path === EXPLICIT_NPM,
  });
  assert.equal(result.executable, WINDOWS_NODE);
  assert.deepEqual(result.argv, [EXPLICIT_NPM, 'audit', '--json']);
  assert.equal(result.source, 'npm_execpath');
  assert.equal(result.error, null);
});

test('Windows falls back to setup-node adjacent npm-cli.js when npm_execpath is intentionally absent', () => {
  const result = resolveNpmInvocation({
    command: 'npm',
    args: ['--version'],
    platform: 'win32',
    execPath: WINDOWS_NODE,
    npmExecPath: null,
    isFile: (path) => path === WINDOWS_NPM,
  });
  assert.equal(result.executable, WINDOWS_NODE);
  assert.deepEqual(result.argv, [WINDOWS_NPM, '--version']);
  assert.equal(result.source, 'node-adjacent-npm-cli');
  assert.equal(result.error, null);
});

test('Windows ignores a relative npm_execpath and still uses the adjacent immutable CLI', () => {
  const result = resolveNpmInvocation({
    command: 'npm',
    args: ['config', 'get', 'registry'],
    platform: 'win32',
    execPath: WINDOWS_NODE,
    npmExecPath: 'node_modules/npm/bin/npm-cli.js',
    isFile: (path) => path === WINDOWS_NPM,
  });
  assert.deepEqual(result.argv, [WINDOWS_NPM, 'config', 'get', 'registry']);
  assert.equal(result.source, 'node-adjacent-npm-cli');
});

test('Windows fails closed when no npm JavaScript entrypoint is intentionally available', () => {
  const result = resolveNpmInvocation({
    command: 'npm',
    args: ['--version'],
    platform: 'win32',
    execPath: WINDOWS_NODE,
    npmExecPath: null,
    isFile: () => false,
  });
  assert.equal(result.executable, null);
  assert.deepEqual(result.argv, []);
  assert.equal(result.source, 'unavailable');
  assert.match(result.error.message, /npm CLI JavaScript entrypoint is unavailable/);
});

test('Windows fails closed when the Node executable is not absolute', () => {
  const result = resolveNpmInvocation({
    command: 'npm',
    args: ['--version'],
    platform: 'win32',
    execPath: 'node.exe',
    npmExecPath: EXPLICIT_NPM,
    isFile: () => true,
  });
  assert.equal(result.executable, null);
  assert.match(result.error.message, /Node executable path/);
});
