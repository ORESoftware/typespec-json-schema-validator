export function resolveNpmInvocation(args, options = {}) {
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const npmExecPath = typeof env.npm_execpath === 'string' ? env.npm_execpath.trim() : '';

  // npm sets npm_execpath for npm-run scripts. Invoking that JavaScript entrypoint
  // through the current Node executable avoids the Windows .cmd spawning boundary
  // without enabling shell interpolation.
  if (/\.(?:c?js|mjs)$/iu.test(npmExecPath)) {
    return {
      executable: execPath,
      args: [npmExecPath, ...args],
      logicalCommand: 'npm',
    };
  }

  return {
    executable: platform === 'win32' ? 'npm.cmd' : 'npm',
    args: [...args],
    logicalCommand: 'npm',
  };
}
