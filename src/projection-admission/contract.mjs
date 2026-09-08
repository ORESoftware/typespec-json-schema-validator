import { canonicalStringify, sha256 } from '../canonical.mjs';
import {
  CONTRACT_IR_SCHEMA,
  PARITY_REPORT_SCHEMA,
  validDigest,
  isPlainObject,
} from './constants.mjs';
import { makeProjectionFinding } from './findings.mjs';

const SOURCE_LANES = Object.freeze([
  'typespec',
  'generatedJsonSchema',
  'authoredJsonSchema',
]);

function digestJson(value) {
  return sha256(canonicalStringify(value));
}

function add(findings, ruleId, pointer, message) {
  findings.push(makeProjectionFinding({ ruleId, pointer, message }));
}

function validPassedReceipt(receipt, findings) {
  if (!isPlainObject(receipt)) {
    add(findings, 'projection-receipt-invalid', '#/receipt', 'parity receipt must be an object');
    return false;
  }
  if (receipt.schema !== PARITY_REPORT_SCHEMA) {
    add(findings, 'projection-receipt-schema-invalid', '#/receipt/schema', 'parity receipt schema is unsupported');
  }
  if (!validDigest(receipt.runId)) {
    add(findings, 'projection-receipt-run-id-invalid', '#/receipt/runId', 'parity receipt runId is invalid');
  }
  if (receipt.status !== 'passed') {
    add(findings, 'projection-receipt-status-invalid', '#/receipt/status', 'parity receipt must have passed');
  }
  if (receipt.zeroUnexplainedFindings !== true) {
    add(findings, 'projection-receipt-findings-not-zero', '#/receipt/zeroUnexplainedFindings', 'parity receipt must have zero unexplained findings');
  }
  if (!Array.isArray(receipt.findings) || receipt.findings.length !== 0) {
    add(findings, 'projection-receipt-findings-present', '#/receipt/findings', 'parity receipt findings must be an empty array');
  }
  const requiredCoverage = [
    'directDeclarationInventory',
    'typespecGeneratedJsonSchemaComparison',
    'differentialInstanceValidation',
  ];
  if (!isPlainObject(receipt.coverage)) {
    add(findings, 'projection-receipt-coverage-missing', '#/receipt/coverage', 'parity receipt coverage is missing');
  } else {
    for (const key of requiredCoverage) {
      if (receipt.coverage[key] !== true) {
        add(findings, 'projection-receipt-coverage-incomplete', `#/receipt/coverage/${key}`, 'mandatory parity coverage is absent');
      }
    }
  }
  if (!isPlainObject(receipt.inputs)) {
    add(findings, 'projection-receipt-inputs-missing', '#/receipt/inputs', 'parity receipt input evidence is missing');
  } else {
    for (const lane of SOURCE_LANES) {
      if (!isPlainObject(receipt.inputs[lane]) || !validDigest(receipt.inputs[lane].digest)) {
        add(findings, 'projection-receipt-input-digest-invalid', `#/receipt/inputs/${lane}/digest`, 'parity input digest is invalid');
      }
    }
  }
  return findings.length === 0;
}

function validExpectedSourceClosure(expectedSourceDigests, findings) {
  if (!isPlainObject(expectedSourceDigests)) {
    add(
      findings,
      'projection-current-source-evidence-missing',
      '#/expectedSourceDigests',
      'independently observed current source digests are required',
    );
    return false;
  }
  const actualKeys = Object.keys(expectedSourceDigests).sort((left, right) => left.localeCompare(right));
  const expectedKeys = [...SOURCE_LANES].sort((left, right) => left.localeCompare(right));
  if (canonicalStringify(actualKeys) !== canonicalStringify(expectedKeys)) {
    add(
      findings,
      'projection-current-source-closure-invalid',
      '#/expectedSourceDigests',
      'current source evidence must contain exactly the three peer-comparison lanes',
    );
  }
  let valid = actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
  for (const lane of SOURCE_LANES) {
    if (!validDigest(expectedSourceDigests[lane])) {
      valid = false;
      add(
        findings,
        'projection-current-source-digest-invalid',
        `#/expectedSourceDigests/${lane}`,
        'current source digest must be a lowercase SHA-256 digest',
      );
    }
  }
  return valid;
}

function verifyDeclarationDigests(contractIr, findings) {
  if (!Array.isArray(contractIr.declarations)) {
    add(findings, 'projection-contract-declarations-invalid', '#/contractIr/declarations', 'Contract IR declarations must be an array');
    return [];
  }
  const ids = [];
  const seen = new Set();
  for (let index = 0; index < contractIr.declarations.length; index += 1) {
    const declaration = contractIr.declarations[index];
    const pointer = `#/contractIr/declarations/${index}`;
    if (!isPlainObject(declaration) || typeof declaration.id !== 'string' || declaration.id.length === 0) {
      add(findings, 'projection-contract-declaration-invalid', pointer, 'Contract IR declaration identity is invalid');
      continue;
    }
    if (seen.has(declaration.id)) {
      add(findings, 'projection-contract-declaration-duplicate', `${pointer}/id`, 'Contract IR declaration identity is duplicated');
      continue;
    }
    seen.add(declaration.id);
    ids.push(declaration.id);
    if (!validDigest(declaration.assertionDigest)
      || declaration.assertionDigest !== digestJson(declaration.assertionSchema)) {
      add(findings, 'projection-contract-assertion-digest-mismatch', `${pointer}/assertionDigest`, 'Contract IR assertion digest is stale or tampered');
    }
    for (const lane of ['typespecGeneratedJsonSchema', 'authoredJsonSchema']) {
      const laneValue = declaration.lanes?.[lane];
      if (!isPlainObject(laneValue)
        || !validDigest(laneValue.schemaDigest)
        || laneValue.schemaDigest !== digestJson(laneValue.normalizedSchema)) {
        add(findings, 'projection-contract-lane-digest-mismatch', `${pointer}/lanes/${lane}/schemaDigest`, 'Contract IR lane digest is stale or tampered');
      }
    }
  }
  return ids.sort((left, right) => left.localeCompare(right));
}

export function verifyProjectionContract({ contractIr, parityReceipt, expectedSourceDigests } = {}) {
  const findings = [];
  validPassedReceipt(parityReceipt, findings);
  const currentSourceClosureValid = validExpectedSourceClosure(expectedSourceDigests, findings);
  if (!isPlainObject(contractIr)) {
    add(findings, 'projection-contract-ir-invalid', '#/contractIr', 'Contract IR must be an object');
    return Object.freeze({ binding: null, declarationIds: Object.freeze([]), findings: Object.freeze(findings) });
  }
  if (contractIr.schema !== CONTRACT_IR_SCHEMA) {
    add(findings, 'projection-contract-ir-schema-invalid', '#/contractIr/schema', 'Contract IR schema is unsupported');
  }
  if (contractIr.status !== 'passed' || contractIr.admissible !== true) {
    add(findings, 'projection-contract-ir-not-admissible', '#/contractIr/status', 'Contract IR must be passed and admissible');
  }
  if (contractIr.role !== 'downstream-derived-parity-artifact' || contractIr.editableAuthority !== false) {
    add(findings, 'projection-contract-ir-role-invalid', '#/contractIr/role', 'Contract IR role or authority mutability is invalid');
  }
  const authorities = contractIr.authorities;
  if (authorities?.typespec !== 'independently-authored'
    || authorities?.jsonSchema !== 'independently-authored'
    || authorities?.generatedJsonSchema !== 'comparison-evidence-only'
    || authorities?.precedence !== 'none') {
    add(findings, 'projection-contract-authority-model-invalid', '#/contractIr/authorities', 'Contract IR must preserve peer authored authorities and comparison-only generated evidence');
  }
  if (!validDigest(contractIr.irId)) {
    add(findings, 'projection-contract-ir-id-invalid', '#/contractIr/irId', 'Contract IR id is invalid');
  } else {
    const { irId: supplied, ...body } = contractIr;
    if (digestJson(body) !== supplied) {
      add(findings, 'projection-contract-ir-id-mismatch', '#/contractIr/irId', 'Contract IR self digest is stale or tampered');
    }
  }
  const receiptDigest = isPlainObject(parityReceipt) ? digestJson(parityReceipt) : null;
  const receiptBinding = contractIr.admission?.receipt;
  if (!isPlainObject(receiptBinding)
    || receiptBinding.schema !== PARITY_REPORT_SCHEMA
    || receiptBinding.runId !== parityReceipt?.runId
    || receiptBinding.digest !== receiptDigest
    || receiptBinding.status !== 'passed'
    || receiptBinding.zeroUnexplainedFindings !== true) {
    add(findings, 'projection-contract-receipt-binding-mismatch', '#/contractIr/admission/receipt', 'Contract IR is not bound to the supplied passed parity receipt');
  }
  const requirements = contractIr.admission?.requirements;
  for (const key of [
    'exactInputDigests',
    'directDeclarationInventory',
    'generatedSchemaComparison',
    'differentialInstanceValidation',
    'zeroUnexplainedFindings',
  ]) {
    if (requirements?.[key] !== true) {
      add(findings, 'projection-contract-admission-requirement-missing', `#/contractIr/admission/requirements/${key}`, 'Contract IR mandatory admission requirement is missing');
    }
  }
  const sourceDigests = {
    typespec: contractIr.provenance?.typespec?.digest,
    generatedJsonSchema: contractIr.provenance?.generatedJsonSchema?.digest,
    authoredJsonSchema: contractIr.provenance?.authoredJsonSchema?.digest,
  };
  const expectedRoles = {
    typespec: 'independently-authored-authority',
    generatedJsonSchema: 'comparison-evidence-only',
    authoredJsonSchema: 'independently-authored-authority',
  };
  for (const lane of SOURCE_LANES) {
    if (!validDigest(sourceDigests[lane])) {
      add(findings, 'projection-contract-source-digest-invalid', `#/contractIr/provenance/${lane}/digest`, 'Contract IR source digest is invalid');
    }
    if (contractIr.provenance?.[lane]?.role !== expectedRoles[lane]) {
      add(findings, 'projection-contract-source-role-invalid', `#/contractIr/provenance/${lane}/role`, 'Contract IR source role is invalid');
    }
    if (parityReceipt?.inputs?.[lane]?.digest !== sourceDigests[lane]) {
      add(findings, 'projection-contract-source-receipt-mismatch', `#/contractIr/provenance/${lane}/digest`, 'Contract IR source digest does not match the parity receipt');
    }
    if (currentSourceClosureValid && expectedSourceDigests[lane] !== sourceDigests[lane]) {
      add(findings, 'projection-contract-current-source-mismatch', `#/expectedSourceDigests/${lane}`, 'checked-out source closure no longer matches the Contract IR');
    }
  }
  const declarationIds = verifyDeclarationDigests(contractIr, findings);
  const scope = contractIr.admission?.scope;
  if (scope?.admittedDeclarations !== declarationIds.length
    || scope?.excludedDeclarations !== (contractIr.excludedDeclarations?.length ?? -1)
    || scope?.outOfScopeDeclarations !== (contractIr.outOfScopeDeclarations?.length ?? -1)) {
    add(findings, 'projection-contract-scope-mismatch', '#/contractIr/admission/scope', 'Contract IR scope counts do not match its declaration arrays');
  }
  const binding = findings.length === 0
    ? Object.freeze({
        contractIrId: contractIr.irId,
        contractIrDigest: digestJson(contractIr),
        receiptRunId: parityReceipt.runId,
        receiptDigest,
        sourceDigests: Object.freeze(sourceDigests),
      })
    : null;
  return Object.freeze({
    binding,
    declarationIds: Object.freeze(declarationIds),
    findings: Object.freeze(findings),
  });
}

export function contractAssertionDigestMap(contractIr) {
  return new Map((contractIr?.declarations ?? []).map((item) => [item.id, item.assertionDigest]));
}
