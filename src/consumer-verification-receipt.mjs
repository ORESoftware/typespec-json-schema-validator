import { canonicalStringify, sha256 } from './canonical.mjs';
import { CONTRACT_IR_VERIFICATION_SCHEMA } from './contract-ir.mjs';
import { verifyConsumerContract } from './consumer-verification.mjs';
import { writeConsumerVerificationReceiptFile } from './consumer-verification-receipt-file.mjs';

export const CONSUMER_VERIFICATION_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.consumer-verification-receipt/v1';

const HEX_256 = /^[a-f0-9]{64}$/u;
const MAX_DECLARATION_ID_BYTES = 512;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function digestOrNull(value) {
  return typeof value === 'string' && HEX_256.test(value) ? value : null;
}

function validDeclarationId(value) {
  return typeof value === 'string'
    && value !== ''
    && value.trim() === value
    && Buffer.byteLength(value, 'utf8') <= MAX_DECLARATION_ID_BYTES;
}

function normalizeDeclarationIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(validDeclarationId))].sort();
}

function computedContractIrId(contractIr) {
  if (!isObject(contractIr)) return null;
  const body = { ...contractIr };
  delete body.irId;
  return sha256(canonicalStringify(body));
}

function finalize(body) {
  return Object.freeze({
    ...body,
    verificationId: sha256(canonicalStringify(body)),
  });
}

/**
 * Convert the canonical verifier result plus the consumer's exact declaration
 * scope into a separately identifiable, self-digesting receipt.
 */
export function createConsumerVerificationReceipt(result) {
  const rawDeclarationIds = result?.declarationIds;
  const declarationIds = normalizeDeclarationIds(rawDeclarationIds);
  const declarationScopeIsValid = Array.isArray(rawDeclarationIds)
    && rawDeclarationIds.length === declarationIds.length
    && rawDeclarationIds.every(validDeclarationId);
  const suppliedIrId = digestOrNull(result?.suppliedIrId);
  const computedIrId = digestOrNull(result?.computedIrId);
  const expectedIrId = digestOrNull(result?.expectedIrId);
  const receiptRunId = digestOrNull(result?.receiptRunId);
  const passed = result?.schema === CONTRACT_IR_VERIFICATION_SCHEMA
    && result?.status === 'passed'
    && result?.admissible === true
    && result?.error === null
    && suppliedIrId !== null
    && computedIrId === suppliedIrId
    && expectedIrId === suppliedIrId
    && receiptRunId !== null
    && declarationScopeIsValid
    && declarationIds.length > 0;

  return finalize({
    schema: CONSUMER_VERIFICATION_RECEIPT_SCHEMA,
    status: passed ? 'passed' : 'failed',
    admissible: passed,
    suppliedIrId,
    computedIrId,
    expectedIrId,
    receiptRunId,
    declarationIds,
    failureCode: passed ? null : 'consumer-verification-failed',
  });
}

/**
 * Recompute canonical Contract IR verification over explicit current paths,
 * enforce complete consumer scope, and create durable admission evidence.
 */
export async function verifyConsumerContractReceipt(input) {
  const result = await verifyConsumerContract(input);
  return createConsumerVerificationReceipt(result);
}

/** Build bounded failure evidence without persisting arbitrary exception text. */
export function failedConsumerVerificationReceipt({
  contractIr = null,
  report = null,
  expectedDeclarations = null,
} = {}) {
  const declarationIds = normalizeDeclarationIds(
    expectedDeclarations
      ?? contractIr?.declarations?.map((entry) => entry?.id),
  );
  return finalize({
    schema: CONSUMER_VERIFICATION_RECEIPT_SCHEMA,
    status: 'failed',
    admissible: false,
    suppliedIrId: digestOrNull(contractIr?.irId),
    computedIrId: computedContractIrId(contractIr),
    expectedIrId: null,
    receiptRunId: digestOrNull(report?.runId),
    declarationIds,
    failureCode: 'consumer-verification-failed',
  });
}

export async function writeConsumerVerificationReceipt(path, receipt) {
  return writeConsumerVerificationReceiptFile(
    path,
    `${canonicalStringify(receipt, 2)}\n`,
    CONSUMER_VERIFICATION_RECEIPT_SCHEMA,
  );
}
