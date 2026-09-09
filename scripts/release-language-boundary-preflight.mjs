#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_CAPTURE_BYTES = 1024 * 1024;

export const BOUNDARY_RELEASE_PREFLIGHT_SCHEMA =
  'ores.tjsv-language-boundary-release-preflight/v1';

export const BOUNDARY_PACKAGE_EXPORTS = Object.freeze({
  './language-boundary-verification': Object.freeze({
    import: './src/language-boundary-verification.mjs',
    types: './src/language-boundary-verification.d.mts',
  }),
  './schema/language-boundaries': './schema/language-boundaries.schema.json',
  './schema/language-boundary-evidence': './schema/language-boundary-evidence.schema.json',
  './schema/language-boundary-verification': './schema/language-boundary-verification.schema.json',
});

export const REQUIRED_BOUNDARY_PACK_PATHS = Object.freeze([
  'schema/language-boundaries.schema.json',
  'schema/language-boundary-evidence.schema.json',
  'schema/language-boundary-verification.schema.json',
  'src/language-boundary-verification.d.mts',
  'src/language-boundary-verification.mjs',
]);

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function canonical(value) {
  return JSON.stringify(value);
}

export function validateBoundaryPackageContract(packageJson, packOutput) {
  assertRecord(packageJson, 'package.json');
  assertRecord(packageJson.exports, 'package.json exports');

  for (const [subpath, expected] of Object.entries(BOUNDARY_PACKAGE_EXPORTS)) {
    if (canonical(packageJson.exports[subpath]) !== canonical(expected)) {
      throw new Error(`boundary package export is missing or changed: ${subpath}`);
    }
  }

  if (!Array.isArray(packOutput) || packOutput.length !== 1) {
    throw new Error('npm pack must return exactly one package result');
  }
  const metadata = packOutput[0];
  assertRecord(metadata, 'npm pack result');
  if (metadata.name !== packageJson.name || metadata.version !== packageJson.version) {
    throw new Error('npm pack identity does not match package.json');
  }
  if (!Array.isArray(metadata.files)) {
    throw new Error('npm pack file inventory is missing');
  }

  const paths = new Set();
  for (const entry of metadata.files) {
    assertRecord(entry, 'npm pack file entry');
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      throw new Error('npm pack file path must be a nonempty string');
    }
    if (paths.has(entry.path)) {
      throw new Error(`npm pack returned duplicate file path: ${entry.path}`);
    }
    paths.add(entry.path);
  }

  for (const required of REQUIRED_BOUNDARY_PACK_PATHS) {
    if (!paths.has(required)) {
      throw new Error(`required language-boundary release file is absent from npm pack: ${required}`);
    }
  }

  return Object.freeze({
    name: metadata.name,
    version: metadata.version,
    filename: metadata.filename,
    requiredFiles: REQUIRED_BOUNDARY_PACK_PATHS,
  });
}

function appendBounded(chunks, state, chunk) {
  if (state.bytes >= MAX_CAPTURE_BYTES) return;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = MAX_CAPTURE_BYTES - state.bytes;
  chunks.push(buffer.subarray(0, remaining));
  state.bytes += Math.min(buffer.length, remaining);
}

function runProcess(command, args, cwd, label) {
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
    throw new Error(`${label} failed with ${termination}`);
  }
  return result;
}

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function verifyCleanBoundaryConsumer(consumerDirectory, tarballPath) {
  await mkdir(consumerDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({
      name: 'tjsv-language-boundary-preflight-consumer',
      private: true,
      type: 'module',
    }, null, 2)}\n`,
    { mode: 0o600 },
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
      tarballPath,
    ],
    consumerDirectory,
    'language-boundary clean consumer installation',
  );

  const probe = String.raw`
    import { readFile } from 'node:fs/promises';

    const packageName = '@oresoftware/typespec-json-schema-validator';
    const boundary = await import(packageName + '/language-boundary-verification');
    const expected = {
      LANGUAGE_BOUNDARY_MANIFEST_SCHEMA: 'ores.typespec-json-schema-validator.language-boundaries/v1',
      LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
      LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA: 'ores.typespec-json-schema-validator.language-boundary-verification/v1',
    };
    if (typeof boundary.verifyLanguageBoundaries !== 'function') {
      throw new Error('missing public verifyLanguageBoundaries export');
    }
    for (const [name, value] of Object.entries(expected)) {
      if (boundary[name] !== value) throw new Error('unexpected boundary schema constant: ' + name);
    }
    const receipt = boundary.verifyLanguageBoundaries();
    if (receipt.status !== 'stopped_for_evaluation') {
      throw new Error('empty boundary verification must fail closed');
    }
    if (receipt.schema !== expected.LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA) {
      throw new Error('boundary verification receipt schema mismatch');
    }
    if (!Object.isFrozen(receipt)) throw new Error('boundary verification receipt must be frozen');

    const schemas = [
      ['schema/language-boundaries', expected.LANGUAGE_BOUNDARY_MANIFEST_SCHEMA],
      ['schema/language-boundary-evidence', expected.LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA],
      ['schema/language-boundary-verification', expected.LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA],
    ];
    for (const [subpath, schemaId] of schemas) {
      const url = import.meta.resolve(packageName + '/' + subpath);
      const document = JSON.parse(await readFile(new URL(url), 'utf8'));
      if (document.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
        throw new Error('boundary schema is not explicit Draft 2020-12: ' + subpath);
      }
      if (document.properties?.schema?.const !== schemaId) {
        throw new Error('boundary schema wire identity mismatch: ' + subpath);
      }
    }
  `;

  await runChecked(
    process.execPath,
    ['--input-type=module', '--eval', probe],
    consumerDirectory,
    'public language-boundary package probe',
  );
}

export async function runBoundaryReleasePreflight() {
  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const workspace = await mkdtemp(join(tmpdir(), 'tjsv-language-boundary-preflight-'));
  try {
    const packDirectory = join(workspace, 'pack');
    const consumerDirectory = join(workspace, 'consumer');
    await mkdir(packDirectory, { recursive: true, mode: 0o700 });

    const packed = await runChecked(
      npmExecutable(),
      ['pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory],
      ROOT,
      'language-boundary npm pack',
    );
    let packOutput;
    try {
      packOutput = JSON.parse(packed.stdout);
    } catch (error) {
      throw new Error('language-boundary npm pack did not return one JSON document', { cause: error });
    }

    const metadata = validateBoundaryPackageContract(packageJson, packOutput);
    if (typeof metadata.filename !== 'string' || metadata.filename.length === 0) {
      throw new Error('language-boundary npm pack filename is missing');
    }
    const tarballPath = join(packDirectory, metadata.filename);
    const tarballInfo = await stat(tarballPath);
    if (!tarballInfo.isFile()) throw new Error('language-boundary npm pack did not create a tarball');

    await verifyCleanBoundaryConsumer(consumerDirectory, tarballPath);
    const receipt = Object.freeze({
      schema: BOUNDARY_RELEASE_PREFLIGHT_SCHEMA,
      status: 'passed',
      package: metadata.name,
      version: metadata.version,
      boundaryExport: './language-boundary-verification',
      requiredFiles: REQUIRED_BOUNDARY_PACK_PATHS,
      checks: Object.freeze({
        exactExports: true,
        packedBoundaryFiles: true,
        cleanConsumerInstall: true,
        publicBoundaryImport: true,
        publicSchemaResolution: true,
        emptyInputFailsClosed: true,
      }),
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return receipt;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  runBoundaryReleasePreflight().catch((error) => {
    process.stderr.write(`language-boundary release preflight failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
