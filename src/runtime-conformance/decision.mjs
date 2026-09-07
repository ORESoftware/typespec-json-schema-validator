import { compareRuntimeEvidence as compareRuntimeEvidenceCore } from './compare.mjs';
import {
  DIGEST_PATTERN,
  RUNTIME_CONFORMANCE_REPORT_SCHEMA,
} from './constants.mjs';
import { validateContractIrBinding } from './contract-ir-binding.mjs';

function findingRuleIds(findings) {
  return [...new Set(findings.map((finding) => finding.ruleId).filter(Boolean))].sort();
}

/**
 * Derive only the immutable fields that an isolated runtime adapter job must
 * copy into its evidence receipt. The full Contract IR and its verification
 * stay with the trusted admission caller.
 */
export function createRuntimeEvidenceContractBinding({ contractIr, contractIrVerification }) {
  const findings = [];
  const binding = validateContractIrBinding({
    contractIr,
    contractIrVerification,
    expectedInputDigest: contractIr?.admission?.receipt?.runId,
    findings,
  });
  if (!binding.verified || findings.length > 0) {
    const ruleIds = findingRuleIds(findings);
    throw new TypeError(
      `cannot create runtime evidence binding: ${ruleIds.join(', ') || 'runtime-contract-ir-not-admissible'}`,
    );
  }
  return Object.freeze({
    contractIrId: binding.irId,
    inputDigest: binding.receiptRunId,
  });
}

/**
 * Give the admission decision its own protocol identity. A runtime evidence
 * envelope and the report deciding whether to admit it are different objects
 * and must not share a schema identifier.
 */
function finalizeRuntimeConformanceReport(report, { contractIr } = {}) {
  const candidateReceiptDigest = contractIr?.admission?.receipt?.digest;
  const receiptDigest = report?.contractIrVerified === true
    && DIGEST_PATTERN.test(candidateReceiptDigest ?? '')
    ? candidateReceiptDigest
    : null;
  return Object.freeze({
    ...report,
    schema: RUNTIME_CONFORMANCE_REPORT_SCHEMA,
    receiptDigest,
  });
}

export function compareRuntimeEvidence(input) {
  return finalizeRuntimeConformanceReport(
    compareRuntimeEvidenceCore(input),
    { contractIr: input?.contractIr },
  );
}
