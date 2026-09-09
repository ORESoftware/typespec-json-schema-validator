import { canonicalStringify, isPlainObject, sha256, stableFindingFingerprint } from './canonical.mjs';

export const LANGUAGE_BOUNDARY_MANIFEST_SCHEMA =
  'ores.typespec-json-schema-validator.language-boundaries/v1';
export const LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA =
  'ores.typespec-json-schema-validator.language-boundary-evidence/v1';
export const LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA =
  'ores.typespec-json-schema-validator.language-boundary-verification/v1';

const PARITY_REPORT_SCHEMA = 'ores.typespec-json-schema-validator.report/v1';
const CONTRACT_IR_SCHEMA = 'ores.typespec-json-schema-validator.contract-ir/v1';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_TOKEN_LENGTH = 256;

function makeFinding(ruleId, message, pointer = '#') {
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

function pushFinding(findings, ruleId, message, pointer = '#') {
  findings.push(makeFinding(ruleId, message, pointer));
}

function canonicalToken(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_TOKEN_LENGTH
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function canonicalEvidencePath(value) {
  if (!canonicalToken(value)) return false;
  if (value.startsWith('/') || value.endsWith('/') || value.includes('\\')) return false;
  const segments = value.split('/');
  return segments.length > 0
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function evidenceLookup(evidenceByPath, path) {
  if (evidenceByPath instanceof Map) {
    return { present: evidenceByPath.has(path), inherited: false, value: evidenceByPath.get(path) };
  }
  if (isPlainObject(evidenceByPath)) {
    const own = Object.hasOwn(evidenceByPath, path);
    return {
      present: own,
      inherited: !own && path in evidenceByPath,
      value: own ? evidenceByPath[path] : undefined,
    };
  }
  return { present: false, inherited: false, value: undefined };
}

function validateAuthorityModel(manifest, findings) {
  const authorities = manifest?.authorities;
  if (!isPlainObject(authorities)
    || authorities.typeSpec !== 'peer'
    || authorities.jsonSchema !== 'peer'
    || authorities.generatedWitness !== 'evidence_only') {
    pushFinding(
      findings,
      'boundary-authority-model-invalid',
      'TypeSpec and authored JSON Schema must remain peer authorities and the generated witness must remain evidence only',
      '#/manifest/authorities',
    );
  }
}

function validateParityReport(report, findings) {
  if (!isPlainObject(report)) {
    pushFinding(findings, 'boundary-parity-report-missing', 'a trusted parity report is required', '#/report');
    return null;
  }
  if (report.schema !== PARITY_REPORT_SCHEMA) {
    pushFinding(findings, 'boundary-parity-report-schema-invalid', 'the parity report has an unsupported schema identity', '#/report/schema');
  }
  if (!SHA256_PATTERN.test(report.runId ?? '')) {
    pushFinding(findings, 'boundary-parity-run-id-invalid', 'the parity report runId must be a lowercase SHA-256 digest', '#/report/runId');
  }
  if (report.status !== 'passed' || report.zeroUnexplainedFindings !== true) {
    pushFinding(findings, 'boundary-parity-report-not-passed', 'the parity report must be passed with zero unexplained findings', '#/report/status');
  }
  if (report.differential?.disabled === true) {
    pushFinding(findings, 'boundary-differential-validation-disabled', 'differential validation must remain enabled for runtime boundary admission', '#/report/differential');
  }
  return typeof report.runId === 'string' ? report.runId : null;
}

function validateContractIr(contractIr, expectedRunId, findings) {
  if (!isPlainObject(contractIr)) {
    pushFinding(findings, 'boundary-contract-ir-missing', 'a parity-approved Contract IR is required', '#/contractIr');
    return null;
  }
  if (contractIr.schema !== CONTRACT_IR_SCHEMA) {
    pushFinding(findings, 'boundary-contract-ir-schema-invalid', 'the Contract IR has an unsupported schema identity', '#/contractIr/schema');
  }
  if (!SHA256_PATTERN.test(contractIr.irId ?? '')) {
    pushFinding(findings, 'boundary-contract-ir-id-invalid', 'the Contract IR id must be a lowercase SHA-256 digest', '#/contractIr/irId');
  }
  if (contractIr.status !== 'passed' || contractIr.admissible !== true) {
    pushFinding(findings, 'boundary-contract-ir-not-admissible', 'the Contract IR must be passed and admissible', '#/contractIr/status');
  }
  if (contractIr.role !== 'downstream-derived-parity-artifact' || contractIr.editableAuthority !== false) {
    pushFinding(findings, 'boundary-contract-ir-role-invalid', 'Contract IR must remain non-editable downstream evidence', '#/contractIr/role');
  }
  const authorities = contractIr.authorities;
  if (!isPlainObject(authorities)
    || authorities.typespec !== 'independently-authored'
    || authorities.jsonSchema !== 'independently-authored'
    || authorities.generatedJsonSchema !== 'comparison-evidence-only'
    || authorities.precedence !== 'none') {
    pushFinding(findings, 'boundary-contract-ir-authorities-invalid', 'Contract IR must preserve the independent peer-authority model', '#/contractIr/authorities');
  }
  const receiptRunId = contractIr.admission?.receipt?.runId;
  if (expectedRunId !== null && receiptRunId !== expectedRunId) {
    pushFinding(findings, 'boundary-contract-ir-receipt-mismatch', 'Contract IR is not bound to the supplied parity receipt', '#/contractIr/admission/receipt/runId');
  }
  if (contractIr.admission?.requirements?.differentialInstanceValidation !== true) {
    pushFinding(findings, 'boundary-contract-ir-differential-missing', 'Contract IR admission must require differential instance validation', '#/contractIr/admission/requirements/differentialInstanceValidation');
  }
  return typeof contractIr.irId === 'string' ? contractIr.irId : null;
}

function validateEvidence({ evidence, target, expectedRunId, expectedIrId, findings, pointer }) {
  if (!isPlainObject(evidence)) {
    pushFinding(findings, 'boundary-evidence-schema-invalid', 'runtime boundary evidence must be an object using the supported evidence schema', pointer);
    return false;
  }
  if (evidence.schema !== LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA) {
    pushFinding(findings, 'boundary-evidence-schema-invalid', 'runtime boundary evidence uses an unsupported schema identity', `${pointer}/schema`);
  }
  if (evidence.status !== 'passed') {
    pushFinding(findings, 'boundary-evidence-not-passed', 'runtime boundary evidence must explicitly report passed status', `${pointer}/status`);
  }
  if (evidence.language !== target.language || evidence.runtime !== target.runtime) {
    pushFinding(findings, 'boundary-evidence-target-mismatch', 'runtime evidence does not match the target language and runtime identity', pointer);
  }
  if (!REVISION_PATTERN.test(evidence.sourceRevision ?? '')) {
    pushFinding(findings, 'boundary-source-revision-invalid', 'runtime evidence must bind an immutable 40-character lowercase hexadecimal source revision', `${pointer}/sourceRevision`);
  }
  if (!ARTIFACT_DIGEST_PATTERN.test(evidence.artifactDigest ?? '')) {
    pushFinding(findings, 'boundary-artifact-digest-invalid', 'runtime evidence must bind a canonical lowercase SHA-256 artifact digest', `${pointer}/artifactDigest`);
  }
  for (const [name, value] of [
    ['toolchain', evidence.toolchain],
    ['generator', evidence.generator],
  ]) {
    if (!isPlainObject(value) || !canonicalToken(value.name) || !canonicalToken(value.version)) {
      pushFinding(
        findings,
        name === 'toolchain' ? 'boundary-toolchain-identity-missing' : 'boundary-generator-identity-missing',
        `runtime evidence must bind a nonblank canonical ${name} name and version`,
        `${pointer}/${name}`,
      );
    }
  }
  if (target.ingress === true && evidence.validation?.ingress !== 'passed') {
    pushFinding(findings, 'boundary-ingress-not-verified', 'required ingress validation must explicitly report passed', `${pointer}/validation/ingress`);
  }
  if (target.egress === true && evidence.validation?.egress !== 'passed') {
    pushFinding(findings, 'boundary-egress-not-verified', 'required egress validation must explicitly report passed', `${pointer}/validation/egress`);
  }
  if (evidence.receiptRunId !== expectedRunId) {
    pushFinding(findings, 'boundary-evidence-receipt-mismatch', 'runtime evidence is not bound to the exact supplied parity receipt', `${pointer}/receiptRunId`);
  }
  if (evidence.contractIrId !== expectedIrId) {
    pushFinding(findings, 'boundary-evidence-contract-ir-mismatch', 'runtime evidence is not bound to the exact supplied Contract IR', `${pointer}/contractIrId`);
  }
  return true;
}

function finalize({ findings, manifest, receiptRunId, contractIrId, admittedEvidence }) {
  const sortedFindings = [...findings].sort((left, right) => {
    const byRule = left.ruleId.localeCompare(right.ruleId);
    return byRule !== 0 ? byRule : left.pointer.localeCompare(right.pointer);
  });
  const targets = Array.isArray(manifest?.targets) ? manifest.targets : [];
  const requiredTargets = targets.filter((target) => target?.required === true);
  const distinctRequiredLanguages = new Set(
    requiredTargets.filter((target) => canonicalToken(target?.language)).map((target) => target.language),
  ).size;
  const receipt = {
    schema: LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
    status: sortedFindings.length === 0 ? 'passed' : 'stopped_for_evaluation',
    zeroUnexplainedFindings: sortedFindings.length === 0,
    binding: {
      parityReceiptRunId: SHA256_PATTERN.test(receiptRunId ?? '') ? receiptRunId : null,
      contractIrId: SHA256_PATTERN.test(contractIrId ?? '') ? contractIrId : null,
      typeSpecAuthority: 'peer',
      jsonSchemaAuthority: 'peer',
      generatedWitnessRole: 'evidence_only',
    },
    counts: {
      targets: targets.length,
      requiredTargets: requiredTargets.length,
      distinctRequiredLanguages,
      admittedEvidence,
      findings: sortedFindings.length,
    },
    findings: sortedFindings,
  };
  return Object.freeze({
    ...receipt,
    verificationId: `sha256:${sha256(canonicalStringify(receipt))}`,
  });
}

export function verifyLanguageBoundaries(input = {}) {
  const findings = [];
  const manifest = input?.manifest;
  const evidenceByPath = input?.evidenceByPath;

  if (!isPlainObject(manifest) || manifest.schema !== LANGUAGE_BOUNDARY_MANIFEST_SCHEMA) {
    pushFinding(findings, 'boundary-manifest-schema-invalid', 'the language boundary manifest uses an unsupported schema identity', '#/manifest/schema');
  }
  validateAuthorityModel(manifest, findings);

  const receiptRunId = validateParityReport(input?.report, findings);
  const contractIrId = validateContractIr(input?.contractIr, receiptRunId, findings);

  const minimum = manifest?.minimumDistinctLanguages;
  if (!Number.isSafeInteger(minimum) || minimum < 2) {
    pushFinding(findings, 'boundary-minimum-languages-invalid', 'minimumDistinctLanguages must be an integer of at least two', '#/manifest/minimumDistinctLanguages');
  }

  const targets = Array.isArray(manifest?.targets) ? manifest.targets : [];
  if (targets.length === 0) {
    pushFinding(findings, 'boundary-targets-missing', 'at least one language/runtime target is required', '#/manifest/targets');
  }

  const targetIdentities = new Set();
  const evidencePaths = new Set();
  const requiredLanguages = new Set();
  let admittedEvidence = 0;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const pointer = `#/manifest/targets/${index}`;
    if (!isPlainObject(target)) {
      pushFinding(findings, 'boundary-target-invalid', 'each language boundary target must be an object', pointer);
      continue;
    }
    const identityValid = canonicalToken(target.language) && canonicalToken(target.runtime);
    if (!identityValid) {
      pushFinding(findings, 'boundary-target-identity-invalid', 'target language and runtime identities must be nonblank and canonical', pointer);
    }
    const booleansValid = typeof target.required === 'boolean'
      && typeof target.ingress === 'boolean'
      && typeof target.egress === 'boolean';
    if (!booleansValid) {
      pushFinding(findings, 'boundary-target-flags-invalid', 'required, ingress, and egress target flags must be explicit booleans', pointer);
    }
    if (target.required === true && target.ingress !== true) {
      pushFinding(findings, 'boundary-required-ingress-disabled', 'required targets cannot disable ingress validation', `${pointer}/ingress`);
    }
    if (target.required === true && target.egress !== true) {
      pushFinding(findings, 'boundary-required-egress-disabled', 'required targets cannot disable egress validation', `${pointer}/egress`);
    }
    if (identityValid) {
      const identity = `${target.language}\u0000${target.runtime}`;
      if (targetIdentities.has(identity)) {
        pushFinding(findings, 'boundary-target-duplicate', 'language/runtime target identities must be unique', pointer);
      } else {
        targetIdentities.add(identity);
      }
      if (target.required === true) requiredLanguages.add(target.language);
    }

    const pathValid = canonicalEvidencePath(target.evidence);
    if (!pathValid) {
      pushFinding(findings, 'boundary-evidence-path-invalid', 'evidence paths must be canonical relative POSIX paths without dot segments', `${pointer}/evidence`);
      continue;
    }
    if (evidencePaths.has(target.evidence)) {
      pushFinding(findings, 'boundary-evidence-reused', 'one evidence path cannot satisfy multiple language/runtime targets', `${pointer}/evidence`);
    } else {
      evidencePaths.add(target.evidence);
    }

    const lookup = evidenceLookup(evidenceByPath, target.evidence);
    if (lookup.inherited) {
      pushFinding(findings, 'boundary-evidence-path-invalid', 'prototype-inherited properties cannot satisfy runtime evidence paths', `${pointer}/evidence`);
      continue;
    }
    if (!lookup.present) {
      if (target.required === true) {
        pushFinding(findings, 'boundary-required-evidence-missing', 'required language/runtime evidence is missing', `${pointer}/evidence`);
      }
      continue;
    }
    validateEvidence({
      evidence: lookup.value,
      target,
      expectedRunId: receiptRunId,
      expectedIrId: contractIrId,
      findings,
      pointer: `#/evidence/${index}`,
    });
    admittedEvidence += 1;
  }

  if (Number.isSafeInteger(minimum) && minimum >= 2 && requiredLanguages.size < minimum) {
    pushFinding(
      findings,
      'boundary-required-language-count-insufficient',
      'required targets do not cover the configured minimum number of distinct languages',
      '#/manifest/minimumDistinctLanguages',
    );
  }

  return finalize({ findings, manifest, receiptRunId, contractIrId, admittedEvidence });
}
