import childProcess, { spawn as originalSpawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { win32 } from 'node:path';

const PACKAGE_ALIASES = new Set([
  'tjsv.cmd',
  'tsjsv.cmd',
  'typespec-json-schema-validator.cmd',
]);

/**
 * Translate only the Windows command shims owned by release preflight into
 * direct Node argv. No shell is enabled and no command string is interpolated.
 */
export function normalizeWindowsShellFreeSpawn(command, args = [], options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return { command, args: [...args] };

  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const commandText = String(command);
  const commandName = win32.basename(commandText).toLowerCase();

  if (commandName === 'npm.cmd') {
    const npmExecPath = options.npmExecPath ?? process.env.npm_execpath;
    if (typeof npmExecPath !== 'string' || !win32.isAbsolute(npmExecPath)) {
      throw new Error('npm_execpath is unavailable or not absolute on Windows');
    }
    return { command: nodeExecutable, args: [npmExecPath, ...args] };
  }

  if (PACKAGE_ALIASES.has(commandName) && win32.isAbsolute(commandText)) {
    const binDirectory = win32.dirname(commandText);
    if (win32.basename(binDirectory).toLowerCase() !== '.bin') {
      return { command, args: [...args] };
    }
    const packageBin = win32.join(
      binDirectory,
      '..',
      '@oresoftware',
      'typespec-json-schema-validator',
      'bin',
      'typespec-json-schema-validator.mjs',
    );
    return { command: nodeExecutable, args: [packageBin, ...args] };
  }

  return { command, args: [...args] };
}

/**
 * Patch the process-local child_process.spawn binding used by the two release
 * preflight modules. This process is dedicated to release preflight, so the
 * adapter stays narrowly scoped and is restored before exit.
 */
export function installWindowsShellFreeSpawnAdapter(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return () => {};

  const baseSpawn = options.spawn ?? originalSpawn;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const npmExecPath = options.npmExecPath ?? process.env.npm_execpath;

  childProcess.spawn = (command, args = [], spawnOptions = {}) => {
    const launch = normalizeWindowsShellFreeSpawn(command, args, {
      platform,
      nodeExecutable,
      npmExecPath,
    });
    return baseSpawn(launch.command, launch.args, spawnOptions);
  };
  syncBuiltinESMExports();

  return () => {
    childProcess.spawn = baseSpawn;
    syncBuiltinESMExports();
  };
}
