import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function create_hoisted_layout() {
  const temp_root = await mkdtemp(path.join(os.tmpdir(), 'tjsv-zed-hoisted-'));
  const modules_dir = path.join(temp_root, '.vendor', '.zed');
  const package_root = path.join(
    modules_dir,
    'oresoftware',
    'typespec-json-schema-validator',
  );
  const bin_dir = path.join(modules_dir, '.bin');

  await mkdir(path.dirname(package_root), { recursive: true });
  await symlink(repo_root, package_root, process.platform === 'win32' ? 'junction' : 'dir');
  await mkdir(bin_dir, { recursive: true });
  await copyFile(
    path.join(repo_root, 'bin', 'typespec-json-schema-validator.mjs'),
    path.join(bin_dir, 'tjsv'),
  );
  await copyFile(
    path.join(repo_root, 'bin', 'config-shape.mjs'),
    path.join(bin_dir, 'tjsv-config'),
  );

  return { temp_root, bin_dir };
}

function run_node(entrypoint, args) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: repo_root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });
}

test('zed-hoisted tjsv launcher resolves imports from the installed package tree', async (t) => {
  const { temp_root, bin_dir } = await create_hoisted_layout();
  t.after(async () => rm(temp_root, { recursive: true, force: true }));

  const result = run_node(path.join(bin_dir, 'tjsv'), ['doctor', '--quiet']);

  assert.equal(
    result.status,
    0,
    `hoisted tjsv failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});

test('zed-hoisted tjsv-config launcher resolves imports from the installed package tree', async (t) => {
  const { temp_root, bin_dir } = await create_hoisted_layout();
  t.after(async () => rm(temp_root, { recursive: true, force: true }));

  const result = run_node(path.join(bin_dir, 'tjsv-config'), ['--help']);

  assert.equal(
    result.status,
    0,
    `hoisted tjsv-config failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
