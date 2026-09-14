import type { BehaviorContract } from './behavior-contract.mjs';
import type { FormalVerificationReceipt } from './formal-verification.mjs';

export type ImplementationProof =
  | {
      tool: 'kani';
      source: string;
      sourceSha256: `sha256:${string}`;
      manifestPath: string;
      harness: string;
      package: string | null;
    }
  | {
      tool: 'verus';
      source: string;
      sourceSha256: `sha256:${string}`;
    };

export interface ImplementationOperationTarget {
  operationId: string;
  language: 'rust';
  implementation: {
    source: string;
    sourceSha256: `sha256:${string}`;
    symbol: string;
  };
  proofs: readonly ImplementationProof[];
}

export interface ImplementationProofManifest {
  schema: 'ores.typespec-json-schema-validator.implementation-proof-manifest/v1';
  authority: 'consumer-authored-implementation-proof-plan';
  behaviorContractDigest: `sha256:${string}`;
  formalVerificationId: `sha256:${string}`;
  repository: string;
  revision: string;
  operations: readonly ImplementationOperationTarget[];
}

export interface ImplementationFinding {
  ruleId: string;
  severity: 'error';
  resolutionState: 'unexplained';
  comparison: 'implementation-verification';
  pointer: string;
  message: string;
  fingerprint: string;
  [key: string]: unknown;
}

export interface ImplementationProofRun {
  operationId: string;
  tool: 'kani' | 'verus';
  proofMode: 'model-checking' | 'deductive';
  target: string;
  exitCode: number | null;
  signal: string | null;
  stdoutSha256: `sha256:${string}`;
  stderrSha256: `sha256:${string}`;
}

export interface ImplementationVerificationReceipt {
  schema: 'ores.typespec-json-schema-validator.implementation-verification-receipt/v1';
  status: 'passed' | 'stopped_for_evaluation';
  assuranceLevel: 'L4' | null;
  authority: 'consumer-authored-implementation-proof-plan';
  behaviorContractDigest: `sha256:${string}`;
  formalVerificationId: `sha256:${string}`;
  implementationManifestDigest: `sha256:${string}`;
  repository: string;
  revision: string;
  git: {
    head: string | null;
    clean: boolean;
    headProbe: CommandEvidence;
    statusProbe: CommandEvidence;
  };
  tools: {
    kani?: ToolEvidence;
    verus?: ToolEvidence;
  };
  proofRuns: readonly ImplementationProofRun[];
  findings: readonly ImplementationFinding[];
  verificationId: `sha256:${string}`;
}

export interface CommandEvidence {
  exitCode: number | null;
  signal: string | null;
  stdoutSha256: `sha256:${string}`;
  stderrSha256: `sha256:${string}`;
}

export interface ToolEvidence {
  executable: string;
  available: boolean;
  versionProbe: CommandEvidence;
}

export declare const IMPLEMENTATION_PROOF_MANIFEST_SCHEMA:
  'ores.typespec-json-schema-validator.implementation-proof-manifest/v1';
export declare const IMPLEMENTATION_PROOF_AUTHORITY: 'consumer-authored-implementation-proof-plan';
export declare const IMPLEMENTATION_VERIFICATION_RECEIPT_SCHEMA:
  'ores.typespec-json-schema-validator.implementation-verification-receipt/v1';

export declare class ImplementationVerificationError extends Error {}

export declare function normalizeImplementationProofManifest(value: unknown): Readonly<ImplementationProofManifest>;
export declare function implementationProofManifestDigest(value: unknown): `sha256:${string}`;
export declare function behaviorDigestForImplementationVerification(value: unknown): `sha256:${string}`;
export declare function verifyImplementationProofs(input: {
  root?: string;
  behaviorContract: BehaviorContract;
  formalReceipt: FormalVerificationReceipt;
  manifest: ImplementationProofManifest;
  cargoBin?: string;
  verusBin?: string;
  gitBin?: string;
  timeoutMs?: number;
  spawn?: typeof import('node:child_process').spawnSync;
}): Promise<ImplementationVerificationReceipt>;
