import { statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

function defaultIsFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function resolveNpmInvocation({
  command,
  args,
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  isFile = defaultIsFile,
}) {
  if (!Array.isArray(args)) throw new TypeError('args must be an array');

  if (command !== 'npm' || platform !== 'win32') {
    return { executable: command, argv: [...args], source: 'direct-command', error: null };
  }

  if (typeof execPath !== 'string' || !isAbsolute(execPath)) {
    return {
      executable: null,
      argv: [],
      source: 'unavailable',
      error: new Error('Node executable path is unavailable or not absolute on Windows'),
    };
  }

  const candidates = [];
  if (typeof npmExecPath === 'string' && npmExecPath.trim() !== '' && isAbsolute(npmExecPath)) {
    candidates.push({ path: npmExecPath, source: 'npm_execpath' });
  }
  candidates.push({
    path: resolve(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    source: 'node-adjacent-npm-cli',
  });

  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    if (!isFile(candidate.path)) continue;
    return {
      executable: execPath,
      argv: [candidate.path, ...args],
      source: candidate.source,
      error: null,
    };
  }

  return {
    executable: null,
    argv: [],
    source: 'unavailable',
    error: new Error('npm CLI JavaScript entrypoint is unavailable on Windows'),
  };
}
