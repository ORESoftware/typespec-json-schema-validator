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

export interface RuntimeEvidence {
  schema: typeof RUNTIME_EVIDENCE_SCHEMA;
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
  schema: typeof RUNTIME_EVIDENCE_SCHEMA;
  status: 'passed' | 'stopped_for_evaluation';
  zeroUnexplainedFindings: boolean;
  findings: readonly RuntimeFinding[];
  findingCount: number;
  truncated: boolean;
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

export const RUNTIME_EVIDENCE_SCHEMA: 'ores.typespec-json-schema-validator.runtime-evidence/v1';

export function validateRuntimeEvidence(
  value: unknown,
  options?: RuntimeEvidenceLimits,
): RuntimeEvidenceValidation;

export function compareRuntimeEvidence(input: RuntimeEvidenceLimits & {
  evidence: unknown;
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
