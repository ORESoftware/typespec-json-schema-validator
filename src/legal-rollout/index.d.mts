import type { ValidatorReport, ValidatorStatus } from '../index.mjs';

export declare const LEGAL_ROLLOUT_MANIFEST_SCHEMA: 'ores.legal-rollout.manifest/v1';
export declare const LEGAL_ROLLOUT_RECEIPT_SCHEMA: 'ores.legal-rollout.receipt/v1';
export declare const LEGAL_ROLLOUT_DECLARATION: 'LegalRolloutManifest';
export declare const LEGAL_DRAFT_BANNER: string;
export declare const LEGAL_APPROVED_BANNER: string;

export interface LegalRolloutDocument {
  id: string;
  path: string;
  classification: 'internal' | 'external';
  agreementType: string;
  sha256: string;
  status: 'draft' | 'approved' | 'expired' | 'superseded';
  required: boolean;
  effectiveDate?: string;
  approvalRecord?: string;
}

export interface LegalRolloutManifest {
  schema: 'ores.legal-rollout.manifest/v1';
  repository: string;
  legalRoot: string;
  releaseApproved: boolean;
  documents: LegalRolloutDocument[];
}

export interface LegalRolloutFinding {
  ruleId: string;
  severity: 'error';
  resolutionState: 'unexplained';
  comparison: 'legal-rollout-admission';
  path: string | null;
  message: string;
  details?: unknown;
  fingerprint: string;
}

export interface LegalRolloutReceipt {
  schema: 'ores.legal-rollout.receipt/v1';
  runId: string;
  status: ValidatorStatus;
  zeroUnexplainedFindings: boolean;
  findings: LegalRolloutFinding[];
  role: 'legal-rollout-admission-evidence';
  editableAuthority: false;
  configuration: {
    declaration: string;
    legalRoot: string;
    release: boolean;
    minExternal: number;
    minInternal: number;
  };
  admission: {
    contractIr: {
      status: string;
      admissible: boolean;
      suppliedIrId: string | null;
      computedIrId: string | null;
      expectedIrId: string | null;
      receiptRunId: string | null;
    };
    manifestLaneVerdicts: Record<string, boolean | null>;
  };
  inputs: unknown;
  coverage: {
    documents: number;
    external: number;
    internal: number;
    externalAgreementTypes: number;
    internalAgreementTypes: number;
    actualMarkdownDocuments: number;
    completeInventory: boolean;
  };
  error?: { name: string; message: string };
}

export interface LegalRolloutOptions {
  manifest: string;
  parityReport: string;
  contractIr: string;
  typespec: string;
  authoredSchema: string;
  generatedSchema?: string;
  declaration?: string;
  projectRoot?: string;
  legalRoot?: string;
  release?: boolean;
  minExternal?: number;
  minInternal?: number;
}

export declare function parseStrictJson(source: string, label?: string): unknown;
export declare function validateLegalManifestLanes(
  contractIr: unknown,
  manifest: unknown,
  declarationName?: string,
): {
  verdicts: Record<string, boolean | null>;
  findings: LegalRolloutFinding[];
};
export declare function auditLegalRollout(options: {
  manifest: unknown;
  projectRoot?: string;
  legalRoot?: string;
  release?: boolean;
  minExternal?: number;
  minInternal?: number;
}): Promise<{
  findings: LegalRolloutFinding[];
  evidence: unknown[];
  coverage: LegalRolloutReceipt['coverage'];
}>;
export declare function runLegalRollout(options: LegalRolloutOptions): Promise<LegalRolloutReceipt>;
export declare function writeLegalRolloutReceipt(
  path: string,
  receipt: LegalRolloutReceipt,
): Promise<{ path: string; action: string }>;
export declare function renderLegalRolloutSummary(receipt: LegalRolloutReceipt): string;

export type _ValidatorReportCompatibility = ValidatorReport;
