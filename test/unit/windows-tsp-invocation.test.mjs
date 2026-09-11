import test from 'node:test';
import assert from 'node:assert/strict';
import { join, normalize } from 'node:path';
import { overlayNodeModuleCandidate, resolveCommandInvocation } from '../../src/emitter.mjs';

function assertInvocationPath(actual, expected) {
  assert.equal(normalize(actual), normalize(expected));
}

test('Windows tsp.cmd shims run through the pinned TypeSpec JavaScript CLI without a shell', () => {
  const root = join('C:', 'workspace', 'node_modules');
  const shim = join(root, '.bin', 'tsp.cmd');
  const compilerCli = join(root, '@typespec', 'compiler', 'cmd', 'tsp.js');
  const invocation = resolveCommandInvocation(shim, ['--version'], {
    platform: 'win32',
    cwd: join('C:', 'workspace'),
    fileExists: (candidate) => normalize(candidate) === normalize(compilerCli),
  });

  assert.equal(invocation.executable, process.execPath);
  assertInvocationPath(invocation.args[0], compilerCli);
  assert.deepEqual(invocation.args.slice(1), ['--version']);
  assertInvocationPath(invocation.logicalCommand, shim);
});

test('bare tsp.cmd from PATH resolves through the pinned local TypeSpec JavaScript CLI', () => {
  const cwd = join('C:', 'workspace');
  const compilerCli = join(cwd, 'node_modules', '@typespec', 'compiler', 'cmd', 'tsp.js');
  const invocation = resolveCommandInvocation('tsp.cmd', ['compile', 'contract.tsp'], {
    platform: 'win32',
    cwd,
    fileExists: (candidate) => normalize(candidate) === normalize(compilerCli),
  });

  assert.equal(invocation.executable, process.execPath);
  assertInvocationPath(invocation.args[0], compilerCli);
  assert.deepEqual(invocation.args.slice(1), ['compile', 'contract.tsp']);
  assert.equal(invocation.logicalCommand, 'tsp.cmd');
});

test('explicit JavaScript TypeSpec binaries run through Node on Windows', () => {
  const command = join('C:', 'workspace', 'test', 'helpers', 'fake-tsp.mjs');
  const invocation = resolveCommandInvocation(command, ['compile', 'contract.tsp'], {
    platform: 'win32',
    cwd: join('C:', 'workspace'),
    fileExists: (candidate) => normalize(candidate) === normalize(command),
  });

  assert.equal(invocation.executable, process.execPath);
  assertInvocationPath(invocation.args[0], command);
  assert.deepEqual(invocation.args.slice(1), ['compile', 'contract.tsp']);
  assertInvocationPath(invocation.logicalCommand, command);
});

test('module overlays normalize Windows and mixed separators before mapping to pinned dependencies', () => {
  for (const missing of [
    String.raw`D:\temp\fixture\node_modules\@typespec\json-schema\package.json`,
    'D:\\temp\\fixture/node_modules/@typespec/json-schema/package.json',
  ]) {
    const candidate = overlayNodeModuleCandidate(missing);
    assert.ok(candidate);
    assert.notEqual(candidate, missing);
    assert.ok(
      normalize(candidate).endsWith(normalize(join(
        'node_modules',
        '@typespec',
        'json-schema',
        'package.json',
      ))),
      candidate,
    );
  }
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
