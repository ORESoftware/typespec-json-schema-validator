export interface BinaryPayloadCodecDefinition {
  name: 'json' | 'messagepack' | 'cbor' | 'protobuf' | 'raw';
  wireId: 1 | 2 | 3 | 4 | 5;
  mediaType: string;
  mediaTypeAliases: readonly string[];
}

export interface BinaryPayloadCodecRegistry {
  schema: typeof BINARY_PAYLOAD_CODEC_REGISTRY_SCHEMA;
  codecs: readonly BinaryPayloadCodecDefinition[];
}

export interface BinaryPayloadCodecRegistryFinding {
  ruleId: string;
  subject: string;
  message: string;
  expected: unknown;
  actual: unknown;
  fingerprint: string;
}

export interface BinaryPayloadCodecRegistryReceipt {
  schema: typeof BINARY_PAYLOAD_CODEC_REGISTRY_RECEIPT_SCHEMA;
  status: 'passed' | 'failed';
  admissible: boolean;
  registryDigest: string | null;
  findings: readonly BinaryPayloadCodecRegistryFinding[];
}

export const BINARY_PAYLOAD_CODEC_REGISTRY_SCHEMA:
  'ores.typespec-json-schema-validator.binary-payload-codec-registry/v1';
export const BINARY_PAYLOAD_CODEC_REGISTRY_RECEIPT_SCHEMA:
  'ores.typespec-json-schema-validator.binary-payload-codec-registry-receipt/v1';
export const BINARY_PAYLOAD_CODEC_REGISTRY: readonly BinaryPayloadCodecDefinition[];

export class BinaryPayloadCodecRegistryError extends Error {}

export function normalizeBinaryPayloadCodecRegistry(
  value: unknown,
): Readonly<BinaryPayloadCodecRegistry>;

export function canonicalBinaryPayloadCodecRegistry(): Readonly<BinaryPayloadCodecRegistry>;

export function verifyBinaryPayloadCodecRegistry(
  value: unknown,
): Readonly<BinaryPayloadCodecRegistryReceipt>;
