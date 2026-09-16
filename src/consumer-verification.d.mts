export interface ConsumerParityReport {
  runId?: string;
  [key: string]: unknown;
}

export interface ConsumerVerificationOptions {
  contractIr: unknown;
  report: ConsumerParityReport | null | undefined;
  typespec: string;
  generatedSchema: string;
  authoredSchema: string;
  expectedDeclarations: string[];
  /** Reviewed non-admitted declaration identities as `<authority>:<id>`. */
  expectedExcludedDeclarations?: string[];
  /** Reviewed non-schema declaration identities as `<authority>:<id>`. */
  expectedOutOfScopeDeclarations?: string[];
}

export interface ConsumerContractVerification {
  schema: 'ores.typespec-json-schema-validator.contract-ir-verification/v1';
  status: 'passed';
  admissible: true;
  suppliedIrId: string;
  computedIrId: string;
  expectedIrId: string;
  receiptRunId: string;
  declarationIds: readonly string[];
  excludedDeclarationIds: readonly string[];
  outOfScopeDeclarationIds: readonly string[];
  [key: string]: unknown;
}

/**
 * Verify an admissible Contract IR and parity receipt against the caller's exact
 * current TypeSpec, generated Schema B and independently authored Schema A,
 * while enforcing an explicit declaration inventory. Compiler helpers or
 * non-schema TypeSpec declarations are accepted only when the caller explicitly
 * reviews their exact `<authority>:<id>` identities.
 */
export function verifyConsumerContract(
  options: ConsumerVerificationOptions,
): Promise<Readonly<ConsumerContractVerification>>;
