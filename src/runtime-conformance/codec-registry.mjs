import { canonicalStringify, isPlainObject, sha256 } from '../canonical.mjs';

export const BINARY_PAYLOAD_CODEC_REGISTRY_SCHEMA =
  'ores.typespec-json-schema-validator.binary-payload-codec-registry/v1';
export const BINARY_PAYLOAD_CODEC_REGISTRY_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.binary-payload-codec-registry-receipt/v1';

export const BINARY_PAYLOAD_CODEC_REGISTRY = Object.freeze([
  Object.freeze({
    name: 'json',
    wireId: 1,
    mediaType: 'application/json',
    mediaTypeAliases: Object.freeze([]),
  }),
  Object.freeze({
    name: 'messagepack',
    wireId: 2,
    mediaType: 'application/msgpack',
    mediaTypeAliases: Object.freeze(['application/x-msgpack']),
  }),
  Object.freeze({
    name: 'cbor',
    wireId: 3,
    mediaType: 'application/cbor',
    mediaTypeAliases: Object.freeze([]),
  }),
  Object.freeze({
    name: 'protobuf',
    wireId: 4,
    mediaType: 'application/x-protobuf',
    mediaTypeAliases: Object.freeze(['application/protobuf']),
  }),
  Object.freeze({
    name: 'raw',
    wireId: 5,
    mediaType: 'application/octet-stream',
    mediaTypeAliases: Object.freeze([]),
  }),
]);

const REGISTRY_NAMES = new Set(BINARY_PAYLOAD_CODEC_REGISTRY.map((codec) => codec.name));
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;

export class BinaryPayloadCodecRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BinaryPayloadCodecRegistryError';
  }
}

function fail(message) {
  throw new BinaryPayloadCodecRegistryError(message);
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) {
    fail(`${label} must be an object`);
  }
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

function codecName(value, label) {
  const name = nonEmptyString(value, label);
  if (!REGISTRY_NAMES.has(name)) {
    fail(`${label} is not a canonical binary-payload codec name`);
  }
  return name;
}

function wireId(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 255) {
    fail(`${label} must be an integer from 1 to 255`);
  }
  return value;
}

function mediaType(value, label) {
  const normalized = nonEmptyString(value, label).toLowerCase();
  if (!MEDIA_TYPE.test(normalized)) {
    fail(`${label} must be a normalized media type without parameters`);
  }
  return normalized;
}

function normalizeCodec(value, index) {
  const label = `registry.codecs[${index}]`;
  exactKeys(value, ['name', 'wireId', 'mediaType', 'mediaTypeAliases'], label);
  if (!Array.isArray(value.mediaTypeAliases)) {
    fail(`${label}.mediaTypeAliases must be an array`);
  }
  const aliases = value.mediaTypeAliases.map((alias, aliasIndex) =>
    mediaType(alias, `${label}.mediaTypeAliases[${aliasIndex}]`));
  if (new Set(aliases).size !== aliases.length) {
    fail(`${label}.mediaTypeAliases must not contain duplicates`);
  }
  return Object.freeze({
    name: codecName(value.name, `${label}.name`),
    wireId: wireId(value.wireId, `${label}.wireId`),
    mediaType: mediaType(value.mediaType, `${label}.mediaType`),
    mediaTypeAliases: Object.freeze([...aliases].sort()),
  });
}

export function normalizeBinaryPayloadCodecRegistry(value) {
  exactKeys(value, ['schema', 'codecs'], 'registry');
  if (value.schema !== BINARY_PAYLOAD_CODEC_REGISTRY_SCHEMA) {
    fail('registry.schema is unsupported');
  }
  if (!Array.isArray(value.codecs)) {
    fail('registry.codecs must be an array');
  }
  const codecs = value.codecs.map(normalizeCodec);
  const names = codecs.map((codec) => codec.name);
  const ids = codecs.map((codec) => codec.wireId);
  if (new Set(names).size !== names.length) {
    fail('registry.codecs contains duplicate canonical names');
  }
  if (new Set(ids).size !== ids.length) {
    fail('registry.codecs contains duplicate wire ids');
  }
  return Object.freeze({
    schema: BINARY_PAYLOAD_CODEC_REGISTRY_SCHEMA,
    codecs: Object.freeze([...codecs].sort((left, right) => left.wireId - right.wireId)),
  });
}

export function canonicalBinaryPayloadCodecRegistry() {
  return Object.freeze({
    schema: BINARY_PAYLOAD_CODEC_REGISTRY_SCHEMA,
    codecs: BINARY_PAYLOAD_CODEC_REGISTRY,
  });
}

function finding(ruleId, subject, message, expected, actual) {
  const body = { ruleId, subject, message, expected, actual };
  return Object.freeze({ ...body, fingerprint: sha256(canonicalStringify(body)) });
}

export function verifyBinaryPayloadCodecRegistry(value) {
  let normalized = null;
  try {
    normalized = normalizeBinaryPayloadCodecRegistry(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const findings = Object.freeze([
      finding('binary-codec-registry-invalid', 'registry', message, canonicalBinaryPayloadCodecRegistry(), value),
    ]);
    return Object.freeze({
      schema: BINARY_PAYLOAD_CODEC_REGISTRY_RECEIPT_SCHEMA,
      status: 'failed',
      admissible: false,
      registryDigest: null,
      findings,
    });
  }

  const expected = canonicalBinaryPayloadCodecRegistry();
  const findings = [];
  const expectedByName = new Map(expected.codecs.map((codec) => [codec.name, codec]));
  const actualByName = new Map(normalized.codecs.map((codec) => [codec.name, codec]));

  for (const expectedCodec of expected.codecs) {
    const actualCodec = actualByName.get(expectedCodec.name);
    if (!actualCodec) {
      findings.push(finding(
        'binary-codec-missing',
        expectedCodec.name,
        `canonical codec ${expectedCodec.name} is missing`,
        expectedCodec,
        null,
      ));
      continue;
    }
    if (canonicalStringify(actualCodec) !== canonicalStringify(expectedCodec)) {
      findings.push(finding(
        'binary-codec-definition-drift',
        expectedCodec.name,
        `codec ${expectedCodec.name} disagrees with the canonical wire registry`,
        expectedCodec,
        actualCodec,
      ));
    }
  }

  for (const actualCodec of normalized.codecs) {
    if (!expectedByName.has(actualCodec.name)) {
      findings.push(finding(
        'binary-codec-unexpected',
        actualCodec.name,
        `codec ${actualCodec.name} is not present in the canonical wire registry`,
        null,
        actualCodec,
      ));
    }
  }

  const frozenFindings = Object.freeze(findings);
  return Object.freeze({
    schema: BINARY_PAYLOAD_CODEC_REGISTRY_RECEIPT_SCHEMA,
    status: frozenFindings.length === 0 ? 'passed' : 'failed',
    admissible: frozenFindings.length === 0,
    registryDigest: sha256(canonicalStringify(normalized)),
    findings: frozenFindings,
  });
}
