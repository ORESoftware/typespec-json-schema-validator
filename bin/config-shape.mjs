#!/usr/bin/env node

import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const launcher_dir = path.dirname(fileURLToPath(import.meta.url));

async function resolve_package_root() {
  const candidates = [
    path.resolve(launcher_dir, '..'),
    path.resolve(launcher_dir, '..', 'oresoftware', 'typespec-json-schema-validator'),
  ];

  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, 'src', 'config-cli.mjs'));
      return candidate;
    } catch {
      // Try the next supported package-manager layout.
    }
  }

  throw new Error(
    `unable to locate @oresoftware/typespec-json-schema-validator from launcher ${fileURLToPath(import.meta.url)}`,
  );
}

const package_root = await resolve_package_root();
const { runConfigCommand } = await import(
  pathToFileURL(path.join(package_root, 'src', 'config-cli.mjs')).href
);

// `tjsv-config` is a compatibility entrypoint only. The root `.cli-flags.toml`
// remains the sole argv/env/type/default authority; inject the canonical
// `config` command and delegate all parsing/execution to the shared runner.
const argv = [process.argv[0], process.argv[1], 'config', ...process.argv.slice(2)];
process.exitCode = await runConfigCommand(argv);
