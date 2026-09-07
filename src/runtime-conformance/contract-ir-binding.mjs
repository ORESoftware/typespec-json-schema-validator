import { canonicalStringify, sha256 } from '../canonical.mjs';
import {
  CONTRACT_IR_SCHEMA,
  CONTRACT_IR_VERIFICATION_SCHEMA,
  DIGEST_PATTERN,
  PARITY_REPORT_SCHEMA,
  isPlainObject,
} from './constants.mjs';
import { makeRuntimeFinding } from './findings.mjs';

function requireCondition(condition, message) {
  if (!condition) throw new TypeError(`invalid trusted Contract IR binding: ${message}`);
}

function requireDigest(value, label) {
  requireCondition(typeof value === 'string' && DIGEST_PATTERN.test(value), `${label} must be a lowercase SHA-256 digest`);
  return value;
}

function contractIrSelfDigest(contractIr) {
  const body = { ...contractIr };
  delete body.irId;
  return sha256(canonicalStringify(body));
}

/**
 * Build the compact binding that an adapter must copy into runtime evidence.
 * The caller must provide a current verification result produced from the
 * checked-out authority closure; copied status strings are not sufficient.
 */
export function createRuntimeEvidenceContractBinding({ contractIr, contractIrVerification }) {
  requireCondition(isPlainObject(contractIr), 'contractIr must be an object');
  requireCondition(contractIr.schema === CONTRACT_IR_SCHEMA, `contractIr.schema must be ${CONTRACT_IR_SCHEMA}`);
  requireCondition(contractIr.status === 'passed', 'contractIr.status must be passed');
  requireCondition(contractIr.admissible === true, 'contractIr.admissible must be true');
  const irId = requireDigest(contractIr.irId, 'contractIr.irId');
  requireCondition(contractIrSelfDigest(contractIr) === irId, 'contractIr.irId does not match the canonical artifact body');

  const receipt = contractIr.admission?.receipt;
  requireCondition(isPlainObject(receipt), 'contractIr.admission.receipt is missing');
  requireCondition(receipt.schema === PARITY_REPORT_SCHEMA, `receipt.schema must be ${PARITY_REPORT_SCHEMA}`);
  requireCondition(receipt.status === 'passed', 'receipt.status must be passed');
  requireCondition(receipt.zeroUnexplainedFindings === true, 'receipt must have zero unexplained findings');
  const runId = requireDigest(receipt.runId, 'receipt.runId');
  const digest = requireDigest(receipt.digest, 'receipt.digest');

  requireCondition(isPlainObject(contractIrVerification), 'contractIrVerification must be an object');
  requireCondition(
    contractIrVerification.schema === CONTRACT_IR_VERIFICATION_SCHEMA,
    `contractIrVerification.schema must be ${CONTRACT_IR_VERIFICATION_SCHEMA}`,
  );
  requireCondition(contractIrVerification.status === 'passed', 'contractIrVerification.status must be passed');
  requireCondition(contractIrVerification.admissible === true, 'contractIrVerification.admissible must be true');
  requireCondition(contractIrVerification.error === null, 'contractIrVerification.error must be null');
  for (const field of ['suppliedIrId', 'computedIrId', 'expectedIrId']) {
    requireCondition(contractIrVerification[field] === irId, `contractIrVerification.${field} must equal contractIr.irId`);
  }
  requireCondition(
    contractIrVerification.receiptRunId === runId,
    'contractIrVerification.receiptRunId must equal the admitted parity receipt runId',
  );

  return Object.freeze({
    schema: CONTRACT_IR_SCHEMA,
    irId,
    parityReceipt: Object.freeze({ runId, digest }),
  });
}

function evidenceDigest(value, pointer, label, findings) {
  if (!DIGEST_PATTERN.test(value ?? '')) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-evidence-invalid-digest',
      pointer,
      message: `${label} must be a lowercase SHA-256 digest`,
      left: value,
      right: '64 lowercase hexadecimal characters',
    }));
    return null;
  }
  return value;
}

export function normalizeRuntimeEvidenceContractBinding(value, findings) {
  if (!isPlainObject(value)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-contract-binding-invalid',
      pointer: '#/contractIr',
      message: 'runtime evidence must include a Contract IR binding object',
      left: value,
      right: 'object',
    }));
    return null;
  }
  if (value.schema !== CONTRACT_IR_SCHEMA) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-contract-schema-mismatch',
      pointer: '#/contractIr/schema',
      message: 'runtime evidence Contract IR schema identifier is missing or unsupported',
      left: value.schema,
      right: CONTRACT_IR_SCHEMA,
    }));
  }
  const irId = evidenceDigest(value.irId, '#/contractIr/irId', 'contractIr.irId', findings);
  const receipt = value.parityReceipt;
  if (!isPlainObject(receipt)) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-contract-receipt-invalid',
      pointer: '#/contractIr/parityReceipt',
      message: 'runtime evidence must bind the admitted parity receipt',
      left: receipt,
      right: 'object containing runId and digest',
    }));
    return Object.freeze({
      schema: value.schema,
      irId,
      parityReceipt: Object.freeze({ runId: null, digest: null }),
    });
  }
  const runId = evidenceDigest(
    receipt.runId,
    '#/contractIr/parityReceipt/runId',
    'contractIr.parityReceipt.runId',
    findings,
  );
  const digest = evidenceDigest(
    receipt.digest,
    '#/contractIr/parityReceipt/digest',
    'contractIr.parityReceipt.digest',
    findings,
  );
  return Object.freeze({
    schema: value.schema,
    irId,
    parityReceipt: Object.freeze({ runId, digest }),
  });
}

export function resolveTrustedRuntimeEvidenceContractBinding(input, findings) {
  try {
    return createRuntimeEvidenceContractBinding(input);
  } catch (error) {
    findings.push(makeRuntimeFinding({
      ruleId: 'runtime-contract-ir-not-admissible',
      pointer: '#/trustedContractIr',
      message: 'runtime conformance requires the actual current, parity-approved Contract IR and its passed verification',
      left: error instanceof Error ? error.message : String(error),
      right: 'passed Contract IR verification bound to the checked-out authority closure',
    }));
    return null;
  }
}
