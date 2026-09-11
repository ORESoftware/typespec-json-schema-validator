import test from 'node:test';
import assert from 'node:assert/strict';
import { join, win32 } from 'node:path';
import { nodeModuleOverlayCandidate, resolveCommandInvocation } from '../../src/emitter.mjs';

function sameWindowsPath(left, right) {
  return win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase();
}

function windowsFileMatcher(expected) {
  return (candidate) => sameWindowsPath(candidate, expected);
}

test('Windows tsp.cmd shims run the sibling pinned TypeSpec JavaScript CLI through Node', () => {
  const workspace = String.raw`C:\workspace`;
  const nodeModules = win32.join(workspace, 'node_modules');
  const shim = win32.join(nodeModules, '.bin', 'tsp.cmd');
  const compilerCli = win32.join(nodeModules, '@typespec', 'compiler', 'cmd', 'tsp.js');

  const invocation = resolveCommandInvocation(shim, ['--version'], {
    platform: 'win32',
    cwd: workspace,
    fileExists: windowsFileMatcher(compilerCli),
  });

  assert.equal(invocation.executable, process.execPath);
  assert.ok(sameWindowsPath(invocation.args[0], compilerCli));
  assert.deepEqual(invocation.args.slice(1), ['--version']);
  assert.equal(invocation.logicalCommand, shim);
});

test('bare tsp.cmd resolves the pinned compiler CLI from the Windows working directory', () => {
  const workspace = String.raw`C:\workspace`;
  const compilerCli = win32.join(
    workspace,
    'node_modules',
    '@typespec',
    'compiler',
    'cmd',
    'tsp.js',
  );

  const invocation = resolveCommandInvocation('tsp.cmd', ['compile', 'contract.tsp'], {
    platform: 'win32',
    cwd: workspace,
    fileExists: windowsFileMatcher(compilerCli),
  });

  assert.equal(invocation.executable, process.execPath);
  assert.ok(sameWindowsPath(invocation.args[0], compilerCli));
  assert.deepEqual(invocation.args.slice(1), ['compile', 'contract.tsp']);
  assert.equal(invocation.logicalCommand, 'tsp.cmd');
});

test('explicit JavaScript TypeSpec helpers run through Node on Windows', () => {
  const workspace = String.raw`C:\workspace`;
  const command = win32.join(workspace, 'test', 'helpers', 'fake-tsp.mjs');

  const invocation = resolveCommandInvocation(command, ['compile', 'contract.tsp'], {
    platform: 'win32',
    cwd: workspace,
    fileExists: windowsFileMatcher(command),
  });

  assert.equal(invocation.executable, process.execPath);
  assert.equal(invocation.args[0], command);
  assert.deepEqual(invocation.args.slice(1), ['compile', 'contract.tsp']);
  assert.equal(invocation.logicalCommand, command);
});

test('unrelated Windows command shims are never shell-enabled or rewritten', () => {
  const workspace = String.raw`C:\workspace`;
  const command = win32.join(workspace, 'node_modules', '.bin', 'other.cmd');

  const invocation = resolveCommandInvocation(command, ['--version'], {
    platform: 'win32',
    cwd: workspace,
    fileExists: () => false,
  });

  assert.equal(invocation.executable, command);
  assert.deepEqual(invocation.args, ['--version']);
  assert.equal(invocation.logicalCommand, command);
});

test('missing Windows TypeSpec compiler entrypoint fails closed without inventing a shell route', () => {
  const workspace = String.raw`C:\workspace`;
  const command = win32.join(workspace, 'node_modules', '.bin', 'tsp.cmd');

  const invocation = resolveCommandInvocation(command, ['--version'], {
    platform: 'win32',
    cwd: workspace,
    fileExists: () => false,
  });

  assert.equal(invocation.executable, command);
  assert.deepEqual(invocation.args, ['--version']);
  assert.equal(invocation.logicalCommand, command);
});

test('POSIX TypeSpec launch remains unchanged', () => {
  const command = '/workspace/node_modules/.bin/tsp';
  const invocation = resolveCommandInvocation(command, ['--version'], {
    platform: 'linux',
    cwd: '/workspace',
    fileExists: () => true,
  });

  assert.equal(invocation.executable, command);
  assert.deepEqual(invocation.args, ['--version']);
  assert.equal(invocation.logicalCommand, command);
});

test('pinned fallback maps Windows-native and forward-slash-normalized module probes identically', () => {
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
  assert.equal(nodeModuleOverlayCandidate(String.raw`D:\consumer\main.tsp`, moduleRoot), null);
});
