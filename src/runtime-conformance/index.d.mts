export type RuntimeAdapterStatus = 'passed' | 'failed' | 'skipped' | 'unsupported';
export type RuntimeCaseVerdict = 'accepted' | 'rejected' | 'error' | 'skipped' | 'unsupported';
export type RuntimeCaseExpectation = 'accepted' | 'rejected';

export interface RuntimeEvidenceResult {
  caseId: string;
  declaration: string;
  verdict: RuntimeCaseVerdict;
}

export interface RuntimeAdapterEvidence {
  id: string;
  language: string;
  runtime: string;
  validator: string;
  toolchain: string;
  status: RuntimeAdapterStatus;
  results: RuntimeEvidenceResult[];
}

export interface RuntimeEvidenceContractBinding {
  schema: typeof CONTRACT_IR_SCHEMA;
  irId: string;
  parityReceipt: Readonly<{
    runId: string;
    digest: string;
  }>;
}

export interface RuntimeEvidence {
  schema: typeof RUNTIME_EVIDENCE_SCHEMA;
  contractIr: RuntimeEvidenceContractBinding;
  inputDigest: string;
  corpusDigest: string;
  adapters: RuntimeAdapterEvidence[];
}

export interface RuntimeContractIrArtifact {
  schema: typeof CONTRACT_IR_SCHEMA;
  irId: string;
  status: 'passed' | 'stopped_for_evaluation' | 'failed';
  admissible: boolean;
  admission?: {
    receipt?: {
      schema?: string;
      runId?: string;
      digest?: string;
      status?: string;
      zeroUnexplainedFindings?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RuntimeContractIrVerification {
  schema: typeof CONTRACT_IR_VERIFICATION_SCHEMA;
  status: 'passed' | 'failed';
  admissible: boolean;
  suppliedIrId: string | null;
  computedIrId: string | null;
  expectedIrId: string | null;
  receiptRunId: string | null;
  error: string | null;
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
  evidenceDigest: string | null;
  expectedCaseDigest: string;
  contractIrId: string | null;
  parityReceiptRunId: string | null;
  parityReceiptDigest: string | null;
  summary: Readonly<{
    expectedCases: number;
    requiredAdapters: number;
    observedAdapters: number;
    passedAdapters: number;
    contractBindingVerified: boolean;
  }>;
}

export interface RuntimeEvidenceLimits {
  maxAdapters?: number;
  maxResultsPerAdapter?: number;
}

export const RUNTIME_EVIDENCE_SCHEMA: 'ores.typespec-json-schema-validator.runtime-evidence/v1';
export const RUNTIME_CONFORMANCE_REPORT_SCHEMA:
  'ores.typespec-json-schema-validator.runtime-conformance-report/v1';
export const CONTRACT_IR_SCHEMA: 'ores.typespec-json-schema-validator.contract-ir/v1';
export const CONTRACT_IR_VERIFICATION_SCHEMA:
  'ores.typespec-json-schema-validator.contract-ir-verification/v1';

export function createRuntimeEvidenceContractBinding(input: {
  contractIr: RuntimeContractIrArtifact;
  contractIrVerification: RuntimeContractIrVerification;
}): Readonly<RuntimeEvidenceContractBinding>;

export function validateRuntimeEvidence(
  value: unknown,
  options?: RuntimeEvidenceLimits,
): RuntimeEvidenceValidation;

export function compareRuntimeEvidence(input: RuntimeEvidenceLimits & {
  evidence: unknown;
  contractIr: RuntimeContractIrArtifact;
  contractIrVerification: RuntimeContractIrVerification;
  expectedInputDigest: string;
  expectedCorpusDigest: string;
  expectedCases: ExpectedRuntimeCase[];
  requiredAdapters?: Array<string | RequiredRuntimeAdapter>;
  maxFindings?: number;
}): RuntimeConformanceReport;

export function loadRuntimeEvidence(
  path: string,
  options?: { maxBytes?: number },
): Promise<unknown>;
