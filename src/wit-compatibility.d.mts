export type WitCompatibilityMode = 'consumer' | 'strict';
export type WitCompatibilityStatus = 'passed' | 'stopped_for_evaluation' | 'failed';

export interface WitNamedTypeProjection {
  name: string;
  kind: 'alias' | 'record' | 'variant' | 'enum' | 'flags' | 'resource' | 'handle' | 'tuple' | 'option' | 'result' | 'list' | 'future' | 'stream';
  shape: string;
}
export interface WitParamProjection { name: string | null; type: string; }
export interface WitFunctionProjection { name: string; params: WitParamProjection[]; results: WitParamProjection[]; }
export interface WitInterfaceProjection { name: string; types: WitNamedTypeProjection[]; functions: WitFunctionProjection[]; }
export interface WitWorldBindingProjection { name: string; kind: 'interface' | 'function'; target: string; }
export interface WitWorldProjection { name: string; imports: WitWorldBindingProjection[]; exports: WitWorldBindingProjection[]; }
export interface WitProjection {
  schema: 'ores.typespec-json-schema-validator.wit-projection/v1';
  package: string;
  worlds: WitWorldProjection[];
  interfaces: WitInterfaceProjection[];
}
export interface WitCompatibilityFinding {
  ruleId: string;
  subject: string;
  message: string;
  baseline: unknown;
  current: unknown;
  fingerprint: string;
}
export interface WitCompatibilityResult {
  baseline: WitProjection;
  current: WitProjection;
  mode: WitCompatibilityMode;
  baselineDigest: string;
  currentDigest: string;
  status: 'passed' | 'stopped_for_evaluation';
  admissible: boolean;
  findings: readonly WitCompatibilityFinding[];
  truncated: boolean;
}
export interface WitCompatibilityReceipt {
  schema: 'ores.typespec-json-schema-validator.wit-compatibility-receipt/v1';
  status: WitCompatibilityStatus;
  admissible: boolean;
  mode: WitCompatibilityMode;
  baselineDigest: string | null;
  currentDigest: string | null;
  breakingChangeCount: number;
  truncated: boolean;
  breakingChanges: readonly WitCompatibilityFinding[];
  failureCode: 'wit-breaking-change-detected' | 'wit-compatibility-verification-failed' | null;
  verificationId: string;
}

export declare const WIT_PROJECTION_SCHEMA: 'ores.typespec-json-schema-validator.wit-projection/v1';
export declare const WIT_COMPATIBILITY_RECEIPT_SCHEMA: 'ores.typespec-json-schema-validator.wit-compatibility-receipt/v1';
export declare class WitProjectionError extends Error {}
export declare class UnsafeWitCompatibilityReceiptDestinationError extends Error {}
export declare function normalizeWitProjection(value: unknown): WitProjection;
export declare function compareWitCompatibility(
  baseline: unknown,
  current: unknown,
  options?: { maxFindings?: number; mode?: WitCompatibilityMode },
): WitCompatibilityResult;
export declare function createWitCompatibilityReceipt(input: {
  baseline: unknown;
  current: unknown;
  maxFindings?: number;
  mode?: WitCompatibilityMode;
}): WitCompatibilityReceipt;
export declare function failedWitCompatibilityReceipt(input?: {
  baseline?: unknown;
  current?: unknown;
  mode?: WitCompatibilityMode;
}): WitCompatibilityReceipt;
export declare function writeWitCompatibilityReceipt(
  path: string,
  receipt: WitCompatibilityReceipt,
): Promise<string>;
