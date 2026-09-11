#!/usr/bin/env node

import { installWindowsShellFreeSpawnAdapter } from './windows-shellfree-spawn.mjs';

const restoreSpawn = installWindowsShellFreeSpawnAdapter();

try {
  const [{ runReleasePreflight }, { runBoundaryReleasePreflight }] = await Promise.all([
    import('./release-preflight.mjs'),
    import('./release-language-boundary-preflight.mjs'),
  ]);
  await runReleasePreflight();
  await runBoundaryReleasePreflight();
} finally {
  restoreSpawn();
}
