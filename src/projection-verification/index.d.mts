export const PROJECTION_VERIFICATION_POLICY_SCHEMA: 'ores.typespec-json-schema-validator.projection-verification-policy/v1';
export const PROJECTION_VERIFICATION_RECEIPT_SCHEMA: 'ores.typespec-json-schema-validator.projection-verification-receipt/v1';

export interface ProjectionVerificationPathDescriptor {
  path: string;
}

export interface ProjectionVerificationOutputDescriptor extends ProjectionVerificationPathDescriptor {
  mediaType: string;
  projection: string;
}

export interface ProjectionVerificationToolchain {
  id: string;
  version: string;
  artifactDigest: string;
}

export interface ProjectionVerificationPolicy {
  schema: typeof PROJECTION_VERIFICATION_POLICY_SCHEMA;
  inputs: {
    operationInventory: ProjectionVerificationPathDescriptor;
    projectionMetadata: ProjectionVerificationPathDescriptor;
    emitterConfiguration: ProjectionVerificationPathDescriptor;
  };
  toolchains: readonly ProjectionVerificationToolchain[];
  requiredProjections: readonly string[];
  outputs: readonly ProjectionVerificationOutputDescriptor[];
  approvedDeltas: readonly Record<string, unknown>[];
  runtimeValidators: readonly Record<string, unknown>[];
}

export interface ProjectionVerificationReceipt {
  schema: typeof PROJECTION_VERIFICATION_RECEIPT_SCHEMA;
  verificationId: string;
  status: 'passed' | 'stopped_for_evaluation' | 'failed';
  admissible: boolean;
  manifestId: string | null;
  contractIrId: string | null;
  receiptRunId: string | null;
  evidenceDigest: string | null;
  sourceDigests: {
    typespec: string;
    generatedJsonSchema: string;
    authoredJsonSchema: string;
  } | null;
  summary: {
    declarations: number;
    projections: number;
    outputs: number;
    representationDeltas: number;
    runtimeValidators: number;
  };
  findingRuleIds: readonly string[];
  failureCode: null | 'projection-verification-stopped' | 'projection-verification-failed';
}

export declare class ProjectionVerificationPolicyError extends Error {}
export declare class UnsafeProjectionVerificationReceiptDestinationError extends Error {}

export function normalizeProjectionVerificationPolicy(value: unknown): ProjectionVerificationPolicy;
export function loadProjectionVerificationPolicy(
  path: string,
  options?: { maxBytes?: number },
): Promise<ProjectionVerificationPolicy>;
export function createProjectionVerificationReceipt(input: {
  report: Record<string, unknown>;
  contractIrVerification: Record<string, unknown>;
  contractIr: Record<string, unknown>;
}): ProjectionVerificationReceipt;
export function failedProjectionVerificationReceipt(input?: {
  manifest?: Record<string, unknown> | null;
  contractIr?: Record<string, unknown> | null;
  parityReceipt?: Record<string, unknown> | null;
}): ProjectionVerificationReceipt;
export function writeProjectionVerificationReceipt(
  path: string,
  receipt: ProjectionVerificationReceipt,
): Promise<string>;
export function verifyProjectionWorkspace(input: {
  manifest: Record<string, unknown>;
  contractIr: Record<string, unknown>;
  parityReceipt: Record<string, unknown>;
  typespec: string;
  generatedSchema: string;
  authoredSchema: string;
  policy: ProjectionVerificationPolicy | Record<string, unknown>;
  inputRoot?: string;
  outputRoot?: string;
}): Promise<{
  contractIrVerification: Record<string, unknown>;
  report: Record<string, unknown>;
  receipt: ProjectionVerificationReceipt;
}>;
