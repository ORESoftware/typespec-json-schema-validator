import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { normalizeWindowsShellFreeSpawn } from '../../scripts/windows-shellfree-spawn.mjs';

const packageRoot = resolve(import.meta.dirname, '../..');
const fixtures = resolve(packageRoot, 'test/fixtures/pass');

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const launch = normalizeWindowsShellFreeSpawn(command, args);
    const child = spawn(launch.command, launch.args, {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectPromise);
    child.once('close', (code, signal) => {
      resolvePromise({ code: code ?? -1, signal: signal ?? null, stdout, stderr });
    });
  });
}

async function runChecked(command, args, cwd, label) {
  const result = await run(command, args, cwd);
  assert.equal(result.signal, null, `${label} terminated by ${result.signal}`);
  assert.equal(result.code, 0, `${label} failed\n${result.stderr || result.stdout}`);
  return result;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('packed TJSV validates authorities outside the install tree when TypeSpec dependencies are hoisted', { timeout: 180_000 }, async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tjsv-packaged-external-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const packDirectory = join(workspace, 'pack');
  const installDirectory = join(workspace, 'install');
  const externalDirectory = join(workspace, 'external-authorities');
  await mkdir(packDirectory, { recursive: true });
  await mkdir(installDirectory, { recursive: true });
  await mkdir(externalDirectory, { recursive: true });

  const packed = await runChecked(
    npmExecutable(),
    ['pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory],
    packageRoot,
    'npm pack',
  );
  const metadata = JSON.parse(packed.stdout);
  assert.equal(metadata.length, 1, 'npm pack must return one package');
  const tarball = join(packDirectory, metadata[0].filename);

  await writeFile(
    join(installDirectory, 'package.json'),
    `${JSON.stringify({ name: 'tjsv-packaged-external-consumer', private: true }, null, 2)}\n`,
  );
  await runChecked(
    npmExecutable(),
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--package-lock=false',
      tarball,
    ],
    installDirectory,
    'clean packaged installation',
  );
  await runChecked(
    npmExecutable(),
    ['rebuild', '@oresoftware/f2e', '--foreground-scripts', '--no-audit', '--no-fund'],
    installDirectory,
    'approved flags-2-env native rebuild',
  );

  const installedPackage = join(
    installDirectory,
    'node_modules',
    '@oresoftware',
    'typespec-json-schema-validator',
  );
  const hoistedEmitter = join(installDirectory, 'node_modules', '@typespec', 'json-schema');
  const nestedEmitter = join(installedPackage, 'node_modules', '@typespec', 'json-schema');
  assert.equal(await exists(hoistedEmitter), true, 'fixture must exercise a hoisted TypeSpec emitter');
  assert.equal(await exists(nestedEmitter), false, 'fixture must not accidentally exercise package-local dependencies');

  const typespec = join(externalDirectory, 'main.tsp');
  const authored = join(externalDirectory, 'authored.schema.json');
  const report = join(externalDirectory, 'report.json');
  const generated = join(externalDirectory, 'generated');
  await copyFile(join(fixtures, 'main.tsp'), typespec);
  await copyFile(join(fixtures, 'authored.schema.json'), authored);

  const executable = join(installedPackage, 'bin', 'typespec-json-schema-validator.mjs');
  const checked = await run(
    process.execPath,
    [
      executable,
      'check',
      `--typespec=${typespec}`,
      `--schema=${authored}`,
      `--report=${report}`,
      `--output-dir=${generated}`,
      '--quiet',
    ],
    installDirectory,
  );
  assert.equal(checked.signal, null, `packaged TJSV terminated by ${checked.signal}`);
  assert.equal(checked.code, 0, checked.stderr || checked.stdout);

  const receipt = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.configuration.executionMode, 'pinned-compiler-fallback');
  assert.equal(receipt.configuration.emitter, '@typespec/json-schema');
});
