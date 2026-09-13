import type { BehaviorContract } from './behavior-contract.mjs';
import type { ProtobufProjection } from './protobuf-compatibility.mjs';

export interface ProtobufBehaviorBinding {
  service: string;
  method: string;
  operationId: string;
}

export interface ProtobufBehaviorBindings {
  schema: 'ores.typespec-json-schema-validator.protobuf-behavior-bindings/v1';
  package: string;
  bindings: readonly ProtobufBehaviorBinding[];
}

export interface ProtobufBehaviorBindingFinding {
  ruleId: string;
  subject: string;
  message: string;
  expected: unknown;
  actual: unknown;
  fingerprint: string;
}

export interface ProtobufBehaviorBindingsResult {
  projection: ProtobufProjection;
  bindings: ProtobufBehaviorBindings;
  behaviorContract: BehaviorContract | null;
  projectionDigest: string;
  bindingsDigest: string;
  behaviorContractDigest: string | null;
  requireAllMethods: boolean;
  status: 'passed' | 'stopped_for_evaluation';
  admissible: boolean;
  findings: readonly ProtobufBehaviorBindingFinding[];
}

export interface ProtobufBehaviorBindingsReceipt {
  schema: 'ores.typespec-json-schema-validator.protobuf-behavior-bindings-receipt/v1';
  status: 'passed' | 'stopped_for_evaluation';
  admissible: boolean;
  projectionDigest: string;
  bindingsDigest: string;
  behaviorContractDigest: string | null;
  requireAllMethods: boolean;
  findings: readonly ProtobufBehaviorBindingFinding[];
  verificationId: string;
}

export declare const PROTOBUF_BEHAVIOR_BINDINGS_SCHEMA:
  'ores.typespec-json-schema-validator.protobuf-behavior-bindings/v1';
export declare const PROTOBUF_BEHAVIOR_BINDINGS_RECEIPT_SCHEMA:
  'ores.typespec-json-schema-validator.protobuf-behavior-bindings-receipt/v1';
export declare class ProtobufBehaviorBindingsError extends Error {}

export declare function normalizeProtobufBehaviorBindings(value: unknown): Readonly<ProtobufBehaviorBindings>;
export declare function verifyProtobufBehaviorBindings(input: {
  projection: unknown;
  bindings: unknown;
  behaviorContract?: unknown;
  requireAllMethods?: boolean;
}): ProtobufBehaviorBindingsResult;
export declare function createProtobufBehaviorBindingsReceipt(input: {
  projection: unknown;
  bindings: unknown;
  behaviorContract?: unknown;
  requireAllMethods?: boolean;
}): ProtobufBehaviorBindingsReceipt;
