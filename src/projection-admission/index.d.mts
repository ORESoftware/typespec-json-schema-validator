export type ProjectionAdmissionStatus = 'passed' | 'stopped_for_evaluation';

export interface ProjectionFileDescriptor {
  path: string;
  sha256: string;
  size: number;
}

export interface ProjectionOutputDescriptor extends ProjectionFileDescriptor {
  mediaType: string;
  projection: string;
}

export interface ProjectionToolchain {
  id: string;
  version: string;
  artifactDigest: string;
}

export interface ProjectionInputSet {
  operationInventory: ProjectionFileDescriptor;
  projectionMetadata: ProjectionFileDescriptor;
  emitterConfiguration: ProjectionFileDescriptor;
}

export interface ProjectionTarget {
  id: string;
  emitter: string;
  declarationIds: string[];
  outputPaths: string[];
  representationDeltaIds: string[];
  runtimeValidatorIds: string[];
}

export interface ProjectionDeltaApproval {
  reviewer: string;
  reviewedAt: string;
  approvalDigest: string;
}

export interface ProjectionRepresentationDelta {
  id: string;
  projection: string;
  declaration: string;
  sourcePointer: string;
  reason: string;
  sourceDigest: string;
  review: ProjectionDeltaApproval;
  runtimeValidatorRequired: boolean;
  runtimeValidatorId: string | null;
  negativeFixtureDigest: string | null;
}

export interface ProjectionRuntimeValidator {
  id: string;
  projection: string;
  artifactPath: string;
  artifactDigest: string;
  fixtureDigest: string;
  ingressEgressCoverageDigest: string;
}

export interface ProjectionContractBinding {
  contractIrId: string;
  contractIrDigest: string;
  receiptRunId: string;
  receiptDigest: string;
  sourceDigests: {
    typespec: string;
    generatedJsonSchema: string;
    authoredJsonSchema: string;
  };
}

export interface ProjectionManifest {
  schema: 'ores.typespec-json-schema-validator.projection-manifest/v1';
  manifestId: string;
  status: 'passed';
  contract: ProjectionContractBinding;
  inputs: ProjectionInputSet;
  toolchains: ProjectionToolchain[];
  declarations: string[];
  projections: ProjectionTarget[];
  outputs: ProjectionOutputDescriptor[];
  representationDeltas: ProjectionRepresentationDelta[];
  runtimeValidators: ProjectionRuntimeValidator[];
}

export interface TrustedProjectionDelta {
  id: string;
  projection: string;
  declaration: string;
  sourceDigest: string;
  approvalDigest: string;
  negativeFixtureDigest: string | null;
}

export interface ProjectionFinding {
  ruleId: string;
  severity: 'error';
  resolutionState: 'unexplained';
  comparison: 'downstream-projection-admission';
  pointer: string;
  message: string;
  projection?: string;
  path?: string;
  fingerprint: string;
}

export interface ProjectionAdmissionReport {
  schema: 'ores.typespec-json-schema-validator.projection-admission-report/v1';
  status: ProjectionAdmissionStatus;
  admissible: boolean;
  manifestId: string | null;
  contractIrId: string | null;
  receiptRunId: string | null;
  evidenceDigest: string;
  summary: {
    declarations: number;
    projections: number;
    outputs: number;
    representationDeltas: number;
    runtimeValidators: number;
  };
  findings: ProjectionFinding[];
}

export interface ProjectionVerificationOptions {
  manifest: unknown;
  contractIr: Record<string, unknown>;
  parityReceipt: Record<string, unknown>;
  expectedSourceDigests: ProjectionContractBinding['sourceDigests'];
  expectedInputs: ProjectionInputSet;
  requiredToolchains: ProjectionToolchain[];
  actualOutputs: ProjectionOutputDescriptor[];
  requiredProjections: string[];
  approvedDeltas?: TrustedProjectionDelta[];
  expectedRuntimeValidators?: ProjectionRuntimeValidator[];
  limits?: Record<string, number>;
}

export interface ProjectionManifestCreationOptions {
  contractIr: Record<string, unknown>;
  parityReceipt: Record<string, unknown>;
  expectedSourceDigests: ProjectionContractBinding['sourceDigests'];
  inputs: ProjectionInputSet;
  toolchains: ProjectionToolchain[];
  projections: ProjectionTarget[];
  outputs: ProjectionOutputDescriptor[];
  representationDeltas?: ProjectionRepresentationDelta[];
  runtimeValidators?: ProjectionRuntimeValidator[];
  limits?: Record<string, number>;
}

export const PROJECTION_MANIFEST_SCHEMA: 'ores.typespec-json-schema-validator.projection-manifest/v1';
export const PROJECTION_ADMISSION_REPORT_SCHEMA: 'ores.typespec-json-schema-validator.projection-admission-report/v1';
export function createProjectionManifest(options: ProjectionManifestCreationOptions): ProjectionManifest;
export function verifyProjectionManifest(options: ProjectionVerificationOptions): ProjectionAdmissionReport;
export function normalizeProjectionManifest(value: unknown, options?: { limits?: Record<string, number> }): {
  manifest: ProjectionManifest | null;
  findings: ProjectionFinding[];
  limits: Readonly<Record<string, number>>;
};
export function verifyProjectionContract(options: {
  contractIr: Record<string, unknown>;
  parityReceipt: Record<string, unknown>;
  expectedSourceDigests: ProjectionContractBinding['sourceDigests'];
}): {
  binding: ProjectionContractBinding | null;
  declarationIds: string[];
  findings: ProjectionFinding[];
};
export function loadProjectionManifest(path: string, options?: { maxBytes?: number }): Promise<unknown>;
export function hashProjectionFiles<T extends { path: string }>(
  rootPath: string,
  descriptors: T[],
  options?: { maxFiles?: number; maxBytes?: number; maxTotalFileBytes?: number },
): Promise<ReadonlyArray<T & ProjectionFileDescriptor>>;
export function projectionManifestDigest(manifest: ProjectionManifest): string | null;

/** Caller-owned inventory/policy; observed hashes cannot be supplied here. */
export interface ProjectionCurrentFilesOptions extends Omit<
  ProjectionVerificationOptions, 'expectedSourceDigests' | 'expectedInputs' | 'actualOutputs'
> {
  root: string;
  /** Normalized relative POSIX paths under root; receipt-controlled defaults are forbidden. */
  typespec: string;
  generatedSchema: string;
  authoredSchema: string;
  expectedDeclarations: string[];
  inputPaths: Record<keyof ProjectionInputSet, string>;
  outputFiles: Array<Pick<ProjectionOutputDescriptor, 'path' | 'mediaType' | 'projection'>>;
  /** File count and aggregate budgets cover all three projection inputs plus outputs. */
  fileLimits?: { maxFiles?: number; maxBytes?: number; maxTotalFileBytes?: number };
}
export function verifyProjectionManifestWithCurrentFiles(options: ProjectionCurrentFilesOptions): Promise<ProjectionAdmissionReport>;
