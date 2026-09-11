import { spawn } from 'node:child_process';
import { access, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, formatDiagnostic, NodeHost, resolveCompilerOptions } from '@typespec/compiler';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_CAPTURE_BYTES = 256 * 1024;

function resolveJsonSchemaEmitter() {
  try {
    return fileURLToPath(import.meta.resolve('@typespec/json-schema'));
  } catch (error) {
    throw new Error(`the installed @typespec/json-schema emitter could not be resolved: ${error.message}`, {
      cause: error,
    });
  }
}

/**
 * TypeSpec normalizes compiler paths to forward slashes on some Windows code paths.
 * Accept either separator here so the pinned fallback can map a missing consumer
 * node_modules probe into TJSV's own immutable dependency tree on every platform.
 */
export function nodeModuleOverlayCandidate(path, moduleRoot = MODULE_ROOT) {
  const segments = String(path).split(/[\\/]+/u);
  const nodeModulesIndex = segments.lastIndexOf('node_modules');
  if (nodeModulesIndex < 0) {
    return null;
  }
  return join(moduleRoot, 'node_modules', ...segments.slice(nodeModulesIndex + 1));
}

async function overlayNodeModulePath(path) {
  if (await exists(path)) {
    return path;
  }
  const candidate = nodeModuleOverlayCandidate(path);
  return candidate && await exists(candidate) ? candidate : path;
}

function createPinnedCompilerHost() {
  return {
    ...NodeHost,
    logSink: { log() {} },
    async stat(path) {
      return NodeHost.stat(await overlayNodeModulePath(path));
    },
    async realpath(path) {
      return NodeHost.realpath(await overlayNodeModulePath(path));
    },
    async readFile(path) {
      return NodeHost.readFile(await overlayNodeModulePath(path));
    },
    async readDir(path) {
      return NodeHost.readDir(await overlayNodeModulePath(path));
    },
    async getJsImport(path) {
      return NodeHost.getJsImport(await overlayNodeModulePath(path));
    },
  };
}

function formatCompilerDiagnostics(diagnostics, pathRelativeTo) {
  return diagnostics
    .map((diagnostic) => formatDiagnostic(diagnostic, { pretty: false, pathRelativeTo }))
    .join('\n');
}

async function emitWithPinnedCompiler({ entry, cwd, outputDir, emitterPath, emitterOptions }) {
  const host = createPinnedCompilerHost();
  const [resolvedOptions, configDiagnostics] = await resolveCompilerOptions(host, {
    entrypoint: entry,
    cwd,
  });
  if (configDiagnostics.length > 0) {
    throw new Error(formatCompilerDiagnostics(configDiagnostics, cwd));
  }

  const options = {
    ...resolvedOptions,
    outputDir,
    emit: [emitterPath],
    warningAsError: true,
    options: {
      ...(resolvedOptions.options ?? {}),
      '@typespec/json-schema': {
        ...(resolvedOptions.options?.['@typespec/json-schema'] ?? {}),
        ...emitterOptions,
      },
    },
  };
  const program = await compile(host, entry, options);
  if (program.hasError()) {
    throw new Error(formatCompilerDiagnostics(program.diagnostics, cwd));
  }
  return program;
}

function commandFailureDetail(result) {
  return [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function appendBounded(current, chunk, maxBytes) {
  const combined = `${current}${chunk}`;
  if (Buffer.byteLength(combined) <= maxBytes) {
    return combined;
  }
  const buffer = Buffer.from(combined);
  return buffer.subarray(buffer.length - maxBytes).toString('utf8');
}

/**
 * Keep Windows execution shell-free while translating the two executable forms
 * TJSV legitimately owns: npm's local tsp.cmd shim and explicit Node scripts
 * used as a TypeSpec command in tests/consumers. All argv remains tokenized.
 */
export function normalizeSpawnCommand(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  if (platform !== 'win32') return { command, args: [...args] };

  const extension = win32.extname(command).toLowerCase();
  if (win32.isAbsolute(command) && ['.js', '.mjs', '.cjs'].includes(extension)) {
    return { command: nodeExecutable, args: [command, ...args] };
  }

  const directory = win32.dirname(command);
  if (
    win32.isAbsolute(command)
    && win32.basename(command).toLowerCase() === 'tsp.cmd'
    && win32.basename(directory).toLowerCase() === '.bin'
  ) {
    return {
      command: nodeExecutable,
      args: [win32.join(directory, '..', '@typespec', 'compiler', 'cmd', 'tsp.js'), ...args],
    };
  }
  return { command, args: [...args] };
}

export function runCommand(command, args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const maxOutputBytes = options.maxOutputBytes ?? MAX_CAPTURE_BYTES;
  const launch = normalizeSpawnCommand(command, args);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk, maxOutputBytes);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk, maxOutputBytes);
    });
    child.once('error', (error) => {
      reject(new Error(`could not execute ${command}: ${error.message}`, { cause: error }));
    });
    child.once('close', (code, signal) => {
      resolvePromise({
        command,
        args: [...args],
        cwd,
        code: code ?? -1,
        signal: signal ?? null,
        stdout,
        stderr,
      });
    });
  });
}

async function executableCandidate(paths) {
  for (const path of paths) {
    if (!path) {
      continue;
    }
    if (await exists(path)) {
      return path;
    }
  }
  return undefined;
}

export async function resolveTspBinary(explicit) {
  if (explicit) {
    return explicit;
  }
  const executable = process.platform === 'win32' ? 'tsp.cmd' : 'tsp';
  const local = await executableCandidate([
    join(MODULE_ROOT, 'node_modules', '.bin', executable),
    join(process.cwd(), 'node_modules', '.bin', executable),
  ]);
  return local ?? executable;
}

export async function toolVersion(command, args = ['--version'], options = {}) {
  try {
    const result = await runCommand(command, args, options);
    if (result.code !== 0) {
      return { command, available: false, version: null, stderr: result.stderr.trim() };
    }
    return {
      command,
      available: true,
      version: (result.stdout || result.stderr).trim().split(/\r?\n/u)[0] || 'unknown',
    };
  } catch (error) {
    return { command, available: false, version: null, stderr: error.message };
  }
}

async function findNamedFile(root, name, matches = []) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await findNamedFile(path, name, matches);
    } else if (entry.isFile() && entry.name === name) {
      matches.push(path);
    }
  }
  return matches;
}

export async function emitTypeSpecJsonSchema(options) {
  const entry = resolve(options.entry);
  const outputDir = resolve(options.outputDir);
  const bundleId = options.bundleId ?? 'typespec.generated.schema.json';
  if (basename(bundleId) !== bundleId || !bundleId.toLowerCase().endsWith('.json')) {
    throw new Error('bundleId must be a plain .json filename without path separators');
  }
  const entryStat = await stat(entry);
  const cwd = options.cwd
    ? resolve(options.cwd)
    : entryStat.isDirectory()
      ? entry
      : dirname(entry);
  const tspBin = await resolveTspBinary(options.tspBin);
  await mkdir(outputDir, { recursive: true });
  const expected = join(outputDir, bundleId);
  if (await exists(expected)) {
    await rm(expected, { force: true });
  }

  const emitterOptions = {
    'emitter-output-dir': outputDir,
    'file-type': 'json',
    bundleId,
    emitAllModels: 'true',
    emitAllRefs: 'true',
    'int64-strategy': options.int64Strategy ?? 'string',
    'seal-object-schemas': String(options.sealObjectSchemas ?? true),
    'polymorphic-models-strategy': options.polymorphicModelsStrategy ?? 'oneOf',
  };

  const emitterPath = resolveJsonSchemaEmitter();
  const args = ['compile', entry, '--emit', emitterPath, '--warn-as-error'];
  for (const [key, value] of Object.entries(emitterOptions)) {
    args.push('--option', `@typespec/json-schema.${key}=${value}`);
  }

  let result = await runCommand(tspBin, args, { cwd, env: options.env });
  let executionMode = 'subprocess';
  if (result.code !== 0) {
    const subprocessDetail = commandFailureDetail(result) || `exit code ${result.code}`;
    try {
      await emitWithPinnedCompiler({ entry, cwd, outputDir, emitterPath, emitterOptions });
      executionMode = 'pinned-compiler-fallback';
    } catch (error) {
      const fallbackDetail = error.message || String(error);
      throw new Error(
        `TypeSpec JSON Schema generation failed: ${fallbackDetail}\nsubprocess: ${subprocessDetail}`,
        { cause: error },
      );
    }
    result = {
      ...result,
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
    };
  }

  let generatedPath = expected;
  if (!(await exists(generatedPath))) {
    const matches = await findNamedFile(outputDir, bundleId);
    if (matches.length !== 1) {
      throw new Error(
        `TypeSpec emitter succeeded but expected exactly one ${bundleId} below ${outputDir}; found ${matches.length}`,
      );
    }
    [generatedPath] = matches;
  }

  return {
    entry,
    cwd,
    outputDir,
    generatedPath,
    bundleId,
    tspBin: isAbsolute(tspBin) ? tspBin : tspBin,
    emitter: '@typespec/json-schema',
    emitterOptions,
    executionMode,
    command: {
      executable: tspBin,
      args,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    },
  };
}
