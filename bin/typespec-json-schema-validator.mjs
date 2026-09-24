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
      await access(path.join(candidate, 'src', 'cli.mjs'));
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
const [{ main }, { runConfigCommand }] = await Promise.all([
  import(pathToFileURL(path.join(package_root, 'src', 'cli.mjs')).href),
  import(pathToFileURL(path.join(package_root, 'src', 'config-cli.mjs')).href),
]);

process.exitCode = process.argv[2] === 'config'
  ? await runConfigCommand(process.argv)
  : await main(process.argv);
