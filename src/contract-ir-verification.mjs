import { canonicalStringify, sha256 } from './canonical.mjs';
import {
  CONTRACT_IR_VERIFICATION_SCHEMA,
  verifyContractIr,
} from './contract-ir.mjs';
import { writeContractIrVerificationFile } from './contract-ir-verification-file.mjs';

const HEX_256 = /^[a-f0-9]{64}$/u;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function digestOrNull(value) {
  return typeof value === 'string' && HEX_256.test(value) ? value : null;
}

function computedContractIrId(contractIr) {
  if (!isObject(contractIr)) return null;
  const body = { ...contractIr };
  delete body.irId;
  return sha256(canonicalStringify(body));
}

function safeError(value, fallback) {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (value instanceof Error && value.message.trim() !== '') return value.message;
  return fallback;
}

/**
 * Add a deterministic self-digest and normalize untrusted identifiers before
 * publishing consumer-visible Contract IR verification evidence.
 */
export function createContractIrVerificationArtifact(result) {
  const passed = result?.status === 'passed' && result?.admissible === true;
  const body = {
    schema: CONTRACT_IR_VERIFICATION_SCHEMA,
    status: passed ? 'passed' : 'failed',
    admissible: passed,
    suppliedIrId: digestOrNull(result?.suppliedIrId),
    computedIrId: digestOrNull(result?.computedIrId),
    expectedIrId: digestOrNull(result?.expectedIrId),
    receiptRunId: digestOrNull(result?.receiptRunId),
    error: passed
      ? null
      : safeError(result?.error, 'contract-ir-or-current-evidence-mismatch'),
  };
  return { ...body, verificationId: sha256(canonicalStringify(body)) };
}

/**
 * Recompute the expected Contract IR from the supplied receipt and current
 * source closure, then publish deterministic consumer admission evidence.
 */
export async function verifyContractIrForConsumer(input) {
  const result = await verifyContractIr(input);
  return createContractIrVerificationArtifact(result);
}

/**
 * Build deterministic failure evidence for errors that happen before the
 * normal verifier can run, such as unreadable or malformed JSON inputs.
 */
export function failedContractIrVerification({ contractIr = null, report = null, error = null } = {}) {
  return createContractIrVerificationArtifact({
    status: 'failed',
    admissible: false,
    suppliedIrId: digestOrNull(contractIr?.irId),
    computedIrId: computedContractIrId(contractIr),
    expectedIrId: null,
    receiptRunId: digestOrNull(report?.runId),
    error: safeError(error, 'contract-ir-verification-could-not-run'),
  });
}

export async function writeContractIrVerification(path, verification) {
  return writeContractIrVerificationFile(
    path,
    `${canonicalStringify(verification, 2)}\n`,
    CONTRACT_IR_VERIFICATION_SCHEMA,
  );
}
