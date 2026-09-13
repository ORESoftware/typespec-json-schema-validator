import { canonicalStringify, isPlainObject, sha256 } from './canonical.mjs';
import { normalizeBehaviorContract } from './behavior-contract.mjs';
import { normalizeProtobufProjection } from './protobuf-compatibility.mjs';

export const PROTOBUF_BEHAVIOR_BINDINGS_SCHEMA =
  'ores.typespec-json-schema-validator.protobuf-behavior-bindings/v1';
export const PROTOBUF_BEHAVIOR_BINDINGS_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.protobuf-behavior-bindings-receipt/v1';

export class ProtobufBehaviorBindingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProtobufBehaviorBindingsError';
  }
}

function fail(message) {
  throw new ProtobufBehaviorBindingsError(message);
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    fail(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a non-empty control-free string`);
  }
  return value;
}

function normalizeBinding(value, label) {
  exactKeys(value, ['service', 'method', 'operationId'], label);
  return Object.freeze({
    service: nonEmpty(value.service, `${label}.service`),
    method: nonEmpty(value.method, `${label}.method`),
    operationId: nonEmpty(value.operationId, `${label}.operationId`),
  });
}

export function normalizeProtobufBehaviorBindings(value) {
  exactKeys(value, ['schema', 'package', 'bindings'], 'bindings');
  if (value.schema !== PROTOBUF_BEHAVIOR_BINDINGS_SCHEMA) fail('bindings.schema is unsupported');
  if (!Array.isArray(value.bindings)) fail('bindings.bindings must be an array');
  const bindings = value.bindings
    .map((item, index) => normalizeBinding(item, `bindings.bindings[${index}]`))
    .sort((left, right) => left.service.localeCompare(right.service)
      || left.method.localeCompare(right.method));
  const rpcKeys = bindings.map((item) => `${item.service}\u0000${item.method}`);
  if (new Set(rpcKeys).size !== rpcKeys.length) {
    fail('bindings.bindings contains duplicate service/method pairs');
  }
  return Object.freeze({
    schema: PROTOBUF_BEHAVIOR_BINDINGS_SCHEMA,
    package: nonEmpty(value.package, 'bindings.package'),
    bindings: Object.freeze(bindings),
  });
}

function finding(ruleId, subject, message, expected, actual) {
  const body = { ruleId, subject, message, expected, actual };
  return Object.freeze({ ...body, fingerprint: sha256(canonicalStringify(body)) });
}

function rpcIndex(projection) {
  const index = new Map();
  for (const service of projection.services) {
    for (const method of service.methods) {
      index.set(`${service.name}\u0000${method.name}`, { service, method });
    }
  }
  return index;
}

export function verifyProtobufBehaviorBindings(input = {}) {
  if (!isPlainObject(input)) fail('input must be an object');
  const projection = normalizeProtobufProjection(input.projection);
  const bindings = normalizeProtobufBehaviorBindings(input.bindings);
  const behaviorContract = input.behaviorContract === undefined || input.behaviorContract === null
    ? null
    : normalizeBehaviorContract(input.behaviorContract);
  const requireAllMethods = input.requireAllMethods === true;
  const findings = [];

  if (projection.package !== bindings.package) {
    findings.push(finding(
      'protobuf-behavior-package-mismatch',
      'package',
      'behavior bindings package must match the normalized protobuf projection package',
      projection.package,
      bindings.package,
    ));
  }

  const methods = rpcIndex(projection);
  const boundRpcKeys = new Set();
  const behaviorIds = behaviorContract === null
    ? null
    : new Set(behaviorContract.operations.map((operation) => operation.operationId));

  for (const binding of bindings.bindings) {
    const rpcKey = `${binding.service}\u0000${binding.method}`;
    boundRpcKeys.add(rpcKey);
    if (!methods.has(rpcKey)) {
      findings.push(finding(
        'protobuf-behavior-rpc-missing',
        `${binding.service}.${binding.method}`,
        'behavior binding targets an RPC method absent from the normalized protobuf projection',
        { service: binding.service, method: binding.method },
        null,
      ));
    }
    if (behaviorIds !== null && !behaviorIds.has(binding.operationId)) {
      findings.push(finding(
        'protobuf-behavior-operation-missing',
        `${binding.service}.${binding.method}`,
        'behavior binding references an operation ID absent from the behavioral authority',
        binding.operationId,
        null,
      ));
    }
  }

  if (requireAllMethods) {
    for (const [rpcKey, value] of methods) {
      if (!boundRpcKeys.has(rpcKey)) {
        findings.push(finding(
          'protobuf-behavior-rpc-unbound',
          `${value.service.name}.${value.method.name}`,
          'protobuf behavior policy requires every RPC method to bind to a behavioral operation ID',
          'behavior binding',
          null,
        ));
      }
    }
  }

  findings.sort((left, right) => left.subject.localeCompare(right.subject)
    || left.ruleId.localeCompare(right.ruleId));
  const status = findings.length === 0 ? 'passed' : 'stopped_for_evaluation';
  return Object.freeze({
    projection,
    bindings,
    behaviorContract,
    projectionDigest: sha256(canonicalStringify(projection)),
    bindingsDigest: sha256(canonicalStringify(bindings)),
    behaviorContractDigest: behaviorContract === null
      ? null
      : sha256(canonicalStringify(behaviorContract)),
    requireAllMethods,
    status,
    admissible: status === 'passed',
    findings: Object.freeze(findings),
  });
}

export function createProtobufBehaviorBindingsReceipt(input = {}) {
  const result = verifyProtobufBehaviorBindings(input);
  const body = {
    schema: PROTOBUF_BEHAVIOR_BINDINGS_RECEIPT_SCHEMA,
    status: result.status,
    admissible: result.admissible,
    projectionDigest: result.projectionDigest,
    bindingsDigest: result.bindingsDigest,
    behaviorContractDigest: result.behaviorContractDigest,
    requireAllMethods: result.requireAllMethods,
    findings: result.findings,
  };
  return Object.freeze({ ...body, verificationId: sha256(canonicalStringify(body)) });
}
