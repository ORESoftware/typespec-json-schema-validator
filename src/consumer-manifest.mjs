import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ConsumerManifestSyntaxError, parseConsumerManifestToml } from './consumer-manifest-toml.mjs';

export const CONSUMER_MANIFEST_NAME = '.ores-tjsv.toml';
const COMMANDS = new Set(['check', 'compare', 'validate', 'inventory', 'generate']);
const ROOT_KEYS = new Set(['version', 'default_contract', 'authority', 'defaults', 'contracts']);
const AUTHORITY_KEYS = new Set(['typespec', 'json_schema']);
const CONFIG_KEYS = new Set([
  'typespec', 'schema', 'generated_schema', 'report', 'sarif', 'mapping', 'instances',
  'contract_ir', 'output_dir', 'max_findings', 'probes', 'max_probes', 'quiet',
  'format_assertion', 'bundle_id', 'int64_strategy', 'seal_object_schemas',
  'polymorphic_models_strategy',
]);
const CONTRACT_KEYS = new Set(['id', ...CONFIG_KEYS]);
const PATH_KEYS = new Set([
  'typespec', 'schema', 'generated_schema', 'report', 'sarif', 'mapping', 'instances',
  'contract_ir', 'output_dir',
]);
const ENV = Object.freeze({
  typespec: 'TSJSV_TYPESPEC', schema: 'TSJSV_AUTHORED_SCHEMA', generated_schema: 'TSJSV_GENERATED_SCHEMA',
  report: 'TSJSV_REPORT', sarif: 'TSJSV_SARIF', mapping: 'TSJSV_MAPPING', instances: 'TSJSV_INSTANCES',
  contract_ir: 'TSJSV_CONTRACT_IR', output_dir: 'TSJSV_OUTPUT_DIR',
  max_findings: 'TSJSV_MAX_FINDINGS', probes: 'TSJSV_PROBES', max_probes: 'TSJSV_MAX_PROBES',
  quiet: 'TSJSV_QUIET', format_assertion: 'TSJSV_FORMAT_ASSERTION', bundle_id: 'TSJSV_BUNDLE_ID',
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
    if (['probes', 'quiet', 'format_assertion', 'seal_object_schemas'].includes(key)
      && typeof value !== 'boolean') {
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
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(contract.id)) {
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

function regularFile(path) {
  try {
    const info = lstatSync(path);
    return info.isFile() && !info.isSymbolicLink() && info.nlink === 1;
  } catch {
    return false;
  }
}

export function discoverConsumerManifest(start = process.cwd()) {
  let current = resolve(start);
  while (true) {
    const candidate = join(current, CONSUMER_MANIFEST_NAME);
    if (existsSync(candidate)) {
      if (!regularFile(candidate)) fail('consumer manifest must be a regular, non-symlink file', candidate);
      return candidate;
    }
    if (existsSync(join(current, '.git'))) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function localPath(root, value, label, manifest) {
  if (isAbsolute(value)) fail(`${label} must be relative to the consumer manifest`, manifest);
  const candidate = resolve(root, value);
  const rendered = relative(root, candidate);
  if (rendered === '..' || rendered.startsWith('../') || rendered.startsWith('..\\') || isAbsolute(rendered)) {
    fail(`${label} must remain inside the consumer manifest root`, manifest);
  }
  return candidate;
}

function toEnvironment(config, root, manifest) {
  return Object.fromEntries(Object.entries(config ?? {}).filter(([key]) => ENV[key]).map(([key, value]) => [
    ENV[key], PATH_KEYS.has(key) ? localPath(root, value, key, manifest) : value,
  ]));
}

export function loadConsumerManifestConfiguration({ cwd = process.cwd(), command = 'check', manifestPath, contractId } = {}) {
  if (!COMMANDS.has(command)) return null;
  const selectedPath = manifestPath ? resolve(cwd, manifestPath) : discoverConsumerManifest(cwd);
  if (selectedPath === null) return null;
  if (!regularFile(selectedPath)) fail('consumer manifest could not be read as a regular, non-symlink file', selectedPath);
  let parsed;
  try {
    parsed = parseConsumerManifestToml(readFileSync(selectedPath, 'utf8'), selectedPath);
  } catch (error) {
    if (error instanceof ConsumerManifestSyntaxError) fail(error.message, selectedPath, error.line);
    throw error;
  }
  const manifest = validateConsumerManifest(parsed, selectedPath);
  const selectedId = contractId ?? manifest.default_contract
    ?? (manifest.contracts.length === 1 ? manifest.contracts[0].id : undefined);
  if (!selectedId) fail('multiple contracts require default_contract or TSJSV_CONTRACT', selectedPath);
  const contract = manifest.contracts.find((item) => item.id === selectedId);
  if (!contract) fail(`contract ${selectedId} is not declared`, selectedPath);
  const root = dirname(selectedPath);
  return {
    path: selectedPath,
    root,
    contractId: selectedId,
    env: { ...toEnvironment(manifest.defaults, root, selectedPath), ...toEnvironment(contract, root, selectedPath) },
  };
}
