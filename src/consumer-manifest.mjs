import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { ConsumerManifestSyntaxError, parseConsumerManifestToml } from './consumer-manifest-toml.mjs';

export const CONSUMER_MANIFEST_NAME = '.ores-tjsv.toml';
export const CONSUMER_MANIFEST_MAX_BYTES = 256 * 1024;

const COMMANDS = new Set(['check', 'compare', 'validate', 'inventory', 'generate']);
const ROOT_KEYS = new Set(['version', 'default_contract', 'authority', 'defaults', 'contracts']);
const AUTHORITY_KEYS = new Set(['typespec', 'json_schema']);
const CONFIG_KEYS = new Set([
  'typespec', 'schema', 'generated_schema', 'report', 'sarif', 'mapping', 'instances',
  'contract_ir', 'output_dir', 'max_findings', 'probes', 'max_probes',
  'format_assertion', 'bundle_id', 'int64_strategy', 'seal_object_schemas',
  'polymorphic_models_strategy',
]);
const CONTRACT_KEYS = new Set(['id', ...CONFIG_KEYS]);
const PATH_KEYS = new Set([
  'typespec', 'schema', 'generated_schema', 'report', 'sarif', 'mapping', 'instances',
  'contract_ir', 'output_dir',
]);
const CONTRACT_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const POSIX_NOFOLLOW = process.platform !== 'win32' && Number.isInteger(constants.O_NOFOLLOW);
const ENV = Object.freeze({
  typespec: 'TSJSV_TYPESPEC', schema: 'TSJSV_AUTHORED_SCHEMA', generated_schema: 'TSJSV_GENERATED_SCHEMA',
  report: 'TSJSV_REPORT', sarif: 'TSJSV_SARIF', mapping: 'TSJSV_MAPPING', instances: 'TSJSV_INSTANCES',
  contract_ir: 'TSJSV_CONTRACT_IR', output_dir: 'TSJSV_OUTPUT_DIR',
  max_findings: 'TSJSV_MAX_FINDINGS', probes: 'TSJSV_PROBES', max_probes: 'TSJSV_MAX_PROBES',
  format_assertion: 'TSJSV_FORMAT_ASSERTION', bundle_id: 'TSJSV_BUNDLE_ID',
  int64_strategy: 'TSJSV_INT64_STRATEGY', seal_object_schemas: 'TSJSV_SEAL_OBJECT_SCHEMAS',
  polymorphic_models_strategy: 'TSJSV_POLYMORPHIC_MODELS_STRATEGY',
});

export class ConsumerManifestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ConsumerManifestError';
    this.details = details;
  }
}

function fail(message, manifest, line) {
  throw new ConsumerManifestError(message, { manifest, ...(line ? { line } : {}) });
}

function nonEmptyString(value, label, manifest) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    fail(`${label} must be a non-empty string`, manifest);
  }
}

function assertKnownKeys(object, allowed, label, manifest) {
  for (const key of Object.keys(object ?? {})) {
    if (!allowed.has(key)) fail(`unsupported key ${key} in ${label}`, manifest);
  }
}

function validateConfig(config, label, manifest) {
  assertKnownKeys(config, CONFIG_KEYS, label, manifest);
  for (const [key, value] of Object.entries(config ?? {})) {
    if (PATH_KEYS.has(key) || ['bundle_id', 'int64_strategy', 'polymorphic_models_strategy'].includes(key)) {
      nonEmptyString(value, `${label}.${key}`, manifest);
    }
    if (['probes', 'format_assertion', 'seal_object_schemas'].includes(key) && typeof value !== 'boolean') {
      fail(`${label}.${key} must be a boolean`, manifest);
    }
    if (['max_findings', 'max_probes'].includes(key)
      && (!Number.isSafeInteger(value) || value < 1 || value > 10_000)) {
      fail(`${label}.${key} must be an integer between 1 and 10000`, manifest);
    }
  }
  if (config?.int64_strategy !== undefined && !['string', 'number'].includes(config.int64_strategy)) {
    fail(`${label}.int64_strategy must be string or number`, manifest);
  }
  if (config?.polymorphic_models_strategy !== undefined
    && !['ignore', 'oneOf', 'anyOf'].includes(config.polymorphic_models_strategy)) {
    fail(`${label}.polymorphic_models_strategy must be ignore, oneOf, or anyOf`, manifest);
  }
}

export function validateConsumerManifest(value, manifest = CONSUMER_MANIFEST_NAME) {
  assertKnownKeys(value, ROOT_KEYS, 'root', manifest);
  if (value.version !== 1) fail('consumer manifest version must be 1', manifest);
  assertKnownKeys(value.authority, AUTHORITY_KEYS, 'authority', manifest);
  if (value.authority?.typespec !== undefined && value.authority.typespec !== 'peer-authority') {
    fail('authority.typespec must remain peer-authority', manifest);
  }
  if (value.authority?.json_schema !== undefined && value.authority.json_schema !== 'peer-authority') {
    fail('authority.json_schema must remain peer-authority', manifest);
  }
  validateConfig(value.defaults ?? {}, 'defaults', manifest);
  if (!Array.isArray(value.contracts) || value.contracts.length === 0) {
    fail('consumer manifest must declare at least one [[contracts]] entry', manifest);
  }
  const ids = new Set();
  for (let index = 0; index < value.contracts.length; index += 1) {
    const contract = value.contracts[index];
    const label = `contracts[${index}]`;
    assertKnownKeys(contract, CONTRACT_KEYS, label, manifest);
    nonEmptyString(contract.id, `${label}.id`, manifest);
    if (!CONTRACT_ID.test(contract.id)) {
      fail(`${label}.id is not a valid contract identifier`, manifest);
    }
    if (ids.has(contract.id)) fail(`duplicate contract id ${contract.id}`, manifest);
    ids.add(contract.id);
    nonEmptyString(contract.typespec, `${label}.typespec`, manifest);
    nonEmptyString(contract.schema, `${label}.schema`, manifest);
    validateConfig(Object.fromEntries(Object.entries(contract).filter(([key]) => key !== 'id')), label, manifest);
  }
  if (value.default_contract !== undefined) {
    nonEmptyString(value.default_contract, 'default_contract', manifest);
    if (!ids.has(value.default_contract)) fail(`default_contract ${value.default_contract} is not declared`, manifest);
  }
  return value;
}

function tryLstat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

function assertManifestInfo(path, info, rejectSymlink = true) {
  if (!info.isFile() || (rejectSymlink && info.isSymbolicLink()) || info.nlink !== 1) {
    fail('consumer manifest must be a regular, non-symlink, single-link file', path);
  }
  if (info.size > CONSUMER_MANIFEST_MAX_BYTES) {
    fail(`consumer manifest exceeds ${CONSUMER_MANIFEST_MAX_BYTES} bytes`, path);
  }
  return info;
}

function assertManifestFile(path, info = undefined) {
  let inspected = info;
  try {
    inspected ??= lstatSync(path);
  } catch {
    fail('consumer manifest could not be read', path);
  }
  return assertManifestInfo(path, inspected, true);
}

function samePathSnapshot(left, right) {
  return left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.birthtimeMs === right.birthtimeMs
    && left.mode === right.mode
    && left.nlink === right.nlink;
}

function readConsumerManifest(path) {
  const before = assertManifestFile(path);
  let fd;
  try {
    const flags = POSIX_NOFOLLOW
      ? constants.O_RDONLY | constants.O_NOFOLLOW
      : constants.O_RDONLY;
    fd = openSync(path, flags);
  } catch (error) {
    if (error?.code === 'ELOOP') fail('consumer manifest must not be a symbolic link', path);
    fail('consumer manifest could not be opened', path);
  }

  try {
    const opened = assertManifestInfo(path, fstatSync(fd), false);
    if (POSIX_NOFOLLOW && (before.dev !== opened.dev || before.ino !== opened.ino)) {
      fail('consumer manifest changed while it was being opened', path);
    }

    const bytes = readFileSync(fd);
    if (bytes.length > CONSUMER_MANIFEST_MAX_BYTES) {
      fail(`consumer manifest exceeds ${CONSUMER_MANIFEST_MAX_BYTES} bytes`, path);
    }

    const after = assertManifestFile(path);
    if (!samePathSnapshot(before, after)) {
      fail('consumer manifest changed while it was being read', path);
    }
    if (POSIX_NOFOLLOW && (after.dev !== opened.dev || after.ino !== opened.ino)) {
      fail('consumer manifest changed while it was being read', path);
    }
    if (!POSIX_NOFOLLOW && opened.size !== after.size) {
      fail('consumer manifest changed while it was being read', path);
    }

    try {
      return UTF8.decode(bytes);
    } catch {
      fail('consumer manifest must contain valid UTF-8', path);
    }
  } finally {
    closeSync(fd);
  }
}

export function discoverConsumerManifest(start = process.cwd()) {
  let current = resolve(start);
  while (true) {
    const candidate = join(current, CONSUMER_MANIFEST_NAME);
    let manifestInfo;
    try {
      manifestInfo = tryLstat(candidate);
    } catch {
      fail('consumer manifest discovery could not inspect the candidate path', candidate);
    }
    if (manifestInfo !== null) {
      assertManifestFile(candidate, manifestInfo);
      return candidate;
    }
    try {
      if (tryLstat(join(current, '.git')) !== null) return null;
    } catch {
      fail('consumer manifest discovery could not inspect the repository boundary', current);
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function inside(root, candidate) {
  const rendered = relative(root, candidate);
  return rendered === ''
    || (rendered !== '..'
      && !rendered.startsWith('../')
      && !rendered.startsWith('..\\')
      && !isAbsolute(rendered));
}

function nearestExistingPath(candidate, root, label, manifest) {
  let current = candidate;
  while (true) {
    let info;
    try {
      info = tryLstat(current);
    } catch {
      fail(`${label} could not be inspected`, manifest);
    }
    if (info !== null) return { path: current, info };
    if (current === root) fail(`${label} could not be resolved inside the consumer manifest root`, manifest);
    const parent = dirname(current);
    if (parent === current) fail(`${label} could not be resolved inside the consumer manifest root`, manifest);
    current = parent;
  }
}

function localPath(root, realRoot, value, label, manifest) {
  if (isAbsolute(value)) fail(`${label} must be relative to the consumer manifest`, manifest);
  const candidate = resolve(root, value);
  if (!inside(root, candidate)) {
    fail(`${label} must remain inside the consumer manifest root`, manifest);
  }

  const existing = nearestExistingPath(candidate, root, label, manifest);
  let realExisting;
  try {
    realExisting = realpathSync.native(existing.path);
  } catch {
    fail(`${label} contains an unresolved symlink`, manifest);
  }
  if (!inside(realRoot, realExisting)) {
    fail(`${label} must remain inside the consumer manifest root after resolving symlinks`, manifest);
  }
  if (existing.path !== candidate) {
    try {
      if (!statSync(realExisting).isDirectory()) {
        fail(`${label} has a non-directory path ancestor`, manifest);
      }
    } catch (error) {
      if (error instanceof ConsumerManifestError) throw error;
      fail(`${label} ancestor could not be inspected`, manifest);
    }
  }
  return candidate;
}

function toEnvironment(config, root, realRoot, manifest) {
  return Object.fromEntries(Object.entries(config ?? {}).filter(([key]) => ENV[key]).map(([key, value]) => [
    ENV[key], PATH_KEYS.has(key) ? localPath(root, realRoot, value, key, manifest) : value,
  ]));
}

export function loadConsumerManifestConfiguration({ cwd = process.cwd(), command = 'check', manifestPath, contractId } = {}) {
  if (!COMMANDS.has(command)) return null;
  const selectedPath = manifestPath ? resolve(cwd, manifestPath) : discoverConsumerManifest(cwd);
  if (selectedPath === null) return null;
  const text = readConsumerManifest(selectedPath);
  let parsed;
  try {
    parsed = parseConsumerManifestToml(text, selectedPath);
  } catch (error) {
    if (error instanceof ConsumerManifestSyntaxError) fail(error.message, selectedPath, error.line);
    throw error;
  }
  const manifest = validateConsumerManifest(parsed, selectedPath);
  if (contractId !== undefined) {
    nonEmptyString(contractId, 'contract selector', selectedPath);
    if (!CONTRACT_ID.test(contractId)) fail('contract selector is not a valid contract identifier', selectedPath);
  }
  const selectedId = contractId ?? manifest.default_contract
    ?? (manifest.contracts.length === 1 ? manifest.contracts[0].id : undefined);
  if (!selectedId) fail('multiple contracts require default_contract or TSJSV_CONTRACT', selectedPath);
  const contract = manifest.contracts.find((item) => item.id === selectedId);
  if (!contract) fail(`contract ${selectedId} is not declared`, selectedPath);
  const root = dirname(selectedPath);
  let realRoot;
  try {
    realRoot = realpathSync.native(root);
  } catch {
    fail('consumer manifest root could not be resolved', selectedPath);
  }
  return {
    path: selectedPath,
    root,
    contractId: selectedId,
    env: {
      ...toEnvironment(manifest.defaults, root, realRoot, selectedPath),
      ...toEnvironment(contract, root, realRoot, selectedPath),
    },
  };
}
