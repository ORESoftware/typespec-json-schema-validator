import { verifyContractIr } from '../contract-ir.mjs';
import {
  compareRuntimeEvidence,
  createRuntimeEvidenceContractBinding,
} from './decision.mjs';

async function verifyCurrentContractIr({
  contractIr,
  parityReport,
  typespec,
  generatedSchema,
  authoredSchema,
}) {
  return verifyContractIr({
    contractIr,
    report: parityReport,
    typespec,
    generatedSchema,
    authoredSchema,
  });
}

/**
 * Preferred binding API for isolated adapter jobs.
 *
 * Recompute Contract IR verification from the current source lanes before
 * returning the two immutable values an adapter receipt must copy. This avoids
 * distributing the full IR/receipt and prevents stale verification reuse.
 */
export async function createRuntimeEvidenceBindingAgainstCurrentInputs({
  contractIr,
  parityReport,
  typespec,
  generatedSchema,
  authoredSchema,
}) {
  const contractIrVerification = await verifyCurrentContractIr({
    contractIr,
    parityReport,
    typespec,
    generatedSchema,
    authoredSchema,
  });
  return createRuntimeEvidenceContractBinding({
    contractIr,
    contractIrVerification,
  });
}

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
  requiredEvidenceSchema,
  maxFindings = 250,
  maxAdapters = 64,
  maxResultsPerAdapter = 100_000,
}) {
  const contractIrVerification = await verifyCurrentContractIr({
    contractIr,
    parityReport,
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
    requiredEvidenceSchema,
    maxFindings,
    maxAdapters,
    maxResultsPerAdapter,
  });
}
