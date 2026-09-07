import { randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { canonicalStringify, sha256 } from '../canonical.mjs';
import { CONTRACT_IR_VERIFICATION_SCHEMA } from '../contract-ir.mjs';
import { PROJECTION_ADMISSION_REPORT_SCHEMA } from '../projection-admission/index.mjs';
import {
  MAX_RECEIPT_RULES,
  PROJECTION_VERIFICATION_RECEIPT_SCHEMA,
  UnsafeProjectionVerificationReceiptDestinationError,
  isObject,
  validDigest,
  validIdentifier,
} from './constants.mjs';

export function sourceDigestsFromContractIr(contractIr) {
  const sourceDigests = {
    typespec: contractIr?.provenance?.typespec?.digest,
    generatedJsonSchema: contractIr?.provenance?.generatedJsonSchema?.digest,
    authoredJsonSchema: contractIr?.provenance?.authoredJsonSchema?.digest,
  };
  return Object.values(sourceDigests).every(validDigest) ? Object.freeze(sourceDigests) : null;
}

function normalizedSummary(summary) {
  const keys = ['declarations', 'projections', 'outputs', 'representationDeltas', 'runtimeValidators'];
  const result = {};
  for (const key of keys) {
    result[key] = Number.isSafeInteger(summary?.[key]) && summary[key] >= 0 ? summary[key] : 0;
  }
  return Object.freeze(result);
}

function normalizedRuleIds(findings) {
  if (!Array.isArray(findings)) return Object.freeze([]);
  const result = [...new Set(findings
    .map((finding) => finding?.ruleId)
    .filter(validIdentifier))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_RECEIPT_RULES);
  return Object.freeze(result);
}

function contractVerificationPassed(verification, contractIr, report) {
  const ids = [verification?.suppliedIrId, verification?.computedIrId, verification?.expectedIrId];
  return verification?.schema === CONTRACT_IR_VERIFICATION_SCHEMA
    && verification.status === 'passed'
    && verification.admissible === true
    && verification.error === null
    && ids.every(validDigest)
    && new Set(ids).size === 1
    && verification.expectedIrId === contractIr?.irId
    && verification.receiptRunId === report?.receiptRunId;
}

function receiptBody({ report, contractIrVerification, contractIr, statusOverride, failureCode }) {
  const sourceDigests = sourceDigestsFromContractIr(contractIr);
  const status = statusOverride ?? (
    report?.schema === PROJECTION_ADMISSION_REPORT_SCHEMA
      && ['passed', 'stopped_for_evaluation'].includes(report.status)
      ? report.status
      : 'failed'
  );
  const reportPassed = report?.schema === PROJECTION_ADMISSION_REPORT_SCHEMA
    && report.status === 'passed'
    && report.admissible === true
    && Array.isArray(report.findings)
    && report.findings.length === 0
    && validDigest(report.manifestId)
    && validDigest(report.contractIrId)
    && validDigest(report.receiptRunId)
    && validDigest(report.evidenceDigest)
    && report.contractIrId === contractIr?.irId
    && sourceDigests !== null
    && contractVerificationPassed(contractIrVerification, contractIr, report);
  const admitted = status === 'passed' && reportPassed;
  const finalStatus = admitted ? 'passed' : status === 'stopped_for_evaluation' ? status : 'failed';
  return {
    schema: PROJECTION_VERIFICATION_RECEIPT_SCHEMA,
    status: finalStatus,
    admissible: admitted,
    manifestId: validDigest(report?.manifestId) ? report.manifestId : null,
    contractIrId: validDigest(report?.contractIrId)
      ? report.contractIrId
      : validDigest(contractIr?.irId)
        ? contractIr.irId
        : null,
    receiptRunId: validDigest(report?.receiptRunId)
      ? report.receiptRunId
      : validDigest(contractIr?.admission?.receipt?.runId)
        ? contractIr.admission.receipt.runId
        : null,
    evidenceDigest: validDigest(report?.evidenceDigest) ? report.evidenceDigest : null,
    sourceDigests,
    summary: normalizedSummary(report?.summary),
    findingRuleIds: normalizedRuleIds(report?.findings),
    failureCode: admitted
      ? null
      : failureCode ?? (finalStatus === 'stopped_for_evaluation'
        ? 'projection-verification-stopped'
        : 'projection-verification-failed'),
  };
}

export function createProjectionVerificationReceipt({ report, contractIrVerification, contractIr }) {
  const body = receiptBody({ report, contractIrVerification, contractIr });
  return Object.freeze({ ...body, verificationId: sha256(canonicalStringify(body)) });
}

export function failedProjectionVerificationReceipt({ manifest, contractIr, parityReceipt } = {}) {
  const body = receiptBody({
    report: {
      schema: PROJECTION_ADMISSION_REPORT_SCHEMA,
      status: 'failed',
      admissible: false,
      manifestId: validDigest(manifest?.manifestId) ? manifest.manifestId : null,
      contractIrId: validDigest(contractIr?.irId) ? contractIr.irId : null,
      receiptRunId: validDigest(parityReceipt?.runId) ? parityReceipt.runId : null,
      evidenceDigest: null,
      findings: [{ ruleId: 'projection-verification-internal-failure' }],
      summary: {},
    },
    contractIrVerification: null,
    contractIr,
    statusOverride: 'failed',
    failureCode: 'projection-verification-failed',
  });
  return Object.freeze({ ...body, verificationId: sha256(canonicalStringify(body)) });
}

function exactKeys(value, keys) {
  return isObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function nullableDigest(value) {
  return value === null || validDigest(value);
}

function validSummary(value) {
  const keys = ['declarations', 'projections', 'outputs', 'representationDeltas', 'runtimeValidators'];
  return exactKeys(value, keys)
    && keys.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function validRuleIds(value) {
  return Array.isArray(value)
    && value.length <= MAX_RECEIPT_RULES
    && value.every(validIdentifier)
    && new Set(value).size === value.length
    && value.every((item, index) => index === 0 || value[index - 1].localeCompare(item) < 0);
}

function validSourceDigests(value) {
  const keys = ['typespec', 'generatedJsonSchema', 'authoredJsonSchema'];
  return value === null || (exactKeys(value, keys) && keys.every((key) => validDigest(value[key])));
}

function safeReceipt(value) {
  const keys = [
    'schema',
    'verificationId',
    'status',
    'admissible',
    'manifestId',
    'contractIrId',
    'receiptRunId',
    'evidenceDigest',
    'sourceDigests',
    'summary',
    'findingRuleIds',
    'failureCode',
  ];
  if (!exactKeys(value, keys) || value.schema !== PROJECTION_VERIFICATION_RECEIPT_SCHEMA) return false;
  if (!['passed', 'stopped_for_evaluation', 'failed'].includes(value.status)) return false;
  if (typeof value.admissible !== 'boolean' || value.admissible !== (value.status === 'passed')) return false;
  if (![value.manifestId, value.contractIrId, value.receiptRunId, value.evidenceDigest].every(nullableDigest)) return false;
  if (!validSourceDigests(value.sourceDigests) || !validSummary(value.summary) || !validRuleIds(value.findingRuleIds)) return false;
  const { verificationId, ...body } = value;
  if (!validDigest(verificationId) || verificationId !== sha256(canonicalStringify(body))) return false;
  if (value.status === 'passed') {
    return [value.manifestId, value.contractIrId, value.receiptRunId, value.evidenceDigest].every(validDigest)
      && value.sourceDigests !== null
      && value.summary.projections > 0
      && value.summary.outputs > 0
      && value.failureCode === null
      && value.findingRuleIds.length === 0;
  }
  if (value.status === 'stopped_for_evaluation') {
    return value.failureCode === 'projection-verification-stopped'
      && value.findingRuleIds.length > 0;
  }
  return value.failureCode === 'projection-verification-failed';
}

async function inspectExistingDestination(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
      throw new UnsafeProjectionVerificationReceiptDestinationError(
        'refusing to replace projection verification evidence unless it is a singly linked regular file',
      );
    }
    let existing;
    try {
      existing = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new UnsafeProjectionVerificationReceiptDestinationError(
        'refusing to replace an unrecognized projection verification evidence file',
      );
    }
    if (!safeReceipt(existing)) {
      throw new UnsafeProjectionVerificationReceiptDestinationError(
        'refusing to replace an unrecognized projection verification evidence file',
      );
    }
    return info;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function unchanged(before, after) {
  return before !== null && after !== null
    && before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

export async function writeProjectionVerificationReceipt(path, receipt) {
  if (!safeReceipt(receipt)) {
    throw new UnsafeProjectionVerificationReceiptDestinationError(
      'refusing to write malformed projection verification evidence',
    );
  }
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const before = await inspectExistingDestination(target);
  const serialized = `${canonicalStringify(receipt, 2)}\n`;
  const temporary = resolve(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (before === null) {
      await link(temporary, target);
      await unlink(temporary);
    } else {
      const after = await inspectExistingDestination(target);
      if (!unchanged(before, after)) {
        throw new UnsafeProjectionVerificationReceiptDestinationError(
          'projection verification evidence changed during replacement',
        );
      }
      await rename(temporary, target);
    }
    const finalInfo = await lstat(target);
    if (!finalInfo.isFile() || finalInfo.isSymbolicLink() || finalInfo.nlink !== 1) {
      throw new UnsafeProjectionVerificationReceiptDestinationError(
        'projection verification evidence did not land safely',
      );
    }
    return target;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
