import type { EmbeddedBehavior } from './behavior-contract.mjs';

export type OpenApiHttpMethod = 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT' | 'TRACE';
export type OpenApiParameterLocation = 'cookie' | 'header' | 'path' | 'query';
export type OpenApiCompatibilitySeverity = 'breaking' | 'review_required';

export interface OpenApiParameterProjection {
  name: string;
  in: OpenApiParameterLocation;
  required: boolean;
  schemaRef: string;
}

export interface OpenApiRequestBodyProjection {
  required: boolean;
  schemaRef: string;
}

export interface OpenApiResponseProjection {
  status: string;
  schemaRef: string | null;
}

export interface OpenApiOperationProjection {
  operationId: string;
  method: OpenApiHttpMethod;
  path: string;
  parameters: readonly OpenApiParameterProjection[];
  requestBody: Readonly<OpenApiRequestBodyProjection> | null;
  responses: readonly OpenApiResponseProjection[];
  behavior: Readonly<EmbeddedBehavior> | null;
}

export interface OpenApiProjection {
  schema: 'ores.typespec-json-schema-validator.openapi-projection/v1';
  openapi: '3.1.0' | '3.1.1';
  operations: readonly OpenApiOperationProjection[];
}

export interface OpenApiCompatibilityFinding {
  ruleId: string;
  severity: OpenApiCompatibilitySeverity;
  subject: string;
  message: string;
  baseline: unknown;
  current: unknown;
  fingerprint: string;
}

export interface OpenApiCompatibilityResult {
  baseline: OpenApiProjection;
  current: OpenApiProjection;
  baselineDigest: string;
  currentDigest: string;
  status: 'passed' | 'stopped_for_evaluation';
  admissible: boolean;
  breakingChangeCount: number;
  reviewRequiredCount: number;
  findings: readonly OpenApiCompatibilityFinding[];
  truncated: boolean;
}

export interface OpenApiCompatibilityReceipt {
  schema: 'ores.typespec-json-schema-validator.openapi-compatibility-receipt/v1';
  status: 'passed' | 'stopped_for_evaluation';
  admissible: boolean;
  baselineDigest: string;
  currentDigest: string;
  breakingChangeCount: number;
  reviewRequiredCount: number;
  truncated: boolean;
  findings: readonly OpenApiCompatibilityFinding[];
  verificationId: string;
}

export declare const OPENAPI_PROJECTION_SCHEMA: 'ores.typespec-json-schema-validator.openapi-projection/v1';
export declare const OPENAPI_COMPATIBILITY_RECEIPT_SCHEMA: 'ores.typespec-json-schema-validator.openapi-compatibility-receipt/v1';
export declare class OpenApiProjectionError extends Error {}

export declare function normalizeOpenApiProjection(value: unknown): Readonly<OpenApiProjection>;
export declare function compareOpenApiCompatibility(
  baseline: unknown,
  current: unknown,
  options?: { maxFindings?: number },
): OpenApiCompatibilityResult;
export declare function createOpenApiCompatibilityReceipt(input: {
  baseline: unknown;
  current: unknown;
  maxFindings?: number;
}): OpenApiCompatibilityReceipt;
