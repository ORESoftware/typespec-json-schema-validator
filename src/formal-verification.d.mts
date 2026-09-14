import type { BehaviorContract } from './behavior-contract.mjs';

export interface FormalOperationTarget {
  operationId: string;
  language: 'dafny';
  source: string;
  module: string;
  symbol: string;
  sourceSha256: `sha256:${string}`;
  verifyIncludedFiles: boolean;
}

export interface FormalManifest {
  schema: 'ores.typespec-json-schema-validator.formal-manifest/v1';
  authority: 'independently-authored-formal-authority';
  behaviorContractDigest: `sha256:${string}`;
  operations: readonly FormalOperationTarget[];
}

export interface FormalFinding {
  ruleId: string;
  severity: 'error';
  resolutionState: 'unexplained';
  comparison: 'formal-verification';
  pointer: string;
  message: string;
  fingerprint: string;
  [key: string]: unknown;
}

export interface FormalProofRun {
  source: string;
  operationIds: readonly string[];
  exitCode: number | null;
  signal: string | null;
  stdoutSha256: `sha256:${string}`;
  stderrSha256: `sha256:${string}`;
}

export interface FormalVerificationReceipt {
  schema: 'ores.typespec-json-schema-validator.formal-verification-receipt/v1';
  status: 'passed' | 'stopped_for_evaluation';
  authority: 'independently-authored-formal-authority';
  behaviorContractDigest: `sha256:${string}`;
  formalManifestDigest: `sha256:${string}`;
  bindings: readonly { operationId: string; qualifiedName: string }[];
  dafny: {
    executable: string;
    available: boolean;
    versionProbe: {
      exitCode: number | null;
      signal: string | null;
      stdoutSha256: `sha256:${string}`;
      stderrSha256: `sha256:${string}`;
    };
  };
  proofRuns: readonly FormalProofRun[];
  findings: readonly FormalFinding[];
  verificationId: `sha256:${string}`;
}

export declare const FORMAL_MANIFEST_SCHEMA: 'ores.typespec-json-schema-validator.formal-manifest/v1';
export declare const FORMAL_AUTHORITY: 'independently-authored-formal-authority';
export declare const FORMAL_VERIFICATION_RECEIPT_SCHEMA: 'ores.typespec-json-schema-validator.formal-verification-receipt/v1';

export declare class FormalVerificationError extends Error {}

export declare function normalizeFormalManifest(value: unknown): Readonly<FormalManifest>;
export declare function formalManifestDigest(value: unknown): `sha256:${string}`;
export declare function behaviorDigestForFormalVerification(value: unknown): `sha256:${string}`;
export declare function inspectTypeSpecBehaviorBindings(
  typespec: string,
  behaviorContract: BehaviorContract,
): Promise<{
  program: unknown;
  bindings: readonly { operationId: string; qualifiedName: string }[];
  findings: readonly FormalFinding[];
}>;
export declare function verifyFormalContract(input: {
  root?: string;
  typespec: string;
  behaviorContract: BehaviorContract;
  manifest: FormalManifest;
  dafnyBin?: string;
}): Promise<FormalVerificationReceipt>;
