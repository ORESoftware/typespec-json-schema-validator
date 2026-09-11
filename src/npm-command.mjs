import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

function requireArgv(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\u0000'))) {
    throw new TypeError('npm arguments must be an array of NUL-free strings');
  }
  return [...args];
}

function isWithin(base, candidate, pathApi) {
  const relative = pathApi.relative(base, candidate);
  return relative === ''
    || (!pathApi.isAbsolute(relative)
      && relative !== '..'
      && !relative.startsWith(`..${pathApi.sep}`));
}

/**
 * Resolve a shell-free npm invocation.
 *
 * On Windows, npm is exposed through a .cmd shim that Node cannot execute with
 * shell:false. Composite actions invoke this project through `node` directly,
 * so npm_execpath is not guaranteed to exist. Prefer the npm CLI shipped next
 * to the active Node runtime and only accept npm_execpath when it is an
 * absolute existing path inside that same Node installation root.
 */
export function resolveNpmLaunch(args, {
  platform = process.platform,
  execPath = process.execPath,
  env = process.env,
  exists = existsSync,
} = {}) {
  const argv = requireArgv(args);
  if (platform !== 'win32') {
    return { command: 'npm', args: argv, source: 'path' };
  }

  const pathApi = win32;
  if (typeof execPath !== 'string' || !pathApi.isAbsolute(execPath)) {
    throw new Error('Node executable path must be absolute on Windows');
  }

  const nodeRoot = pathApi.dirname(execPath);
  const bundledCli = pathApi.resolve(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (exists(bundledCli)) {
    return {
      command: execPath,
      args: [bundledCli, ...argv],
      source: 'node-bundled-cli',
    };
  }

  const configuredCli = env?.npm_execpath;
  if (
    typeof configuredCli === 'string'
    && pathApi.isAbsolute(configuredCli)
    && isWithin(nodeRoot, configuredCli, pathApi)
    && exists(configuredCli)
  ) {
    return {
      command: execPath,
      args: [configuredCli, ...argv],
      source: 'trusted-npm-execpath',
    };
  }

  throw new Error('npm CLI JS entry point is unavailable inside the active Windows Node installation');
}
