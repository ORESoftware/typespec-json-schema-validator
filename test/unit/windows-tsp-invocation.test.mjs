import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveCommandInvocation } from '../../src/emitter.mjs';

test('Windows tsp.cmd shims run through the pinned TypeSpec JavaScript CLI without a shell', () => {
  const root = join('C:', 'workspace', 'node_modules');
  const shim = join(root, '.bin', 'tsp.cmd');
  const compilerCli = join(root, '@typespec', 'compiler', 'cmd', 'tsp.js');
  const invocation = resolveCommandInvocation(shim, ['--version'], {
    platform: 'win32',
    cwd: join('C:', 'workspace'),
    fileExists: (candidate) => candidate === compilerCli,
  });

  assert.equal(invocation.executable, process.execPath);
  assert.deepEqual(invocation.args, [compilerCli, '--version']);
  assert.equal(invocation.logicalCommand, shim);
});

test('bare tsp.cmd from PATH resolves through the pinned local TypeSpec JavaScript CLI', () => {
  const cwd = join('C:', 'workspace');
  const compilerCli = join(cwd, 'node_modules', '@typespec', 'compiler', 'cmd', 'tsp.js');
  const invocation = resolveCommandInvocation('tsp.cmd', ['compile', 'contract.tsp'], {
    platform: 'win32',
    cwd,
    fileExists: (candidate) => candidate === compilerCli,
  });

  assert.equal(invocation.executable, process.execPath);
  assert.deepEqual(invocation.args, [compilerCli, 'compile', 'contract.tsp']);
  assert.equal(invocation.logicalCommand, 'tsp.cmd');
});

test('non-TypeSpec command shims are not routed through a shell or rewritten', () => {
  const command = join('C:', 'workspace', 'node_modules', '.bin', 'other.cmd');
  const invocation = resolveCommandInvocation(command, ['--version'], {
    platform: 'win32',
    cwd: join('C:', 'workspace'),
    fileExists: () => false,
  });

  assert.equal(invocation.executable, command);
  assert.deepEqual(invocation.args, ['--version']);
  assert.equal(invocation.logicalCommand, command);
});

test('POSIX TypeSpec launch stays unchanged', () => {
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
