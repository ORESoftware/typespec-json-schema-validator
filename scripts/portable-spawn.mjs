import { win32 as win32Path } from 'node:path';

const TJSV_ALIASES = new Set([
  'tjsv.cmd',
  'tsjsv.cmd',
  'typespec-json-schema-validator.cmd',
]);

function isCmdShim(command) {
  return typeof command === 'string' && /\.cmd$/iu.test(command);
}

export function resolvePortableSpawn(command, args = [], options = {}) {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const npmExecPath = options.npmExecPath ?? process.env.npm_execpath ?? '';

  if (platform !== 'win32' || !isCmdShim(command)) {
    return Object.freeze({ command, args: [...args] });
  }

  const basename = win32Path.basename(command).toLowerCase();
  if (basename === 'npm.cmd') {
    const npmCli = npmExecPath && !isCmdShim(npmExecPath)
      ? npmExecPath
      : win32Path.join(
        win32Path.dirname(command),
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js',
      );
    return Object.freeze({ command: execPath, args: [npmCli, ...args] });
  }

  if (TJSV_ALIASES.has(basename)) {
    const consumerDirectory = win32Path.dirname(
      win32Path.dirname(win32Path.dirname(command)),
    );
    const canonicalCli = win32Path.join(
      consumerDirectory,
      'node_modules',
      '@oresoftware',
      'typespec-json-schema-validator',
      'bin',
      'typespec-json-schema-validator.mjs',
    );
    return Object.freeze({ command: execPath, args: [canonicalCli, ...args] });
  }

  throw new Error(`release preflight refuses unapproved Windows command shim: ${basename}`);
}
