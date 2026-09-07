import { canonicalStringify, sha256 } from '../canonical.mjs';
import {
  CONTRACT_IR_SCHEMA,
  CONTRACT_IR_VERIFICATION_SCHEMA,
} from '../contract-ir.mjs';
import { DIGEST_PATTERN, isPlainObject } from './constants.mjs';
import { makeRuntimeFinding } from './findings.mjs';

const REPORT_SCHEMA = 'ores.typespec-json-schema-validator.report/v1';
const EXPECTED_AUTHORITIES = Object.freeze({
  typespec: 'independently-authored',
  jsonSchema: 'independently-authored',
  generatedJsonSchema: 'comparison-evidence-only',
  precedence: 'none',
});

function safeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function addFinding(findings, input) {
  findings.push(makeRuntimeFinding(input));
}

function validDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function validateAuthorityRoles(contractIr, findings) {
  const roles = contractIr.authorities;
  if (!isPlainObject(roles)) {
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-authorities-invalid',
      pointer: '#/contractIr/authorities',
      message: 'Contract IR must preserve both authored authorities and the comparison-only generated lane',
      left: safeType(roles),
      right: EXPECTED_AUTHORITIES,
    });
    return false;
  }

  let valid = true;
  for (const [field, expected] of Object.entries(EXPECTED_AUTHORITIES)) {
    if (roles[field] !== expected) {
      valid = false;
      addFinding(findings, {
        ruleId: 'runtime-contract-ir-authority-role-mismatch',
        pointer: `#/contractIr/authorities/${field}`,
        message: `Contract IR authority role ${field} is missing or unsupported`,
        left: typeof roles[field] === 'string' ? roles[field] : safeType(roles[field]),
        right: expected,
      });
    }
  }
  return valid;
}

function validateReceipt(contractIr, expectedInputDigest, findings) {
  const receipt = contractIr.admission?.receipt;
  if (!isPlainObject(receipt)) {
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-receipt-invalid',
      pointer: '#/contractIr/admission/receipt',
      message: 'Contract IR is missing its parity receipt binding',
      left: safeType(receipt),
      right: 'digest-bound passed parity receipt',
    });
    return { valid: false, runId: null };
  }

  let valid = true;
  const checks = [
    ['schema', receipt.schema === REPORT_SCHEMA, REPORT_SCHEMA],
    ['runId', validDigest(receipt.runId), 'lowercase SHA-256 digest'],
    ['digest', validDigest(receipt.digest), 'lowercase SHA-256 digest'],
    ['status', receipt.status === 'passed', 'passed'],
    ['zeroUnexplainedFindings', receipt.zeroUnexplainedFindings === true, true],
  ];
  for (const [field, passed, expected] of checks) {
    if (!passed) {
      valid = false;
      addFinding(findings, {
        ruleId: 'runtime-contract-ir-receipt-invalid',
        pointer: `#/contractIr/admission/receipt/${field}`,
        message: `Contract IR parity receipt field ${field} is missing or non-admissible`,
        left: typeof receipt[field] === 'string' || typeof receipt[field] === 'boolean'
          ? receipt[field]
          : safeType(receipt[field]),
        right: expected,
      });
    }
  }

  if (validDigest(expectedInputDigest) && receipt.runId !== expectedInputDigest) {
    valid = false;
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-input-digest-mismatch',
      pointer: '#/contractIr/admission/receipt/runId',
      message: 'Contract IR parity receipt does not match the requested authority/configuration closure',
      left: receipt.runId,
      right: expectedInputDigest,
    });
  }

  return { valid, runId: validDigest(receipt.runId) ? receipt.runId : null };
}

function validateProvenance(contractIr, findings) {
  const provenance = contractIr.provenance;
  if (!isPlainObject(provenance)) {
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-provenance-invalid',
      pointer: '#/contractIr/provenance',
      message: 'Contract IR is missing exact source-lane provenance',
      left: safeType(provenance),
      right: 'TypeSpec, generated JSON Schema, and authored JSON Schema digests',
    });
    return false;
  }

  let valid = true;
  for (const lane of ['typespec', 'generatedJsonSchema', 'authoredJsonSchema']) {
    if (!isPlainObject(provenance[lane]) || !validDigest(provenance[lane].digest)) {
      valid = false;
      addFinding(findings, {
        ruleId: 'runtime-contract-ir-provenance-invalid',
        pointer: `#/contractIr/provenance/${lane}/digest`,
        message: `Contract IR provenance for ${lane} must contain a lowercase SHA-256 digest`,
        left: isPlainObject(provenance[lane])
          ? provenance[lane].digest
          : safeType(provenance[lane]),
        right: '64 lowercase hexadecimal characters',
      });
    }
  }
  return valid;
}

function validateVerification(verification, irId, receiptRunId, findings) {
  if (!isPlainObject(verification)) {
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-verification-missing',
      pointer: '#/contractIrVerification',
      message: 'Runtime evidence admission requires a fresh Contract IR verification result',
      left: safeType(verification),
      right: CONTRACT_IR_VERIFICATION_SCHEMA,
    });
    return false;
  }

  const matches = verification.schema === CONTRACT_IR_VERIFICATION_SCHEMA
    && verification.status === 'passed'
    && verification.admissible === true
    && verification.error === null
    && verification.suppliedIrId === irId
    && verification.computedIrId === irId
    && verification.expectedIrId === irId
    && verification.receiptRunId === receiptRunId;
  if (!matches) {
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-verification-failed',
      pointer: '#/contractIrVerification',
      message: 'Contract IR was not freshly verified against the retained receipt and current source inputs',
      left: {
        schema: typeof verification.schema === 'string' ? verification.schema : safeType(verification.schema),
        status: typeof verification.status === 'string' ? verification.status : safeType(verification.status),
        admissible: verification.admissible === true,
        suppliedIrId: validDigest(verification.suppliedIrId) ? verification.suppliedIrId : null,
        computedIrId: validDigest(verification.computedIrId) ? verification.computedIrId : null,
        expectedIrId: validDigest(verification.expectedIrId) ? verification.expectedIrId : null,
        receiptRunId: validDigest(verification.receiptRunId) ? verification.receiptRunId : null,
        hasError: verification.error !== null,
      },
      right: {
        schema: CONTRACT_IR_VERIFICATION_SCHEMA,
        status: 'passed',
        admissible: true,
        irId,
        receiptRunId,
        hasError: false,
      },
    });
    return false;
  }
  return true;
}

function admittedDeclarationIds(contractIr, findings) {
  if (!Array.isArray(contractIr.declarations)) {
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-declarations-invalid',
      pointer: '#/contractIr/declarations',
      message: 'Contract IR must expose the exact declarations admitted by parity',
      left: safeType(contractIr.declarations),
      right: 'array',
    });
    return { valid: false, ids: new Set() };
  }

  let valid = true;
  const ids = new Set();
  for (let index = 0; index < contractIr.declarations.length; index += 1) {
    const declaration = contractIr.declarations[index];
    const id = isPlainObject(declaration) ? declaration.id : undefined;
    if (typeof id !== 'string' || id.length === 0 || id.length > 512) {
      valid = false;
      addFinding(findings, {
        ruleId: 'runtime-contract-ir-declaration-invalid',
        pointer: `#/contractIr/declarations/${index}/id`,
        message: 'Contract IR declaration identities must be non-empty bounded strings',
        left: typeof id === 'string' ? id.length : safeType(id),
        right: '1..512 characters',
      });
      continue;
    }
    if (ids.has(id)) {
      valid = false;
      addFinding(findings, {
        ruleId: 'runtime-contract-ir-declaration-duplicate',
        declaration: id,
        pointer: `#/contractIr/declarations/${index}/id`,
        message: `Contract IR repeats admitted declaration ${id}`,
        left: id,
        right: 'unique declaration identity',
      });
      continue;
    }
    ids.add(id);
  }
  return { valid, ids };
}

/**
 * Validate the digest chain that makes runtime adapter receipts subordinate to
 * a parity-approved Contract IR. The verification object must come from a
 * fresh verifyContractIr()/verifyContractIrEvidence() call over current inputs.
 */
export function validateContractIrBinding({
  contractIr,
  contractIrVerification,
  expectedInputDigest,
  findings,
}) {
  if (!isPlainObject(contractIr)) {
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-invalid',
      pointer: '#/contractIr',
      message: 'runtime evidence must be bound to a Contract IR object',
      left: safeType(contractIr),
      right: CONTRACT_IR_SCHEMA,
    });
    return Object.freeze({ verified: false, irId: null, receiptRunId: null, declarationIds: new Set() });
  }

  let valid = true;
  if (contractIr.schema !== CONTRACT_IR_SCHEMA) {
    valid = false;
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-schema-mismatch',
      pointer: '#/contractIr/schema',
      message: 'Contract IR schema identifier is missing or unsupported',
      left: typeof contractIr.schema === 'string' ? contractIr.schema : safeType(contractIr.schema),
      right: CONTRACT_IR_SCHEMA,
    });
  }

  const suppliedIrId = contractIr.irId;
  let computedIrId = null;
  try {
    const body = { ...contractIr };
    delete body.irId;
    computedIrId = sha256(canonicalStringify(body));
  } catch {
    valid = false;
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-invalid',
      pointer: '#/contractIr',
      message: 'Contract IR cannot be deterministically canonicalized',
      left: 'non-canonicalizable object',
      right: 'deterministic JSON value',
    });
  }
  if (!validDigest(suppliedIrId) || suppliedIrId !== computedIrId) {
    valid = false;
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-self-digest-mismatch',
      pointer: '#/contractIr/irId',
      message: 'Contract IR self-digest is missing, malformed, or stale',
      left: validDigest(suppliedIrId) ? suppliedIrId : null,
      right: computedIrId,
    });
  }

  if (contractIr.status !== 'passed'
    || contractIr.admissible !== true
    || contractIr.editableAuthority !== false) {
    valid = false;
    addFinding(findings, {
      ruleId: 'runtime-contract-ir-not-admissible',
      pointer: '#/contractIr',
      message: 'runtime evidence cannot use a stopped, failed, editable, or non-admissible Contract IR',
      left: {
        status: typeof contractIr.status === 'string' ? contractIr.status : safeType(contractIr.status),
        admissible: contractIr.admissible === true,
        editableAuthority: contractIr.editableAuthority !== false,
      },
      right: { status: 'passed', admissible: true, editableAuthority: false },
    });
  }

  valid = validateAuthorityRoles(contractIr, findings) && valid;
  const receipt = validateReceipt(contractIr, expectedInputDigest, findings);
  valid = receipt.valid && valid;
  valid = validateProvenance(contractIr, findings) && valid;
  const declarations = admittedDeclarationIds(contractIr, findings);
  valid = declarations.valid && valid;

  const verificationValid = validateVerification(
    contractIrVerification,
    validDigest(suppliedIrId) ? suppliedIrId : null,
    receipt.runId,
    findings,
  );
  valid = verificationValid && valid;

  return Object.freeze({
    verified: valid,
    irId: validDigest(suppliedIrId) ? suppliedIrId : null,
    receiptRunId: receipt.runId,
    declarationIds: declarations.ids,
  });
}
