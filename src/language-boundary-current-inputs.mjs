import { canonicalStringify, sha256, stableFindingFingerprint } from './canonical.mjs';
import {
  CONTRACT_IR_VERIFICATION_SCHEMA,
  verifyContractIr,
} from './contract-ir.mjs';
import {
  LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
  verifyLanguageBoundaries,
} from './language-boundary-verification.mjs';

function makeFinding(ruleId, message, pointer) {
  const finding = {
    ruleId,
    severity: 'error',
    resolutionState: 'unexplained',
    comparison: 'language-runtime-boundary',
    pointer,
    message,
  };
  return Object.freeze({
    ...finding,
    fingerprint: stableFindingFingerprint(finding),
  });
}

function uniqueSortedFindings(existing, additional) {
  const byIdentity = new Map();
  for (const finding of [...existing, ...additional]) {
    byIdentity.set(`${finding.ruleId}\u0000${finding.pointer}`, finding);
  }
  return Object.freeze([...byIdentity.values()].sort((left, right) => {
    const byRule = left.ruleId.localeCompare(right.ruleId);
    return byRule !== 0 ? byRule : left.pointer.localeCompare(right.pointer);
  }));
}

function stoppedForCurrentInputFailure(boundaryInput, ruleId, message, pointer) {
  const base = verifyLanguageBoundaries(boundaryInput);
  const findings = uniqueSortedFindings(base.findings, [makeFinding(ruleId, message, pointer)]);
  const counts = Object.freeze({
    ...base.counts,
    admittedEvidence: 0,
    findings: findings.length,
  });
  const body = Object.freeze({
    schema: LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
    status: 'stopped_for_evaluation',
    zeroUnexplainedFindings: false,
    binding: base.binding,
    counts,
    findings,
  });
  return Object.freeze({
    ...body,
    verificationId: `sha256:${sha256(canonicalStringify(body))}`,
  });
}

function freshContractIrVerification(verification, contractIr, report) {
  const irId = contractIr?.irId;
  if (typeof irId !== 'string' || irId === '') return false;
  return verification?.schema === CONTRACT_IR_VERIFICATION_SCHEMA
    && verification.status === 'passed'
    && verification.admissible === true
    && verification.error === null
    && verification.suppliedIrId === irId
    && verification.computedIrId === irId
    && verification.expectedIrId === irId
    && verification.receiptRunId === report?.runId;
}

function explicitCurrentInputPathsPresent(input) {
  return ['typespec', 'generatedSchema', 'authoredSchema']
    .every((name) => typeof input?.[name] === 'string' && input[name].trim() !== '');
}

/**
 * Preferred promotion entrypoint for language/runtime boundary evidence.
 *
 * The pure verifyLanguageBoundaries() function intentionally validates supplied
 * immutable objects only. This wrapper first recomputes Contract IR verification
 * from the current checked-out TypeSpec, generated Schema B, independently
 * authored Schema A, and retained parity report. Runtime evidence is considered
 * only when that exact current-input closure still matches the retained IR.
 *
 * Errors from filesystem/compiler/schema loading are deliberately collapsed to
 * stable rule identifiers; paths, source values, exception strings, and secrets
 * are never reflected into the returned public-safe receipt.
 */
export async function verifyLanguageBoundariesAgainstCurrentInputs(input = {}) {
  const boundaryInput = {
    manifest: input.manifest,
    report: input.report,
    contractIr: input.contractIr,
    evidenceByPath: input.evidenceByPath,
  };

  if (!explicitCurrentInputPathsPresent(input)) {
    return stoppedForCurrentInputFailure(
      boundaryInput,
      'boundary-current-input-path-missing',
      'explicit current TypeSpec, generated JSON Schema, and authored JSON Schema paths are required',
      '#/currentInputs',
    );
  }

  let contractIrVerification;
  try {
    contractIrVerification = await verifyContractIr({
      contractIr: input.contractIr,
      report: input.report,
      typespec: input.typespec,
      generatedSchema: input.generatedSchema,
      authoredSchema: input.authoredSchema,
    });
  } catch {
    return stoppedForCurrentInputFailure(
      boundaryInput,
      'boundary-current-contract-ir-verification-failed',
      'Contract IR could not be freshly verified against the retained parity receipt and current source inputs',
      '#/currentInputs/contractIrVerification',
    );
  }

  if (!freshContractIrVerification(contractIrVerification, input.contractIr, input.report)) {
    return stoppedForCurrentInputFailure(
      boundaryInput,
      'boundary-current-contract-ir-verification-failed',
      'Contract IR did not freshly verify against the retained parity receipt and current source inputs',
      '#/currentInputs/contractIrVerification',
    );
  }

  return verifyLanguageBoundaries(boundaryInput);
}
