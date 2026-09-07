import { verifyContractIr } from '../contract-ir.mjs';
import { compareRuntimeEvidence } from './decision.mjs';

/**
 * Preferred runtime-evidence admission API.
 *
 * Recompute Contract IR verification from the current checked-out TypeSpec,
 * generated JSON Schema B, and independently authored JSON Schema A inputs
 * immediately before comparing adapter receipts. Callers therefore cannot
 * accidentally reuse a stale verification object from an earlier checkout.
 *
 * The low-level compareRuntimeEvidence() function remains available for
 * orchestrators that have already performed and retained the exact current-
 * input verification step themselves.
 */
export async function verifyRuntimeEvidenceAgainstCurrentInputs({
  evidence,
  contractIr,
  parityReport,
  typespec,
  generatedSchema,
  authoredSchema,
  expectedCorpusDigest,
  expectedCases,
  requiredAdapters = [],
  maxFindings = 250,
  maxAdapters = 64,
  maxResultsPerAdapter = 100_000,
}) {
  const contractIrVerification = await verifyContractIr({
    contractIr,
    report: parityReport,
    typespec,
    generatedSchema,
    authoredSchema,
  });

  return compareRuntimeEvidence({
    evidence,
    contractIr,
    contractIrVerification,
    expectedInputDigest: parityReport?.runId,
    expectedCorpusDigest,
    expectedCases,
    requiredAdapters,
    maxFindings,
    maxAdapters,
    maxResultsPerAdapter,
  });
}
