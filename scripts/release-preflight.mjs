#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_PACK_FILES = 4096;
const MAX_PACKED_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 1024 * 1024;

export const RELEASE_RECEIPT_SCHEMA = 'ores.tjsv-release-preflight/v1';

export const APPROVED_LIFECYCLE_REBUILDS = Object.freeze([
  '@oresoftware/f2e',
]);

export const REQUIRED_PACK_PATHS = Object.freeze([
  '.cli-flags.toml',
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'bin/typespec-json-schema-validator.mjs',
  'package.json',
  'schema/contract-ir.schema.json',
  'schema/report.schema.json',
  'src/index.d.ts',
  'src/index.mjs',
]);

const FORBIDDEN_DIRECTORIES = Object.freeze([
  '.git',
  '.github',
  '.typespec-json-schema-validator',
  'coverage',
  'env/dec',
  'examples',
  'node_modules',
  'out',
  'rollout',
  'scripts',
  'target',
  'temp',
  'test',
  'tmp',
]);

const FORBIDDEN_BASENAMES = new Set([
  '.env',
  '.npmrc',
  'credentials.json',
  'id_ed25519',
  'id_rsa',
  'package-lock.json',
  'service-account.json',
]);

const FORBIDDEN_EXTENSIONS = Object.freeze([
  '.der',
  '.jks',
  '.key',
  '.kdbx',
  '.p12',
  '.pem',
  '.pfx',
]);

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

export function normalizePackPath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.includes('\0')) {
    throw new TypeError('package file path must be a nonempty string without NUL bytes');
  }
  const path = rawPath.replaceAll('\\', '/');
  if (path.startsWith('/') || /^[A-Za-z]:\//u.test(path)) {
    throw new Error(`package file path must be relative: ${rawPath}`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`package file path is not normalized: ${rawPath}`);
  }
  return path;
}

export function assertSafePackPath(rawPath) {
  const path = normalizePackPath(rawPath);
  const lower = path.toLowerCase();
  const file = basename(lower);
  if (FORBIDDEN_BASENAMES.has(file) || (file.startsWith('.env.') && file !== '.env.example')) {
    throw new Error(`forbidden package file: ${path}`);
  }
  if (FORBIDDEN_EXTENSIONS.some((extension) => file.endsWith(extension))) {
    throw new Error(`secret-bearing file extension is not publishable: ${path}`);
  }
  for (const directory of FORBIDDEN_DIRECTORIES) {
    if (lower === directory || lower.startsWith(`${directory}/`)) {
      throw new Error(`development-only directory is not publishable: ${path}`);
    }
  }
  return path;
}

export function packManifestDigest(files) {
  const normalized = files
    .map((file) => ({ path: file.path, size: file.size, mode: file.mode ?? null }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function validatePackMetadata(packageJson, packOutput) {
  assertRecord(packageJson, 'package.json');
  if (!Array.isArray(packOutput) || packOutput.length !== 1) {
    throw new Error('npm pack must return exactly one package result');
  }
  const metadata = packOutput[0];
  assertRecord(metadata, 'npm pack result');

  if (metadata.name !== packageJson.name || metadata.version !== packageJson.version) {
    throw new Error('npm pack identity does not match package.json');
  }
  if (typeof metadata.filename !== 'string' || basename(metadata.filename) !== metadata.filename) {
    throw new Error('npm pack filename must be a single relative basename');
  }
  if (!/^[0-9a-f]{40}$/u.test(metadata.shasum ?? '')) {
    throw new Error('npm pack did not return a valid SHA-1 shasum');
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(metadata.integrity ?? '')) {
    throw new Error('npm pack did not return a valid SHA-512 integrity value');
  }
  if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > MAX_PACKED_BYTES) {
    throw new Error('packed package size is missing, invalid, or above the release bound');
  }
  if (
    !Number.isSafeInteger(metadata.unpackedSize)
    || metadata.unpackedSize <= 0
    || metadata.unpackedSize > MAX_UNPACKED_BYTES
  ) {
    throw new Error('unpacked package size is missing, invalid, or above the release bound');
  }
  if (!Array.isArray(metadata.files) || metadata.files.length === 0 || metadata.files.length > MAX_PACK_FILES) {
    throw new Error('npm pack file inventory is empty or above the release bound');
  }

  const paths = new Set();
  const files = metadata.files.map((entry) => {
    assertRecord(entry, 'npm pack file entry');
    const path = assertSafePackPath(entry.path);
    if (paths.has(path)) {
      throw new Error(`npm pack returned duplicate file path: ${path}`);
    }
    paths.add(path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES) {
      throw new Error(`package file size is invalid or above the bound: ${path}`);
    }
    if (entry.mode !== undefined && (!Number.isSafeInteger(entry.mode) || entry.mode < 0)) {
      throw new Error(`package file mode is invalid: ${path}`);
    }
    return { path, size: entry.size, mode: entry.mode ?? null };
  });

  const inventoryBytes = files.reduce((total, file) => total + file.size, 0);
  if (inventoryBytes !== metadata.unpackedSize) {
    throw new Error(
      `npm pack unpackedSize ${metadata.unpackedSize} disagrees with file inventory ${inventoryBytes}`,
    );
  }
  for (const required of REQUIRED_PACK_PATHS) {
    if (!paths.has(required)) {
      throw new Error(`required release file is absent from npm pack: ${required}`);
    }
  }

  if (packageJson.publishConfig?.access !== 'public') {
    throw new Error('package publishConfig.access must explicitly remain public');
  }
  if (!/^@oresoftware\/[a-z0-9][a-z0-9._-]*$/u.test(packageJson.name ?? '')) {
    throw new Error('package name must remain in the @oresoftware scope');
  }
  if (!/^\d+\.\d+\.\d+$/u.test(packageJson.version ?? '')) {
    throw new Error('release preflight requires a stable semantic version');
  }
  const canonicalBin = packageJson.bin?.tjsv;
  if (
    canonicalBin !== './bin/typespec-json-schema-validator.mjs'
    || packageJson.bin?.tsjsv !== canonicalBin
    || packageJson.bin?.['typespec-json-schema-validator'] !== canonicalBin
  ) {
    throw new Error('tjsv and both compatibility aliases must share the canonical executable');
  }

  return Object.freeze({
    name: metadata.name,
    version: metadata.version,
    filename: metadata.filename,
    size: metadata.size,
    unpackedSize: metadata.unpackedSize,
    shasum: metadata.shasum,
    integrity: metadata.integrity,
    fileCount: files.length,
    manifestSha256: packManifestDigest(files),
    files: Object.freeze(files.sort((left, right) => left.path.localeCompare(right.path))),
  });
}

function appendBounded(chunks, state, chunk) {
  if (state.bytes >= MAX_CAPTURE_BYTES) return;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = MAX_CAPTURE_BYTES - state.bytes;
  chunks.push(buffer.subarray(0, remaining));
  state.bytes += Math.min(buffer.length, remaining);
}

async function runProcess(command, args, cwd, label) {
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
    const stdout = [];
    const stderr = [];
    const stdoutState = { bytes: 0 };
    const stderrState = { bytes: 0 };
    child.stdout.on('data', (chunk) => appendBounded(stdout, stdoutState, chunk));
    child.stderr.on('data', (chunk) => appendBounded(stderr, stderrState, chunk));
    child.once('error', (error) => {
      rejectPromise(new Error(`${label} could not start`, { cause: error }));
    });
    child.once('close', (code, signal) => {
      resolvePromise({
        code: code ?? -1,
        signal: signal ?? null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

async function runChecked(command, args, cwd, label) {
  const result = await runProcess(command, args, cwd, label);
  if (result.code !== 0) {
    const termination = result.signal === null ? `exit ${result.code}` : `signal ${result.signal}`;
    const error = new Error(`${label} failed with ${termination}`);
    error.result = result;
    throw error;
  }
  return result;
}

async function fileDigest(path, algorithm, encoding = 'hex') {
  const bytes = await readFile(path);
  return createHash(algorithm).update(bytes).digest(encoding);
}

export function resolveNpmInvocation(args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return { command: 'npm', args: [...args] };
  }

  const npmExecPath = options.npmExecPath ?? process.env.npm_execpath;
  if (typeof npmExecPath !== 'string' || !win32.isAbsolute(npmExecPath)) {
    throw new Error('npm_execpath must be an absolute path for shell-free Windows npm execution');
  }
  return {
    command: options.nodeExecutable ?? process.execPath,
    args: [npmExecPath, ...args],
  };
}

async function runNpmChecked(args, cwd, label) {
  const invocation = resolveNpmInvocation(args);
  return runChecked(invocation.command, invocation.args, cwd, label);
}

function installedBin(consumerDirectory, name, platform = process.platform) {
  return join(
    consumerDirectory,
    'node_modules',
    '.bin',
    platform === 'win32' ? `${name}.cmd` : name,
  );
}

function installedCanonicalBin(consumerDirectory) {
  return join(
    consumerDirectory,
    'node_modules',
    '@oresoftware',
    'typespec-json-schema-validator',
    'bin',
    'typespec-json-schema-validator.mjs',
  );
}

export function resolveInstalledAliasInvocation(consumerDirectory, alias, args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return {
      command: installedBin(consumerDirectory, alias, platform),
      args: [...args],
    };
  }
  return {
    command: options.nodeExecutable ?? process.execPath,
    args: [installedCanonicalBin(consumerDirectory), ...args],
  };
}

function describeDoctorFailure(alias, result) {
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // Keep diagnostics bounded and secret-free. The doctor command emits only
    // its version/availability receipt, never environment values.
  }
  const typespec = report?.typespec?.available === true ? 'available' : 'unavailable';
  const emitter = report?.jsonSchemaEmitter?.available === true ? 'available' : 'unavailable';
  return `${alias} doctor failed: TypeSpec ${typespec}, JSON Schema emitter ${emitter}`;
}

async function verifyCleanConsumer(consumerDirectory, tarballPath) {
  await mkdir(consumerDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ name: 'tjsv-release-preflight-consumer', private: true, type: 'module' }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await runNpmChecked(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--package-lock=false',
      tarballPath,
    ],
    consumerDirectory,
    'clean consumer installation',
  );

  // All lifecycle scripts remain blocked during installation. The sole
  // approved native build is then invoked explicitly, matching the checked-in
  // Zed package contract and preventing unrelated transitive scripts from
  // executing implicitly.
  for (const packageName of APPROVED_LIFECYCLE_REBUILDS) {
    await runNpmChecked(
      ['rebuild', packageName, '--foreground-scripts', '--no-audit', '--no-fund'],
      consumerDirectory,
      `approved lifecycle rebuild for ${packageName}`,
    );
  }

  const importProbe = [
    "const root = await import('@oresoftware/typespec-json-schema-validator');",
    "for (const name of ['runCheck', 'validateInstance', 'verifyContractIr']) {",
    "  if (typeof root[name] !== 'function') throw new Error(`missing root export ${name}`);",
    '}',
    "await import('@oresoftware/typespec-json-schema-validator/runtime-conformance');",
    "await import('@oresoftware/typespec-json-schema-validator/projection-admission');",
    "await import('@oresoftware/typespec-json-schema-validator/projection-verification');",
  ].join('\n');
  await runChecked(
    process.execPath,
    ['--input-type=module', '--eval', importProbe],
    consumerDirectory,
    'public package import probe',
  );

  const canonicalExecutable = installedCanonicalBin(consumerDirectory);
  const canonicalInfo = await stat(canonicalExecutable);
  if (!canonicalInfo.isFile()) {
    throw new Error('installed canonical CLI entrypoint is not a regular file');
  }

  const aliases = ['tjsv', 'tsjsv', 'typespec-json-schema-validator'];
  for (const alias of aliases) {
    const executable = installedBin(consumerDirectory, alias);
    const info = await stat(executable);
    if (!info.isFile()) {
      throw new Error(`installed CLI alias is not a regular file: ${alias}`);
    }
    const invocation = resolveInstalledAliasInvocation(
      consumerDirectory,
      alias,
      ['doctor', '--quiet'],
    );
    const result = await runProcess(
      invocation.command,
      invocation.args,
      consumerDirectory,
      `${alias} doctor`,
    );
    if (result.code !== 0) {
      throw new Error(describeDoctorFailure(alias, result));
    }
  }
  return aliases;
}

async function gitRevision() {
  const result = await runChecked('git', ['rev-parse', 'HEAD'], ROOT, 'git revision lookup');
  const revision = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error('git revision lookup returned an invalid commit identity');
  }
  const statusResult = await runChecked(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=no'],
    ROOT,
    'tracked working-tree check',
  );
  if (statusResult.stdout !== '') {
    throw new Error('release preflight requires a clean tracked working tree');
  }
  return revision;
}

async function writeReceipt(receipt, revision) {
  const directory = join(ROOT, 'tmp', 'release-preflight', revision);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, `${process.platform}-${process.arch}.json`);
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return path;
}

export async function runReleasePreflight() {
  const revision = await gitRevision();
  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const workspace = await mkdtemp(join(tmpdir(), 'tjsv-release-preflight-'));
  try {
    const packDirectory = join(workspace, 'pack');
    const consumerDirectory = join(workspace, 'consumer');
    await mkdir(packDirectory, { recursive: true, mode: 0o700 });
    const packed = await runNpmChecked(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory],
      ROOT,
      'npm pack',
    );
    let packOutput;
    try {
      packOutput = JSON.parse(packed.stdout);
    } catch (error) {
      throw new Error('npm pack did not return one JSON document', { cause: error });
    }
    const metadata = validatePackMetadata(packageJson, packOutput);
    const tarballPath = join(packDirectory, metadata.filename);
    const tarballInfo = await stat(tarballPath);
    if (!tarballInfo.isFile() || tarballInfo.size !== metadata.size) {
      throw new Error('created tarball does not match npm pack size metadata');
    }
    const actualSha1 = await fileDigest(tarballPath, 'sha1');
    const actualSha512 = await fileDigest(tarballPath, 'sha512', 'base64');
    const actualSha256 = await fileDigest(tarballPath, 'sha256');
    if (actualSha1 !== metadata.shasum) {
      throw new Error('created tarball SHA-1 does not match npm pack metadata');
    }
    if (`sha512-${actualSha512}` !== metadata.integrity) {
      throw new Error('created tarball SHA-512 does not match npm pack integrity metadata');
    }

    const aliases = await verifyCleanConsumer(consumerDirectory, tarballPath);
    const receipt = Object.freeze({
      schema: RELEASE_RECEIPT_SCHEMA,
      status: 'passed',
      sourceRevision: revision,
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      package: {
        name: metadata.name,
        version: metadata.version,
        registryAccess: packageJson.publishConfig.access,
        filename: metadata.filename,
        packedBytes: metadata.size,
        unpackedBytes: metadata.unpackedSize,
        fileCount: metadata.fileCount,
        manifestSha256: metadata.manifestSha256,
        tarballSha256: actualSha256,
        npmShasumSha1: metadata.shasum,
        npmIntegritySha512: metadata.integrity,
      },
      checks: {
        cleanTrackedTree: true,
        boundedPackInventory: true,
        requiredFilesPresent: true,
        forbiddenFilesAbsent: true,
        npmDigestsVerified: true,
        cleanConsumerInstall: true,
        implicitLifecycleScriptsBlocked: true,
        approvedLifecycleRebuilds: APPROVED_LIFECYCLE_REBUILDS,
        publicImports: true,
        cliAliases: aliases,
      },
      limitations: [
        'preflight does not publish a registry artifact or create a Git tag',
        'preflight does not prove npm account ownership, provenance attestation, or post-publication immutability',
      ],
    });
    const receiptPath = await writeReceipt(receipt, revision);
    process.stdout.write(`${JSON.stringify({ ...receipt, receiptPath: relative(ROOT, receiptPath) })}\n`);
    return { receipt, receiptPath };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  runReleasePreflight().catch((error) => {
    process.stderr.write(`release preflight failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
