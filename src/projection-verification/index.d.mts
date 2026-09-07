import type {
  ContractIrArtifact,
  ContractIrVerification,
  ValidatorReport,
} from '../index.d.ts';
import type {
  ProjectionAdmissionReport,
  ProjectionManifest,
  ProjectionOutputDescriptor,
  ProjectionRuntimeValidator,
  ProjectionToolchain,
  TrustedProjectionDelta,
} from '../projection-admission/index.d.mts';

export interface ProjectionVerificationPolicy {
  schema: 'ores.typespec-json-schema-validator.projection-verification-policy/v1';
  expectedDeclarations: string[];
  inputs: {
    operationInventory: { path: string };
    projectionMetadata: { path: string };
    emitterConfiguration: { path: string };
  };
  toolchains: ProjectionToolchain[];
  requiredProjections: string[];
  outputs: Array<Pick<ProjectionOutputDescriptor, 'path' | 'mediaType' | 'projection'>>;
  approvedDeltas: TrustedProjectionDelta[];
  runtimeValidators: ProjectionRuntimeValidator[];
}

export interface ProjectionVerificationReceipt {
  schema: 'ores.typespec-json-schema-validator.projection-verification-receipt/v1';
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
  findingRuleIds: string[];
  failureCode:
    | 'projection-verification-stopped'
    | 'projection-verification-failed'
    | null;
}

export interface ProjectionWorkspaceVerification {
  contractIrVerification: ContractIrVerification & { declarationIds?: string[] };
  report: ProjectionAdmissionReport;
  receipt: ProjectionVerificationReceipt;
}

export const PROJECTION_VERIFICATION_POLICY_SCHEMA:
  'ores.typespec-json-schema-validator.projection-verification-policy/v1';
export const PROJECTION_VERIFICATION_RECEIPT_SCHEMA:
  'ores.typespec-json-schema-validator.projection-verification-receipt/v1';

export class ProjectionVerificationPolicyError extends Error {}
export class UnsafeProjectionVerificationReceiptDestinationError extends Error {}

export function normalizeProjectionVerificationPolicy(
  value: unknown,
): ProjectionVerificationPolicy;
export function loadProjectionVerificationPolicy(
  path: string,
  options?: { maxBytes?: number },
): Promise<ProjectionVerificationPolicy>;
export function sourceDigestsFromContractIr(
  contractIr: ContractIrArtifact,
): ProjectionVerificationReceipt['sourceDigests'];
export function createProjectionVerificationReceipt(input: {
  report: ProjectionAdmissionReport;
  contractIrVerification: ContractIrVerification;
  contractIr: ContractIrArtifact;
}): ProjectionVerificationReceipt;
export function failedProjectionVerificationReceipt(input?: {
  manifest?: ProjectionManifest | null;
  contractIr?: ContractIrArtifact | null;
  parityReceipt?: ValidatorReport | null;
}): ProjectionVerificationReceipt;
export function writeProjectionVerificationReceipt(
  path: string,
  receipt: ProjectionVerificationReceipt,
): Promise<string>;
export function verifyProjectionWorkspace(input: {
  root: string;
  manifest: ProjectionManifest;
  contractIr: ContractIrArtifact;
  parityReceipt: ValidatorReport;
  typespec: string;
  generatedSchema: string;
  authoredSchema: string;
  policy: ProjectionVerificationPolicy;
}): Promise<ProjectionWorkspaceVerification>;
