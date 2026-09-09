import { randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { canonicalStringify, isPlainObject, sha256 } from './canonical.mjs';

export const PROTOBUF_PROJECTION_SCHEMA =
  'ores.typespec-json-schema-validator.protobuf-projection/v1';
export const PROTOBUF_COMPATIBILITY_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.protobuf-compatibility-receipt/v1';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const PACKAGE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u;
const TYPE = /^\.?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:<[A-Za-z_][A-Za-z0-9_.]*,[A-Za-z_][A-Za-z0-9_.]*>)?$/u;
const CARDINALITIES = new Set(['singular', 'optional', 'repeated']);
const PRESENCE = new Set(['implicit', 'explicit']);

export class ProtobufProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProtobufProjectionError';
  }
}

export class UnsafeProtobufCompatibilityReceiptDestinationError extends Error {}

function fail(message) {
  throw new ProtobufProjectionError(message);
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    fail(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a non-empty control-free string`);
  }
  return value;
}

function identifier(value, label) {
  nonEmptyString(value, label);
  if (!IDENTIFIER.test(value)) fail(`${label} must be a protobuf identifier`);
  return value;
}

function typeName(value, label) {
  nonEmptyString(value, label);
  if (!TYPE.test(value)) fail(`${label} must be a normalized protobuf type name`);
  return value;
}

function fieldNumber(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 536_870_911
    || (value >= 19_000 && value <= 19_999)) {
    fail(`${label} must be a valid protobuf field number`);
  }
  return value;
}

function enumNumber(value, label) {
  if (!Number.isSafeInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
    fail(`${label} must be a signed 32-bit protobuf enum number`);
  }
  return value;
}

function normalizeReservedNumbers(value, label, normalizeNumber = fieldNumber) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const numbers = value.map((item, index) => normalizeNumber(item, `${label}[${index}]`));
  if (new Set(numbers).size !== numbers.length) fail(`${label} must not contain duplicates`);
  return numbers.sort((left, right) => left - right);
}

function normalizeReservedNames(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const names = value.map((item, index) => identifier(item, `${label}[${index}]`));
  if (new Set(names).size !== names.length) fail(`${label} must not contain duplicates`);
  return names.sort();
}

function normalizeField(value, label) {
  exactKeys(value, ['name', 'number', 'type', 'cardinality', 'presence', 'oneof', 'jsonName'], label);
  const cardinality = nonEmptyString(value.cardinality, `${label}.cardinality`);
  if (!CARDINALITIES.has(cardinality)) fail(`${label}.cardinality is unsupported`);
  const presence = nonEmptyString(value.presence, `${label}.presence`);
  if (!PRESENCE.has(presence)) fail(`${label}.presence is unsupported`);
  if (cardinality === 'repeated' && presence !== 'implicit') {
    fail(`${label}.presence must be implicit for repeated fields`);
  }
  return {
    name: identifier(value.name, `${label}.name`),
    number: fieldNumber(value.number, `${label}.number`),
    type: typeName(value.type, `${label}.type`),
    cardinality,
    presence,
    oneof: value.oneof === null ? null : identifier(value.oneof, `${label}.oneof`),
    jsonName: value.jsonName === null ? null : nonEmptyString(value.jsonName, `${label}.jsonName`),
  };
}

function normalizeMessage(value, label) {
  exactKeys(value, ['name', 'fields', 'reservedNumbers', 'reservedNames'], label);
  if (!Array.isArray(value.fields)) fail(`${label}.fields must be an array`);
  const fields = value.fields.map((item, index) => normalizeField(item, `${label}.fields[${index}]`));
  const fieldNames = fields.map((item) => item.name);
  const fieldNumbers = fields.map((item) => item.number);
  if (new Set(fieldNames).size !== fieldNames.length) fail(`${label}.fields contains duplicate names`);
  if (new Set(fieldNumbers).size !== fieldNumbers.length) fail(`${label}.fields contains duplicate numbers`);
  const reservedNumbers = normalizeReservedNumbers(value.reservedNumbers, `${label}.reservedNumbers`);
  const reservedNames = normalizeReservedNames(value.reservedNames, `${label}.reservedNames`);
  for (const field of fields) {
    if (reservedNumbers.includes(field.number)) fail(`${label} reserves active field number ${field.number}`);
    if (reservedNames.includes(field.name)) fail(`${label} reserves active field name ${field.name}`);
  }
  return {
    name: identifier(value.name, `${label}.name`),
    fields: fields.sort((left, right) => left.number - right.number || left.name.localeCompare(right.name)),
    reservedNumbers,
    reservedNames,
  };
}

function normalizeEnumValue(value, label) {
  exactKeys(value, ['name', 'number'], label);
  return {
    name: identifier(value.name, `${label}.name`),
    number: enumNumber(value.number, `${label}.number`),
  };
}

function normalizeEnum(value, label) {
  exactKeys(value, ['name', 'values', 'reservedNumbers', 'reservedNames'], label);
  if (!Array.isArray(value.values) || value.values.length === 0) fail(`${label}.values must be non-empty`);
  const values = value.values.map((item, index) => normalizeEnumValue(item, `${label}.values[${index}]`));
  const names = values.map((item) => item.name);
  const numbers = values.map((item) => item.number);
  if (new Set(names).size !== names.length) fail(`${label}.values contains duplicate names`);
  if (new Set(numbers).size !== numbers.length) fail(`${label}.values contains duplicate numbers`);
  const reservedNumbers = normalizeReservedNumbers(
    value.reservedNumbers, `${label}.reservedNumbers`, enumNumber,
  );
  const reservedNames = normalizeReservedNames(value.reservedNames, `${label}.reservedNames`);
  for (const item of values) {
    if (reservedNumbers.includes(item.number)) fail(`${label} reserves active enum number ${item.number}`);
    if (reservedNames.includes(item.name)) fail(`${label} reserves active enum name ${item.name}`);
  }
  return {
    name: identifier(value.name, `${label}.name`),
    values: values.sort((left, right) => left.number - right.number || left.name.localeCompare(right.name)),
    reservedNumbers,
    reservedNames,
  };
}

function normalizeMethod(value, label) {
  exactKeys(value, [
    'name', 'inputType', 'outputType', 'clientStreaming', 'serverStreaming', 'errorModel',
  ], label);
  if (typeof value.clientStreaming !== 'boolean' || typeof value.serverStreaming !== 'boolean') {
    fail(`${label} streaming flags must be booleans`);
  }
  return {
    name: identifier(value.name, `${label}.name`),
    inputType: typeName(value.inputType, `${label}.inputType`),
    outputType: typeName(value.outputType, `${label}.outputType`),
    clientStreaming: value.clientStreaming,
    serverStreaming: value.serverStreaming,
    errorModel: value.errorModel === null ? null : typeName(value.errorModel, `${label}.errorModel`),
  };
}

function normalizeService(value, label) {
  exactKeys(value, ['name', 'methods'], label);
  if (!Array.isArray(value.methods)) fail(`${label}.methods must be an array`);
  const methods = value.methods.map((item, index) => normalizeMethod(item, `${label}.methods[${index}]`));
  const names = methods.map((item) => item.name);
  if (new Set(names).size !== names.length) fail(`${label}.methods contains duplicate names`);
  return {
    name: identifier(value.name, `${label}.name`),
    methods: methods.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function uniqueNamed(items, label) {
  const names = items.map((item) => item.name);
  if (new Set(names).size !== names.length) fail(`${label} contains duplicate names`);
}

export function normalizeProtobufProjection(value) {
  exactKeys(value, ['schema', 'syntax', 'package', 'messages', 'enums', 'services'], 'projection');
  if (value.schema !== PROTOBUF_PROJECTION_SCHEMA) fail('projection.schema is unsupported');
  if (value.syntax !== 'proto3') fail('projection.syntax must be proto3');
  nonEmptyString(value.package, 'projection.package');
  if (!PACKAGE.test(value.package)) fail('projection.package must be a normalized protobuf package');
  for (const key of ['messages', 'enums', 'services']) {
    if (!Array.isArray(value[key])) fail(`projection.${key} must be an array`);
  }
  const messages = value.messages.map((item, index) => normalizeMessage(item, `projection.messages[${index}]`));
  const enums = value.enums.map((item, index) => normalizeEnum(item, `projection.enums[${index}]`));
  const services = value.services.map((item, index) => normalizeService(item, `projection.services[${index}]`));
  uniqueNamed(messages, 'projection.messages');
  uniqueNamed(enums, 'projection.enums');
  uniqueNamed(services, 'projection.services');
  return Object.freeze({
    schema: PROTOBUF_PROJECTION_SCHEMA,
    syntax: 'proto3',
    package: value.package,
    messages: messages.sort((left, right) => left.name.localeCompare(right.name)),
    enums: enums.sort((left, right) => left.name.localeCompare(right.name)),
    services: services.sort((left, right) => left.name.localeCompare(right.name)),
  });
}

function finding(ruleId, subject, message, baseline, current) {
  const body = { ruleId, subject, message, baseline, current };
  return Object.freeze({ ...body, fingerprint: sha256(canonicalStringify(body)) });
}

function pushFinding(findings, maxFindings, ...args) {
  // Retain one overflow sentinel so `truncated` means evidence was actually omitted,
  // not merely that the visible result count happened to equal the configured limit.
  if (findings.length <= maxFindings) findings.push(finding(...args));
}

function compareMessages(baseline, current, findings, maxFindings) {
  const currentByName = new Map(current.messages.map((item) => [item.name, item]));
  for (const before of baseline.messages) {
    const after = currentByName.get(before.name);
    if (!after) {
      pushFinding(findings, maxFindings, 'protobuf-message-removed', before.name,
        `message ${before.name} was removed`, before, null);
      continue;
    }
    const currentByNumber = new Map(after.fields.map((item) => [item.number, item]));
    const currentByFieldName = new Map(after.fields.map((item) => [item.name, item]));
    for (const field of before.fields) {
      const byNumber = currentByNumber.get(field.number);
      const byName = currentByFieldName.get(field.name);
      const subject = `${before.name}.${field.name}`;
      if (!byNumber && !byName) {
        const reservedNumber = after.reservedNumbers.includes(field.number);
        const reservedName = after.reservedNames.includes(field.name);
        if (!reservedNumber || !reservedName) {
          pushFinding(findings, maxFindings, 'protobuf-field-removal-not-reserved', subject,
            `removed field ${subject} must reserve both number ${field.number} and name ${field.name}`,
            field, { reservedNumber, reservedName });
        }
        continue;
      }
      if (byName && byName.number !== field.number) {
        pushFinding(findings, maxFindings, 'protobuf-field-number-changed', subject,
          `field ${subject} changed number from ${field.number} to ${byName.number}`, field, byName);
      }
      if (byNumber && byNumber.name !== field.name) {
        pushFinding(findings, maxFindings, 'protobuf-field-number-reused', subject,
          `field number ${field.number} was reused by ${byNumber.name}`, field, byNumber);
      }
      const matched = byNumber?.name === field.name ? byNumber : byName?.number === field.number ? byName : null;
      if (!matched) continue;
      for (const key of ['type', 'cardinality', 'presence', 'oneof', 'jsonName']) {
        if (matched[key] !== field[key]) {
          pushFinding(findings, maxFindings, `protobuf-field-${key}-changed`, subject,
            `field ${subject} changed ${key}`, field[key], matched[key]);
        }
      }
    }
    for (const field of after.fields) {
      if (before.reservedNumbers.includes(field.number)) {
        pushFinding(findings, maxFindings, 'protobuf-reserved-field-number-reused', `${after.name}.${field.name}`,
          `field ${after.name}.${field.name} reuses baseline-reserved number ${field.number}`, field.number, field);
      }
      if (before.reservedNames.includes(field.name)) {
        pushFinding(findings, maxFindings, 'protobuf-reserved-field-name-reused', `${after.name}.${field.name}`,
          `field ${after.name}.${field.name} reuses baseline-reserved name ${field.name}`, field.name, field);
      }
    }
  }
}

function compareEnums(baseline, current, findings, maxFindings) {
  const currentByName = new Map(current.enums.map((item) => [item.name, item]));
  for (const before of baseline.enums) {
    const after = currentByName.get(before.name);
    if (!after) {
      pushFinding(findings, maxFindings, 'protobuf-enum-removed', before.name,
        `enum ${before.name} was removed`, before, null);
      continue;
    }
    const currentByNumber = new Map(after.values.map((item) => [item.number, item]));
    const currentByValueName = new Map(after.values.map((item) => [item.name, item]));
    for (const item of before.values) {
      const byNumber = currentByNumber.get(item.number);
      const byName = currentByValueName.get(item.name);
      const subject = `${before.name}.${item.name}`;
      if (!byNumber && !byName) {
        const reservedNumber = after.reservedNumbers.includes(item.number);
        const reservedName = after.reservedNames.includes(item.name);
        if (!reservedNumber || !reservedName) {
          pushFinding(findings, maxFindings, 'protobuf-enum-value-removal-not-reserved', subject,
            `removed enum value ${subject} must reserve both number ${item.number} and name ${item.name}`,
            item, { reservedNumber, reservedName });
        }
        continue;
      }
      if (byName && byName.number !== item.number) {
        pushFinding(findings, maxFindings, 'protobuf-enum-number-changed', subject,
          `enum value ${subject} changed number`, item, byName);
      }
      if (byNumber && byNumber.name !== item.name) {
        pushFinding(findings, maxFindings, 'protobuf-enum-number-reused', subject,
          `enum number ${item.number} was reused by ${byNumber.name}`, item, byNumber);
      }
    }
    for (const item of after.values) {
      if (before.reservedNumbers.includes(item.number)) {
        pushFinding(findings, maxFindings, 'protobuf-reserved-enum-number-reused', `${after.name}.${item.name}`,
          `enum value ${after.name}.${item.name} reuses baseline-reserved number ${item.number}`, item.number, item);
      }
      if (before.reservedNames.includes(item.name)) {
        pushFinding(findings, maxFindings, 'protobuf-reserved-enum-name-reused', `${after.name}.${item.name}`,
          `enum value ${after.name}.${item.name} reuses baseline-reserved name ${item.name}`, item.name, item);
      }
    }
  }
}

function compareServices(baseline, current, findings, maxFindings) {
  const currentByName = new Map(current.services.map((item) => [item.name, item]));
  for (const before of baseline.services) {
    const after = currentByName.get(before.name);
    if (!after) {
      pushFinding(findings, maxFindings, 'protobuf-service-removed', before.name,
        `service ${before.name} was removed`, before, null);
      continue;
    }
    const currentMethods = new Map(after.methods.map((item) => [item.name, item]));
    for (const method of before.methods) {
      const next = currentMethods.get(method.name);
      const subject = `${before.name}.${method.name}`;
      if (!next) {
        pushFinding(findings, maxFindings, 'protobuf-method-removed', subject,
          `RPC method ${subject} was removed`, method, null);
        continue;
      }
      for (const key of [
        'inputType', 'outputType', 'clientStreaming', 'serverStreaming', 'errorModel',
      ]) {
        if (next[key] !== method[key]) {
          pushFinding(findings, maxFindings, `protobuf-method-${key}-changed`, subject,
            `RPC method ${subject} changed ${key}`, method[key], next[key]);
        }
      }
    }
  }
}

export function compareProtobufCompatibility(baselineValue, currentValue, options = {}) {
  const maxFindings = options.maxFindings ?? 250;
  if (!Number.isSafeInteger(maxFindings) || maxFindings < 1 || maxFindings > 10_000) {
    fail('maxFindings must be a safe integer between 1 and 10000');
  }
  const baseline = normalizeProtobufProjection(baselineValue);
  const current = normalizeProtobufProjection(currentValue);
  const findings = [];
  if (baseline.package !== current.package) {
    pushFinding(findings, maxFindings, 'protobuf-package-changed', 'package',
      `protobuf package changed from ${baseline.package} to ${current.package}`,
      baseline.package, current.package);
  }
  compareMessages(baseline, current, findings, maxFindings);
  compareEnums(baseline, current, findings, maxFindings);
  compareServices(baseline, current, findings, maxFindings);
  const truncated = findings.length > maxFindings;
  const visibleFindings = findings.slice(0, maxFindings);
  return Object.freeze({
    baseline,
    current,
    baselineDigest: sha256(canonicalStringify(baseline)),
    currentDigest: sha256(canonicalStringify(current)),
    status: findings.length === 0 ? 'passed' : 'stopped_for_evaluation',
    admissible: findings.length === 0,
    findings: Object.freeze(visibleFindings),
    truncated,
  });
}

function receiptBody(result, failureCode = null) {
  return {
    schema: PROTOBUF_COMPATIBILITY_RECEIPT_SCHEMA,
    status: result.status,
    admissible: result.status === 'passed',
    baselineDigest: result.baselineDigest ?? null,
    currentDigest: result.currentDigest ?? null,
    breakingChangeCount: Array.isArray(result.findings) ? result.findings.length : 0,
    truncated: result.truncated === true,
    breakingChanges: Array.isArray(result.findings) ? result.findings : [],
    failureCode: result.status === 'passed'
      ? null
      : failureCode ?? (result.status === 'stopped_for_evaluation'
        ? 'protobuf-breaking-change-detected'
        : 'protobuf-compatibility-verification-failed'),
  };
}

export function createProtobufCompatibilityReceipt({ baseline, current, maxFindings } = {}) {
  const result = compareProtobufCompatibility(baseline, current, { maxFindings });
  const body = receiptBody(result);
  return Object.freeze({ ...body, verificationId: sha256(canonicalStringify(body)) });
}

export function failedProtobufCompatibilityReceipt({ baseline, current } = {}) {
  let baselineDigest = null;
  let currentDigest = null;
  try { baselineDigest = sha256(canonicalStringify(normalizeProtobufProjection(baseline))); } catch {}
  try { currentDigest = sha256(canonicalStringify(normalizeProtobufProjection(current))); } catch {}
  const body = receiptBody({
    status: 'failed',
    baselineDigest,
    currentDigest,
    findings: [],
    truncated: false,
  }, 'protobuf-compatibility-verification-failed');
  return Object.freeze({ ...body, verificationId: sha256(canonicalStringify(body)) });
}

function validDigest(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function exactReceiptKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function safeFinding(value) {
  const keys = ['ruleId', 'subject', 'message', 'baseline', 'current', 'fingerprint'];
  if (!exactReceiptKeys(value, keys)) return false;
  if (typeof value.ruleId !== 'string' || !/^protobuf-[a-zA-Z0-9-]+$/u.test(value.ruleId)) return false;
  if (typeof value.subject !== 'string' || value.subject.length === 0) return false;
  if (typeof value.message !== 'string' || value.message.length === 0) return false;
  const { fingerprint, ...body } = value;
  return validDigest(fingerprint) && fingerprint === sha256(canonicalStringify(body));
}

function safeReceipt(value) {
  const keys = [
    'schema', 'status', 'admissible', 'baselineDigest', 'currentDigest',
    'breakingChangeCount', 'truncated', 'breakingChanges', 'failureCode', 'verificationId',
  ];
  if (!exactReceiptKeys(value, keys) || value.schema !== PROTOBUF_COMPATIBILITY_RECEIPT_SCHEMA) return false;
  if (!['passed', 'stopped_for_evaluation', 'failed'].includes(value.status)) return false;
  if (typeof value.admissible !== 'boolean' || value.admissible !== (value.status === 'passed')) return false;
  if (![value.baselineDigest, value.currentDigest].every((item) => item === null || validDigest(item))) return false;
  if (!Number.isSafeInteger(value.breakingChangeCount) || value.breakingChangeCount < 0) return false;
  if (typeof value.truncated !== 'boolean' || !Array.isArray(value.breakingChanges)) return false;
  if (value.breakingChangeCount !== value.breakingChanges.length
    || !value.breakingChanges.every(safeFinding)) return false;
  if (value.status === 'passed' && (
    !validDigest(value.baselineDigest) || !validDigest(value.currentDigest)
    || value.breakingChangeCount !== 0 || value.truncated || value.failureCode !== null
  )) return false;
  if (value.status === 'stopped_for_evaluation' && (
    !validDigest(value.baselineDigest) || !validDigest(value.currentDigest)
    || value.breakingChangeCount === 0 || value.failureCode !== 'protobuf-breaking-change-detected'
  )) return false;
  if (value.status === 'failed' && (
    value.breakingChangeCount !== 0 || value.truncated
    || value.failureCode !== 'protobuf-compatibility-verification-failed'
  )) return false;
  const { verificationId, ...body } = value;
  return validDigest(verificationId) && verificationId === sha256(canonicalStringify(body));
}

async function inspectExistingDestination(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new UnsafeProtobufCompatibilityReceiptDestinationError(
        'refusing to replace protobuf compatibility evidence unless it is a singly linked regular file',
      );
    }
    let existing;
    try { existing = JSON.parse(await readFile(path, 'utf8')); } catch {
      throw new UnsafeProtobufCompatibilityReceiptDestinationError(
        'refusing to replace an unrecognized protobuf compatibility evidence file',
      );
    }
    if (!safeReceipt(existing)) {
      throw new UnsafeProtobufCompatibilityReceiptDestinationError(
        'refusing to replace an unrecognized protobuf compatibility evidence file',
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
    && before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

export async function writeProtobufCompatibilityReceipt(path, receipt) {
  if (!safeReceipt(receipt)) {
    throw new UnsafeProtobufCompatibilityReceiptDestinationError(
      'refusing to write malformed protobuf compatibility evidence',
    );
  }
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const before = await inspectExistingDestination(target);
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
      await link(temporary, target);
      await unlink(temporary);
    } else {
      const after = await inspectExistingDestination(target);
      if (!unchanged(before, after)) {
        throw new UnsafeProtobufCompatibilityReceiptDestinationError(
          'protobuf compatibility evidence changed during replacement',
        );
      }
      await rename(temporary, target);
    }
    const finalInfo = await lstat(target);
    if (!finalInfo.isFile() || finalInfo.isSymbolicLink() || finalInfo.nlink !== 1) {
      throw new UnsafeProtobufCompatibilityReceiptDestinationError(
        'protobuf compatibility evidence did not land safely',
      );
    }
    return target;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
