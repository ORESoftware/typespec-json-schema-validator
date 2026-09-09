export type ProtobufCompatibilityStatus = 'passed' | 'stopped_for_evaluation' | 'failed';
export type ProtobufFieldCardinality = 'singular' | 'optional' | 'repeated';
export type ProtobufFieldPresence = 'implicit' | 'explicit';

export interface ProtobufFieldProjection {
  name: string;
  number: number;
  type: string;
  cardinality: ProtobufFieldCardinality;
  presence: ProtobufFieldPresence;
  oneof: string | null;
  jsonName: string | null;
}

export interface ProtobufMessageProjection {
  name: string;
  fields: ProtobufFieldProjection[];
  reservedNumbers: number[];
  reservedNames: string[];
}

export interface ProtobufEnumValueProjection {
  name: string;
  number: number;
}

export interface ProtobufEnumProjection {
  name: string;
  values: ProtobufEnumValueProjection[];
  reservedNumbers: number[];
  reservedNames: string[];
}

export interface ProtobufMethodProjection {
  name: string;
  inputType: string;
  outputType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  errorModel: string | null;
}

export interface ProtobufServiceProjection {
  name: string;
  methods: ProtobufMethodProjection[];
}

export interface ProtobufProjection {
  schema: 'ores.typespec-json-schema-validator.protobuf-projection/v1';
  syntax: 'proto3';
  package: string;
  messages: ProtobufMessageProjection[];
  enums: ProtobufEnumProjection[];
  services: ProtobufServiceProjection[];
}

export interface ProtobufCompatibilityFinding {
  ruleId: string;
  subject: string;
  message: string;
  baseline: unknown;
  current: unknown;
  fingerprint: string;
}

export interface ProtobufCompatibilityResult {
  baseline: ProtobufProjection;
  current: ProtobufProjection;
  baselineDigest: string;
  currentDigest: string;
  status: 'passed' | 'stopped_for_evaluation';
  admissible: boolean;
  findings: readonly ProtobufCompatibilityFinding[];
  truncated: boolean;
}

export interface ProtobufCompatibilityReceipt {
  schema: 'ores.typespec-json-schema-validator.protobuf-compatibility-receipt/v1';
  status: ProtobufCompatibilityStatus;
  admissible: boolean;
  baselineDigest: string | null;
  currentDigest: string | null;
  breakingChangeCount: number;
  truncated: boolean;
  breakingChanges: readonly ProtobufCompatibilityFinding[];
  failureCode: 'protobuf-breaking-change-detected' | 'protobuf-compatibility-verification-failed' | null;
  verificationId: string;
}

export declare const PROTOBUF_PROJECTION_SCHEMA: 'ores.typespec-json-schema-validator.protobuf-projection/v1';
export declare const PROTOBUF_COMPATIBILITY_RECEIPT_SCHEMA: 'ores.typespec-json-schema-validator.protobuf-compatibility-receipt/v1';

export declare class ProtobufProjectionError extends Error {}
export declare class UnsafeProtobufCompatibilityReceiptDestinationError extends Error {}

export declare function normalizeProtobufProjection(value: unknown): ProtobufProjection;
export declare function compareProtobufCompatibility(
  baseline: unknown,
  current: unknown,
  options?: { maxFindings?: number },
): ProtobufCompatibilityResult;
export declare function createProtobufCompatibilityReceipt(input: {
  baseline: unknown;
  current: unknown;
  maxFindings?: number;
}): ProtobufCompatibilityReceipt;
export declare function failedProtobufCompatibilityReceipt(input?: {
  baseline?: unknown;
  current?: unknown;
}): ProtobufCompatibilityReceipt;
export declare function writeProtobufCompatibilityReceipt(
  path: string,
  receipt: ProtobufCompatibilityReceipt,
): Promise<string>;
