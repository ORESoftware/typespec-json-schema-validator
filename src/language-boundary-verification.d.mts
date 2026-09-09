export declare const LANGUAGE_BOUNDARY_MANIFEST_SCHEMA:
  'ores.typespec-json-schema-validator.language-boundaries/v1';
export declare const LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA:
  'ores.typespec-json-schema-validator.language-boundary-evidence/v1';
export declare const LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA:
  'ores.typespec-json-schema-validator.language-boundary-verification/v1';

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
  targets: readonly LanguageBoundaryTarget[];
}

export interface LanguageBoundaryEvidence {
  schema: typeof LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA;
  language: string;
  runtime: string;
  status: 'passed' | 'failed' | 'skipped' | 'unsupported';
  sourceRevision: string;
  artifactDigest: string;
  contractIrId: string;
  receiptRunId: string;
  toolchain: { name: string; version: string };
  generator: { name: string; version: string };
  validation: { ingress: 'passed' | 'failed'; egress: 'passed' | 'failed' };
}

export interface LanguageBoundaryFinding {
  ruleId: string;
  targetIndex: number | null;
}

export interface LanguageBoundaryVerification {
  schema: typeof LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA;
  status: 'passed' | 'stopped_for_evaluation';
  admissible: boolean;
  binding: {
    receiptRunId: string | null;
    contractIrId: string | null;
  };
  counts: {
    targets: number;
    requiredTargets: number;
    distinctRequiredLanguages: number;
    suppliedEvidence: number;
    findings: number;
  };
  findings: readonly LanguageBoundaryFinding[];
  verificationId: string;
}

export function verifyLanguageBoundaries(options?: {
  manifest?: LanguageBoundaryManifest;
  report?: Record<string, unknown>;
  contractIr?: Record<string, unknown>;
  evidenceByPath?:
    | ReadonlyMap<string, LanguageBoundaryEvidence>
    | Readonly<Record<string, LanguageBoundaryEvidence>>;
}): LanguageBoundaryVerification;
