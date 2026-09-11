import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const fixtures = resolve(packageRoot, 'test/fixtures/pass');

/**
 * Keep the packaged-consumer integration shell-free on Windows.
 *
 * npm is exposed as npm.cmd there, and spawning a .cmd shim directly is not a
 * portable shell-free process boundary. npm itself publishes the JavaScript
 * entrypoint used to launch the current npm process as npm_execpath, so execute
 * that exact pinned CLI with the current Node runtime rather than introducing a
 * command shell or reconstructing an npm installation path.
 */
function npmInvocation(args) {
  if (process.platform !== 'win32') {
    return { command: 'npm', args: [...args] };
  }

  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Windows packaged-consumer tests require npm_execpath from the npm test lifecycle');
  return { command: process.execPath, args: [npmCli, ...args] };
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
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

async function runNpmChecked(args, cwd, label) {
  const invocation = npmInvocation(args);
  return runChecked(invocation.command, invocation.args, cwd, label);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('packed TJSV validates external authorities across legal npm dependency layouts', { timeout: 180_000 }, async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tjsv-packaged-external-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const packDirectory = join(workspace, 'pack');
  const installDirectory = join(workspace, 'install');
  const externalDirectory = join(workspace, 'external-authorities');
  await mkdir(packDirectory, { recursive: true });
  await mkdir(installDirectory, { recursive: true });
  await mkdir(externalDirectory, { recursive: true });

  const packed = await runNpmChecked(
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
  await runNpmChecked(
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
  await runNpmChecked(
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
  const hasHoistedEmitter = await exists(hoistedEmitter);
  const hasNestedEmitter = await exists(nestedEmitter);
  assert.equal(
    hasHoistedEmitter || hasNestedEmitter,
    true,
    'clean installation must contain @typespec/json-schema in a legal npm dependency layout',
  );

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
