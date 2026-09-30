import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { canonicalStringify, isPlainObject, sha256 } from './canonical.mjs';

export const WIT_PROJECTION_SCHEMA =
  'ores.typespec-json-schema-validator.wit-projection/v1';
export const WIT_COMPATIBILITY_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.wit-compatibility-receipt/v1';

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*(?:@[A-Za-z0-9][A-Za-z0-9.+_-]*)?$/u;
const TYPE_KINDS = new Set([
  'alias', 'record', 'variant', 'enum', 'flags', 'resource', 'handle', 'tuple', 'option', 'result', 'list', 'future', 'stream',
]);
const MODES = new Set(['consumer', 'strict']);

export class WitProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WitProjectionError';
  }
}

export class UnsafeWitCompatibilityReceiptDestinationError extends Error {}

function fail(message) {
  throw new WitProjectionError(message);
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    fail(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function text(value, label, max = 2048) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a bounded non-empty control-free string`);
  }
  return value;
}

function identifier(value, label) {
  text(value, label, 256);
  if (!IDENTIFIER.test(value)) fail(`${label} must be a normalized WIT identifier`);
  return value;
}

function packageIdentity(value, label = 'projection.package') {
  const raw = text(value, label, 512);
  if (!PACKAGE_ID.test(raw)) fail(`${label} must be a normalized WIT package identifier`);
  const at = raw.lastIndexOf('@');
  return Object.freeze({
    raw,
    identity: at === -1 ? raw : raw.slice(0, at),
    version: at === -1 ? null : raw.slice(at + 1),
  });
}

function normalizeNamedType(value, label) {
  exactKeys(value, ['name', 'kind', 'shape'], label);
  const kind = text(value.kind, `${label}.kind`, 32);
  if (!TYPE_KINDS.has(kind)) fail(`${label}.kind is unsupported`);
  return {
    name: identifier(value.name, `${label}.name`),
    kind,
    shape: text(value.shape, `${label}.shape`, 8192),
  };
}

function normalizeParam(value, label) {
  exactKeys(value, ['name', 'type'], label);
  return {
    name: value.name === null ? null : identifier(value.name, `${label}.name`),
    type: text(value.type, `${label}.type`, 2048),
  };
}

function normalizeFunction(value, label) {
  exactKeys(value, ['name', 'params', 'results'], label);
  if (!Array.isArray(value.params) || !Array.isArray(value.results)) {
    fail(`${label}.params and .results must be arrays`);
  }
  const params = value.params.map((item, index) => normalizeParam(item, `${label}.params[${index}]`));
  const results = value.results.map((item, index) => normalizeParam(item, `${label}.results[${index}]`));
  return {
    name: identifier(value.name, `${label}.name`),
    params,
    results,
  };
}

function normalizeInterface(value, label) {
  exactKeys(value, ['name', 'types', 'functions'], label);
  if (!Array.isArray(value.types) || !Array.isArray(value.functions)) {
    fail(`${label}.types and .functions must be arrays`);
  }
  const types = value.types.map((item, index) => normalizeNamedType(item, `${label}.types[${index}]`));
  const functions = value.functions.map((item, index) => normalizeFunction(item, `${label}.functions[${index}]`));
  uniqueNames(types, `${label}.types`);
  uniqueNames(functions, `${label}.functions`);
  return {
    name: identifier(value.name, `${label}.name`),
    types: types.sort(byName),
    functions: functions.sort(byName),
  };
}

function normalizeBinding(value, label) {
  exactKeys(value, ['name', 'kind', 'target'], label);
  const kind = text(value.kind, `${label}.kind`, 32);
  if (!['interface', 'function'].includes(kind)) fail(`${label}.kind is unsupported`);
  return {
    name: identifier(value.name, `${label}.name`),
    kind,
    target: text(value.target, `${label}.target`, 2048),
  };
}

function normalizeWorld(value, label) {
  exactKeys(value, ['name', 'imports', 'exports'], label);
  if (!Array.isArray(value.imports) || !Array.isArray(value.exports)) {
    fail(`${label}.imports and .exports must be arrays`);
  }
  const imports = value.imports.map((item, index) => normalizeBinding(item, `${label}.imports[${index}]`));
  const exports = value.exports.map((item, index) => normalizeBinding(item, `${label}.exports[${index}]`));
  uniqueNames(imports, `${label}.imports`);
  uniqueNames(exports, `${label}.exports`);
  return {
    name: identifier(value.name, `${label}.name`),
    imports: imports.sort(byName),
    exports: exports.sort(byName),
  };
}

function byName(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

function uniqueNames(items, label) {
  const names = items.map((item) => item.name);
  if (new Set(names).size !== names.length) fail(`${label} contains duplicate names`);
}

export function normalizeWitProjection(value) {
  exactKeys(value, ['schema', 'package', 'worlds', 'interfaces'], 'projection');
  if (value.schema !== WIT_PROJECTION_SCHEMA) fail('projection.schema is unsupported');
  if (!Array.isArray(value.worlds) || !Array.isArray(value.interfaces)) {
    fail('projection.worlds and projection.interfaces must be arrays');
  }
  const worlds = value.worlds.map((item, index) => normalizeWorld(item, `projection.worlds[${index}]`));
  const interfaces = value.interfaces.map((item, index) => normalizeInterface(item, `projection.interfaces[${index}]`));
  uniqueNames(worlds, 'projection.worlds');
  uniqueNames(interfaces, 'projection.interfaces');
  return Object.freeze({
    schema: WIT_PROJECTION_SCHEMA,
    package: packageIdentity(value.package).raw,
    worlds: worlds.sort(byName),
    interfaces: interfaces.sort(byName),
  });
}

function finding(ruleId, subject, message, baseline, current) {
  const body = { ruleId, subject, message, baseline, current };
  return Object.freeze({ ...body, fingerprint: sha256(canonicalStringify(body)) });
}

function push(findings, maxFindings, ...args) {
  findings.totalCount = (findings.totalCount ?? 0) + 1;
  if (findings.length < maxFindings) findings.push(finding(...args));
}

function compareNamedBaseline(before, after, prefix, findings, maxFindings, compare) {
  const current = new Map(after.map((item) => [item.name, item]));
  for (const item of before) {
    const next = current.get(item.name);
    if (!next) {
      push(findings, maxFindings, `wit-${prefix}-removed`, item.name,
        `${prefix} ${item.name} was removed`, item, null);
      continue;
    }
    compare(item, next);
  }
}

function compareInterfaces(baseline, current, findings, maxFindings, mode) {
  compareNamedBaseline(
    baseline.interfaces,
    current.interfaces,
    'interface',
    findings,
    maxFindings,
    (before, after) => {
      compareNamedBaseline(before.types, after.types, 'type', findings, maxFindings, (oldType, newType) => {
        if (oldType.kind !== newType.kind || oldType.shape !== newType.shape) {
          push(findings, maxFindings, 'wit-type-changed', `${before.name}.${oldType.name}`,
            `WIT type ${before.name}.${oldType.name} changed`, oldType, newType);
        }
      });

      const currentFns = new Map(after.functions.map((item) => [item.name, item]));
      for (const fn of before.functions) {
        const next = currentFns.get(fn.name);
        const subject = `${before.name}.${fn.name}`;
        if (!next) {
          push(findings, maxFindings, 'wit-function-removed', subject,
            `WIT function ${subject} was removed`, fn, null);
          continue;
        }
        if (canonicalStringify(fn.params) !== canonicalStringify(next.params)
          || canonicalStringify(fn.results) !== canonicalStringify(next.results)) {
          push(findings, maxFindings, 'wit-function-signature-changed', subject,
            `WIT function ${subject} changed parameters or results`, fn, next);
        }
      }

      if (mode === 'strict') {
        const baselineFns = new Set(before.functions.map((item) => item.name));
        for (const fn of after.functions) {
          if (!baselineFns.has(fn.name)) {
            push(findings, maxFindings, 'wit-function-added', `${after.name}.${fn.name}`,
              `WIT function ${after.name}.${fn.name} was added in strict mode`, null, fn);
          }
        }
      }
    },
  );
}

function compareWorlds(baseline, current, findings, maxFindings, mode) {
  compareNamedBaseline(baseline.worlds, current.worlds, 'world', findings, maxFindings, (before, after) => {
    const baselineExports = new Map(before.exports.map((item) => [item.name, item]));
    const currentExports = new Map(after.exports.map((item) => [item.name, item]));
    for (const item of before.exports) {
      const next = currentExports.get(item.name);
      const subject = `${before.name}.export.${item.name}`;
      if (!next) {
        push(findings, maxFindings, 'wit-world-export-removed', subject,
          `WIT world export ${subject} was removed`, item, null);
      } else if (canonicalStringify(item) !== canonicalStringify(next)) {
        push(findings, maxFindings, 'wit-world-export-changed', subject,
          `WIT world export ${subject} changed`, item, next);
      }
    }
    if (mode === 'strict') {
      for (const item of after.exports) {
        if (!baselineExports.has(item.name)) {
          push(findings, maxFindings, 'wit-world-export-added', `${after.name}.export.${item.name}`,
            `WIT world export ${after.name}.export.${item.name} was added in strict mode`, null, item);
        }
      }
    }

    const baselineImports = new Map(before.imports.map((item) => [item.name, item]));
    const currentImports = new Map(after.imports.map((item) => [item.name, item]));
    for (const item of before.imports) {
      const next = currentImports.get(item.name);
      const subject = `${before.name}.import.${item.name}`;
      if (next && canonicalStringify(item) !== canonicalStringify(next)) {
        push(findings, maxFindings, 'wit-world-import-changed', subject,
          `WIT world import ${subject} changed`, item, next);
      }
    }
    for (const item of after.imports) {
      if (!baselineImports.has(item.name)) {
        push(findings, maxFindings, 'wit-world-import-added', `${after.name}.import.${item.name}`,
          `WIT world import ${after.name}.import.${item.name} adds a new host requirement`, null, item);
      }
    }
  });
}

export function compareWitCompatibility(baselineValue, currentValue, options = {}) {
  const maxFindings = options.maxFindings ?? 250;
  const mode = options.mode ?? 'consumer';
  if (!Number.isSafeInteger(maxFindings) || maxFindings < 1 || maxFindings > 10_000) {
    fail('maxFindings must be a safe integer between 1 and 10000');
  }
  if (!MODES.has(mode)) fail('mode must be consumer or strict');

  const baseline = normalizeWitProjection(baselineValue);
  const current = normalizeWitProjection(currentValue);
  const findings = [];
  const baselinePackage = packageIdentity(baseline.package);
  const currentPackage = packageIdentity(current.package);
  if (baselinePackage.identity !== currentPackage.identity) {
    push(findings, maxFindings, 'wit-package-changed', 'package',
      `WIT package identity changed from ${baselinePackage.identity} to ${currentPackage.identity}`,
      baseline.package, current.package);
  }
  compareInterfaces(baseline, current, findings, maxFindings, mode);
  compareWorlds(baseline, current, findings, maxFindings, mode);

  const totalFindings = findings.totalCount ?? findings.length;
  const truncated = totalFindings > findings.length;
  return Object.freeze({
    baseline,
    current,
    mode,
    baselineDigest: sha256(canonicalStringify(baseline)),
    currentDigest: sha256(canonicalStringify(current)),
    status: totalFindings === 0 ? 'passed' : 'stopped_for_evaluation',
    admissible: totalFindings === 0,
    breakingChangeCount: totalFindings,
    findings: Object.freeze([...findings]),
    truncated,
  });
}

function receiptBody(result, failureCode = null) {
  return {
    schema: WIT_COMPATIBILITY_RECEIPT_SCHEMA,
    status: result.status,
    admissible: result.status === 'passed',
    mode: result.mode ?? 'consumer',
    baselineDigest: result.baselineDigest ?? null,
    currentDigest: result.currentDigest ?? null,
    breakingChangeCount: Number.isSafeInteger(result.breakingChangeCount)
      ? result.breakingChangeCount
      : (Array.isArray(result.findings) ? result.findings.length : 0),
    truncated: result.truncated === true,
    breakingChanges: Array.isArray(result.findings) ? result.findings : [],
    failureCode: result.status === 'passed'
      ? null
      : failureCode ?? (result.status === 'stopped_for_evaluation'
        ? 'wit-breaking-change-detected'
        : 'wit-compatibility-verification-failed'),
  };
}

export function createWitCompatibilityReceipt({ baseline, current, maxFindings, mode } = {}) {
  const result = compareWitCompatibility(baseline, current, { maxFindings, mode });
  const body = receiptBody(result);
  return Object.freeze({ ...body, verificationId: sha256(canonicalStringify(body)) });
}

export function failedWitCompatibilityReceipt({ baseline, current, mode = 'consumer' } = {}) {
  let baselineDigest = null;
  let currentDigest = null;
  try { baselineDigest = sha256(canonicalStringify(normalizeWitProjection(baseline))); } catch {}
  try { currentDigest = sha256(canonicalStringify(normalizeWitProjection(current))); } catch {}
  const body = receiptBody({
    status: 'failed',
    mode: MODES.has(mode) ? mode : 'consumer',
    baselineDigest,
    currentDigest,
    breakingChangeCount: 0,
    findings: [],
    truncated: false,
  }, 'wit-compatibility-verification-failed');
  return Object.freeze({ ...body, verificationId: sha256(canonicalStringify(body)) });
}

function validDigest(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function validReceipt(receipt) {
  if (!isPlainObject(receipt) || receipt.schema !== WIT_COMPATIBILITY_RECEIPT_SCHEMA) return false;
  if (!['passed', 'stopped_for_evaluation', 'failed'].includes(receipt.status)) return false;
  if (!MODES.has(receipt.mode) || receipt.admissible !== (receipt.status === 'passed')) return false;
  if (!Number.isSafeInteger(receipt.breakingChangeCount) || receipt.breakingChangeCount < 0) return false;
  if (!Array.isArray(receipt.breakingChanges) || receipt.breakingChanges.length > 10_000) return false;
  if (receipt.truncated) {
    if (receipt.breakingChangeCount <= receipt.breakingChanges.length) return false;
  } else if (receipt.breakingChangeCount !== receipt.breakingChanges.length) {
    return false;
  }
  if (![receipt.baselineDigest, receipt.currentDigest].every((v) => v === null || validDigest(v))) return false;
  if (!validDigest(receipt.verificationId)) return false;
  const { verificationId, ...body } = receipt;
  return verificationId === sha256(canonicalStringify(body));
}

async function inspectDestination(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new UnsafeWitCompatibilityReceiptDestinationError(
        'refusing to replace WIT compatibility evidence unless it is a singly linked regular file',
      );
    }
    let existing;
    try { existing = JSON.parse(await readFile(path, 'utf8')); } catch {
      throw new UnsafeWitCompatibilityReceiptDestinationError(
        'refusing to replace an unrecognized WIT compatibility evidence file',
      );
    }
    if (!validReceipt(existing)) {
      throw new UnsafeWitCompatibilityReceiptDestinationError(
        'refusing to replace an unrecognized WIT compatibility evidence file',
      );
    }
    return info;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function unchanged(before, after) {
  return before !== null && after !== null
    && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

export async function writeWitCompatibilityReceipt(path, receipt) {
  if (!validReceipt(receipt)) {
    throw new UnsafeWitCompatibilityReceiptDestinationError(
      'refusing to write malformed WIT compatibility evidence',
    );
  }
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const before = await inspectDestination(target);
  const temporary = resolve(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(`${canonicalStringify(receipt, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (before === null) {
      await rename(temporary, target);
    } else {
      const after = await inspectDestination(target);
      if (!unchanged(before, after)) {
        throw new UnsafeWitCompatibilityReceiptDestinationError(
          'WIT compatibility evidence changed during replacement',
        );
      }
      await rename(temporary, target);
    }
    return target;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
