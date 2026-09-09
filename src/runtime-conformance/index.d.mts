export type RuntimeAdapterStatus = 'passed' | 'failed' | 'skipped' | 'unsupported';
export type RuntimeCaseVerdict = 'accepted' | 'rejected' | 'error' | 'skipped' | 'unsupported';
export type RuntimeCaseExpectation = 'accepted' | 'rejected';
export type RuntimeEvidenceSchema =
  | typeof RUNTIME_EVIDENCE_SCHEMA_V1
  | typeof RUNTIME_EVIDENCE_SCHEMA_V2;

export interface RuntimeValidationError {
  path: string;
  code: string;
  params: Record<string, null | boolean | number | string>;
}

export interface RuntimeEvidenceResultV1 {
  caseId: string;
  declaration: string;
  verdict: RuntimeCaseVerdict;
}

export interface RuntimeEvidenceResultV2 extends RuntimeEvidenceResultV1 {
  inputDigest: string;
  outputDigest: string | null;
  errors: RuntimeValidationError[];
}

export type RuntimeEvidenceResult = RuntimeEvidenceResultV1 | RuntimeEvidenceResultV2;

export interface RuntimeAdapterEvidence {
  id: string;
  language: string;
  runtime: string;
  validator: string;
  toolchain: string;
  status: RuntimeAdapterStatus;
  results: RuntimeEvidenceResult[];
}

export interface RuntimeEvidence {
  schema: RuntimeEvidenceSchema;
  contractIrId: string;
  inputDigest: string;
  corpusDigest: string;
  adapters: RuntimeAdapterEvidence[];
}

export interface ExpectedRuntimeCase {
  id: string;
  declaration: string;
  expectation: RuntimeCaseExpectation;
}

export interface RequiredRuntimeAdapter {
  id: string;
  language?: string;
  validator?: string;
}

export interface ContractIrVerificationEvidence {
  schema: 'ores.typespec-json-schema-validator.contract-ir-verification/v1';
  status: 'passed' | 'failed';
  admissible: boolean;
  suppliedIrId: string | null;
  computedIrId: string | null;
  expectedIrId: string | null;
  receiptRunId: string | null;
  error: string | null;
}

export interface RuntimeEvidenceContractBinding {
  contractIrId: string;
  inputDigest: string;
}

export interface RuntimeFinding {
  ruleId: string;
  severity: 'error';
  resolutionState: 'unexplained';
  comparison: 'runtime-conformance';
  declaration?: string;
  pointer?: string;
  message: string;
  left?: unknown;
  right?: unknown;
  fingerprint: string;
}

export interface RuntimeEvidenceValidation {
  normalized: Readonly<RuntimeEvidence> | null;
  findings: RuntimeFinding[];
}

export interface RuntimeConformanceReport {
  schema: typeof RUNTIME_CONFORMANCE_REPORT_SCHEMA;
  status: 'passed' | 'stopped_for_evaluation';
  zeroUnexplainedFindings: boolean;
  findings: readonly RuntimeFinding[];
  findingCount: number;
  truncated: boolean;
  contractIrId: string | null;
  contractIrVerified: boolean;
  receiptRunId: string | null;
  receiptDigest: string | null;
  evidenceSchema: RuntimeEvidenceSchema | null;
  evidenceDigest: string | null;
  expectedCaseDigest: string;
  summary: Readonly<{
    expectedCases: number;
    requiredAdapters: number;
    observedAdapters: number;
    passedAdapters: number;
  }>;
}

export interface RuntimeEvidenceLimits {
  maxAdapters?: number;
  maxResultsPerAdapter?: number;
}

export interface CurrentContractIrInputs {
  contractIr: unknown;
  parityReport: { runId?: string; [key: string]: unknown } | null | undefined;
  /** Current TypeSpec entry path; defaults to the path retained in parityReport. */
  typespec?: string;
  /** Current TypeSpec-emitted JSON Schema B path; defaults to parityReport. */
  generatedSchema?: string;
  /** Current independently authored JSON Schema A path; defaults to parityReport. */
  authoredSchema?: string;
}

export interface CurrentInputRuntimeAdmissionOptions
  extends RuntimeEvidenceLimits, CurrentContractIrInputs {
  evidence: unknown;
  expectedCorpusDigest: string;
  expectedCases: ExpectedRuntimeCase[];
  requiredAdapters?: Array<string | RequiredRuntimeAdapter>;
  /** Require an exact runtime-evidence schema; omit for v1/v2 compatibility admission. */
  requiredEvidenceSchema?: RuntimeEvidenceSchema;
  maxFindings?: number;
}

export const RUNTIME_EVIDENCE_SCHEMA: 'ores.typespec-json-schema-validator.runtime-evidence/v1';
export const RUNTIME_EVIDENCE_SCHEMA_V1: 'ores.typespec-json-schema-validator.runtime-evidence/v1';
export const RUNTIME_EVIDENCE_SCHEMA_V2: 'ores.typespec-json-schema-validator.runtime-evidence/v2';
export const RUNTIME_CONFORMANCE_REPORT_SCHEMA: 'ores.typespec-json-schema-validator.runtime-conformance-report/v1';

export function validateRuntimeEvidence(
  value: unknown,
  options?: RuntimeEvidenceLimits,
): RuntimeEvidenceValidation;

/**
 * Low-level helper for a caller that already holds a fresh Contract IR
 * verification result over the exact current source lanes.
 */
export function createRuntimeEvidenceContractBinding(input: {
  contractIr: unknown;
  contractIrVerification: ContractIrVerificationEvidence;
}): Readonly<RuntimeEvidenceContractBinding>;

/**
 * Preferred binding API. Recomputes Contract IR verification from the current
 * checked-out source lanes before returning immutable adapter receipt fields.
 */
export function createRuntimeEvidenceBindingAgainstCurrentInputs(
  input: CurrentContractIrInputs,
): Promise<Readonly<RuntimeEvidenceContractBinding>>;

export function compareRuntimeEvidence(input: RuntimeEvidenceLimits & {
  evidence: unknown;
  contractIr: unknown;
  contractIrVerification: ContractIrVerificationEvidence;
  expectedInputDigest: string;
  expectedCorpusDigest: string;
  expectedCases: ExpectedRuntimeCase[];
  requiredAdapters?: Array<string | RequiredRuntimeAdapter>;
  requiredEvidenceSchema?: RuntimeEvidenceSchema;
  maxFindings?: number;
}): RuntimeConformanceReport;

/**
 * Preferred admission API. Recomputes Contract IR verification from the
 * current checked-out source lanes immediately before comparing receipts.
 */
export function verifyRuntimeEvidenceAgainstCurrentInputs(
  input: CurrentInputRuntimeAdmissionOptions,
): Promise<RuntimeConformanceReport>;

export function loadRuntimeEvidence(
  path: string,
  options?: { maxBytes?: number },
): Promise<unknown>;
