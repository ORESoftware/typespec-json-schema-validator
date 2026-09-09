export const LANGUAGE_BOUNDARY_MANIFEST_SCHEMA: 'ores.typespec-json-schema-validator.language-boundaries/v1';
export const LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1';
export const LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA: 'ores.typespec-json-schema-validator.language-boundary-verification/v1';

export interface LanguageBoundaryTarget {
  language: string;
  runtime: string;
  required: boolean;
  ingress: boolean;
  egress: boolean;
  evidence: string;
}

export interface LanguageBoundaryManifest {
  schema: typeof LANGUAGE_BOUNDARY_MANIFEST_SCHEMA;
  minimumDistinctLanguages: number;
  authorities: {
    typeSpec: 'peer';
    jsonSchema: 'peer';
    generatedWitness: 'evidence_only';
  };
  targets: LanguageBoundaryTarget[];
}

export interface LanguageBoundaryEvidence {
  schema: typeof LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA;
  language: string;
  runtime: string;
  status: 'passed' | 'failed' | 'stopped_for_evaluation';
  sourceRevision: string;
  artifactDigest: `sha256:${string}`;
  receiptRunId: string;
  contractIrId: string;
  toolchain: { name: string; version: string };
  generator: { name: string; version: string };
  validation: { ingress: 'passed' | 'failed'; egress: 'passed' | 'failed' };
}

export interface LanguageBoundaryFinding {
  ruleId: string;
  severity: 'error';
  resolutionState: 'unexplained';
  comparison: 'language-runtime-boundary';
  pointer: string;
  message: string;
  fingerprint: string;
}

export interface LanguageBoundaryVerification {
  schema: typeof LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA;
  status: 'passed' | 'stopped_for_evaluation';
  zeroUnexplainedFindings: boolean;
  binding: {
    parityReceiptRunId: string | null;
    contractIrId: string | null;
    typeSpecAuthority: 'peer';
    jsonSchemaAuthority: 'peer';
    generatedWitnessRole: 'evidence_only';
  };
  counts: {
    targets: number;
    requiredTargets: number;
    distinctRequiredLanguages: number;
    admittedEvidence: number;
    findings: number;
  };
  findings: readonly LanguageBoundaryFinding[];
  verificationId: `sha256:${string}`;
}

export function verifyLanguageBoundaries(input?: {
  manifest?: LanguageBoundaryManifest;
  report?: Record<string, unknown>;
  contractIr?: Record<string, unknown>;
  evidenceByPath?: Map<string, LanguageBoundaryEvidence> | Record<string, LanguageBoundaryEvidence>;
}): LanguageBoundaryVerification;
