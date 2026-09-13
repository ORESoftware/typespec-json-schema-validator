import { canonicalStringify, isPlainObject, sha256 } from './canonical.mjs';

export const BEHAVIOR_CONTRACT_SCHEMA =
  'ores.typespec-json-schema-validator.behavior-contract/v1';
export const BEHAVIOR_AUTHORITY = 'independently-authored-behavioral-authority';

const KINDS = new Set([
  'expression',
  'predicate',
  'validator',
  'transform',
  'policy',
  'state_machine',
  'algorithm',
  'procedure',
  'external',
]);
const LANGUAGES = new Set(['cel', 'cue', 'rego', 'dafny', 'pseudocode', 'none']);
const EXPRESSION_KINDS = new Set(['expression', 'predicate', 'validator', 'transform', 'policy']);
const ALGORITHM_KINDS = new Set(['state_machine', 'algorithm', 'procedure']);
const EFFECT_KINDS = new Set([
  'read',
  'write',
  'emit',
  'network',
  'clock',
  'random',
  'storage',
  'authz',
  'external',
]);

export class BehaviorContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BehaviorContractError';
  }
}

function fail(message) {
  throw new BehaviorContractError(message);
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
  if (typeof value !== 'string' || value.trim().length === 0 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a non-empty control-free string`);
  }
  return value;
}

function optionalText(value, label) {
  return value === null ? null : nonEmptyString(value, label);
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const normalized = value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(`${label} must not contain duplicates`);
  return normalized;
}

function normalizeInput(value, label) {
  exactKeys(value, ['name', 'type', 'required'], label);
  return {
    name: nonEmptyString(value.name, `${label}.name`),
    type: nonEmptyString(value.type, `${label}.type`),
    required: booleanValue(value.required, `${label}.required`),
  };
}

function normalizeOutput(value, label) {
  exactKeys(value, ['type', 'nullable'], label);
  return {
    type: nonEmptyString(value.type, `${label}.type`),
    nullable: booleanValue(value.nullable, `${label}.nullable`),
  };
}

function normalizeEffect(value, label) {
  exactKeys(value, ['kind', 'resource'], label);
  const kind = nonEmptyString(value.kind, `${label}.kind`);
  if (!EFFECT_KINDS.has(kind)) fail(`${label}.kind is unsupported`);
  return {
    kind,
    resource: nonEmptyString(value.resource, `${label}.resource`),
  };
}

function normalizeError(value, label) {
  exactKeys(value, ['code', 'when'], label);
  return {
    code: nonEmptyString(value.code, `${label}.code`),
    when: nonEmptyString(value.when, `${label}.when`),
  };
}

function normalizeBehaviorPayload(value, label) {
  exactKeys(value, [
    'kind',
    'language',
    'executable',
    'inputs',
    'output',
    'requires',
    'ensures',
    'invariants',
    'expression',
    'algorithm',
    'effects',
    'errors',
    'deterministic',
    'idempotent',
    'pure',
  ], label);

  const kind = nonEmptyString(value.kind, `${label}.kind`);
  if (!KINDS.has(kind)) fail(`${label}.kind is unsupported`);
  const language = nonEmptyString(value.language, `${label}.language`);
  if (!LANGUAGES.has(language)) fail(`${label}.language is unsupported`);
  const executable = booleanValue(value.executable, `${label}.executable`);

  if (!Array.isArray(value.inputs)) fail(`${label}.inputs must be an array`);
  const inputs = value.inputs.map((item, index) => normalizeInput(item, `${label}.inputs[${index}]`));
  const inputNames = inputs.map((item) => item.name);
  if (new Set(inputNames).size !== inputNames.length) fail(`${label}.inputs contains duplicate names`);

  const output = value.output === null ? null : normalizeOutput(value.output, `${label}.output`);
  const expression = optionalText(value.expression, `${label}.expression`);
  const algorithm = optionalText(value.algorithm, `${label}.algorithm`);
  const requires = stringArray(value.requires, `${label}.requires`);
  const ensures = stringArray(value.ensures, `${label}.ensures`);
  const invariants = stringArray(value.invariants, `${label}.invariants`);

  if (!Array.isArray(value.effects)) fail(`${label}.effects must be an array`);
  const effects = value.effects.map((item, index) => normalizeEffect(item, `${label}.effects[${index}]`));
  const effectKeys = effects.map((item) => `${item.kind}\u0000${item.resource}`);
  if (new Set(effectKeys).size !== effectKeys.length) fail(`${label}.effects must not contain duplicates`);

  if (!Array.isArray(value.errors)) fail(`${label}.errors must be an array`);
  const errors = value.errors.map((item, index) => normalizeError(item, `${label}.errors[${index}]`));
  const errorCodes = errors.map((item) => item.code);
  if (new Set(errorCodes).size !== errorCodes.length) fail(`${label}.errors contains duplicate codes`);

  const deterministic = booleanValue(value.deterministic, `${label}.deterministic`);
  const idempotent = booleanValue(value.idempotent, `${label}.idempotent`);
  const pure = booleanValue(value.pure, `${label}.pure`);

  if (EXPRESSION_KINDS.has(kind) && expression === null) {
    fail(`${label}.expression is required for ${kind}`);
  }
  if (ALGORITHM_KINDS.has(kind) && algorithm === null) {
    fail(`${label}.algorithm is required for ${kind}`);
  }
  if (kind === 'external' && expression !== null) {
    fail(`${label}.expression must be null for external behavior`);
  }
  if ((language === 'pseudocode' || language === 'none') && executable) {
    fail(`${label}.executable cannot be true for ${language}`);
  }
  if (language === 'none' && (expression !== null || algorithm !== null)) {
    fail(`${label} cannot contain expression or algorithm when language is none`);
  }
  if (pure && effects.length > 0) fail(`${label}.pure behavior cannot declare effects`);
  if (pure && (!deterministic || !idempotent)) {
    fail(`${label}.pure behavior must be deterministic and idempotent`);
  }
  if (kind === 'state_machine' && pure) fail(`${label}.state_machine cannot be pure`);

  return Object.freeze({
    kind,
    language,
    executable,
    inputs: Object.freeze(inputs),
    output: output === null ? null : Object.freeze(output),
    requires: Object.freeze(requires),
    ensures: Object.freeze(ensures),
    invariants: Object.freeze(invariants),
    expression,
    algorithm,
    effects: Object.freeze(effects),
    errors: Object.freeze(errors),
    deterministic,
    idempotent,
    pure,
  });
}

export function normalizeEmbeddedBehavior(value) {
  return normalizeBehaviorPayload(value, 'behavior');
}

export function normalizeBehaviorOperation(value) {
  if (!isPlainObject(value)) fail('operation must be an object');
  const { operationId, ...payload } = value;
  const expected = [
    'operationId',
    'kind',
    'language',
    'executable',
    'inputs',
    'output',
    'requires',
    'ensures',
    'invariants',
    'expression',
    'algorithm',
    'effects',
    'errors',
    'deterministic',
    'idempotent',
    'pure',
  ];
  exactKeys(value, expected, 'operation');
  return Object.freeze({
    operationId: nonEmptyString(operationId, 'operation.operationId'),
    ...normalizeBehaviorPayload(payload, 'operation'),
  });
}

export function normalizeBehaviorContract(value) {
  exactKeys(value, ['schema', 'authority', 'operations'], 'contract');
  if (value.schema !== BEHAVIOR_CONTRACT_SCHEMA) fail('contract.schema is unsupported');
  if (value.authority !== BEHAVIOR_AUTHORITY) fail('contract.authority is unsupported');
  if (!Array.isArray(value.operations)) fail('contract.operations must be an array');
  const operations = value.operations.map((item) => normalizeBehaviorOperation(item));
  const ids = operations.map((item) => item.operationId);
  if (new Set(ids).size !== ids.length) fail('contract.operations contains duplicate operationId values');
  return Object.freeze({
    schema: BEHAVIOR_CONTRACT_SCHEMA,
    authority: BEHAVIOR_AUTHORITY,
    operations: Object.freeze(operations.sort((left, right) => left.operationId.localeCompare(right.operationId))),
  });
}

export function behaviorContractDigest(value) {
  return sha256(canonicalStringify(normalizeBehaviorContract(value)));
}

export function behaviorByOperation(value) {
  const contract = normalizeBehaviorContract(value);
  return new Map(contract.operations.map((operation) => [operation.operationId, operation]));
}
