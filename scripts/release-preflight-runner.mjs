#!/usr/bin/env node

import { createRequire, syncBuiltinESMExports } from 'node:module';

import { resolvePortableSpawn } from './portable-spawn.mjs';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;

childProcess.spawn = function portableSpawn(command, args = [], options = {}) {
  const resolved = resolvePortableSpawn(command, args);
  return originalSpawn(resolved.command, resolved.args, options);
};
syncBuiltinESMExports();

const { runReleasePreflight } = await import('./release-preflight.mjs');

runReleasePreflight().catch((error) => {
  process.stderr.write(`release preflight failed: ${error.message}\n`);
  process.exitCode = 1;
});
