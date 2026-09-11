import { statSync } from 'node:fs';
import { win32 } from 'node:path';

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

  if (typeof execPath !== 'string' || !win32.isAbsolute(execPath)) {
    return {
      executable: null,
      argv: [],
      source: 'unavailable',
      error: new Error('Node executable path is unavailable or not absolute on Windows'),
    };
  }

  const candidates = [];
  if (
    typeof npmExecPath === 'string' &&
    npmExecPath.trim() !== '' &&
    win32.isAbsolute(npmExecPath)
  ) {
    candidates.push({ path: win32.normalize(npmExecPath), source: 'npm_execpath' });
  }
  candidates.push({
    path: win32.resolve(win32.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    source: 'node-adjacent-npm-cli',
  });

  const seen = new Set();
  for (const candidate of candidates) {
    const dedupeKey = candidate.path.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
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
