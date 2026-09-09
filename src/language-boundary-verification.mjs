import { canonicalStringify, sha256 } from './canonical.mjs';

export const LANGUAGE_BOUNDARY_MANIFEST_SCHEMA =
  'ores.typespec-json-schema-validator.language-boundaries/v1';
export const LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA =
  'ores.typespec-json-schema-validator.language-boundary-evidence/v1';
export const LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA =
  'ores.typespec-json-schema-validator.language-boundary-verification/v1';

const REPORT_SCHEMA = 'ores.typespec-json-schema-validator.report/v1';
const CONTRACT_IR_SCHEMA = 'ores.typespec-json-schema-validator.contract-ir/v1';
const HEX_256 = /^[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ARTIFACT_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9+._:@/-]{0,127}$/u;
const UNSAFE_PATH_SEGMENTS = new Set([
  '__proto__', 'constructor', 'prototype', 'toString', 'toLocaleString',
  'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validIdentity(value) {
  return typeof value === 'string'
    && value === value.trim()
    && SAFE_IDENTITY.test(value)
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validEvidencePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  if (!value.endsWith('.json') || value.startsWith('/') || value.startsWith('./')) return false;
  if (value.includes('\\') || value.includes('//') || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment !== ''
    && segment !== '.'
    && segment !== '..'
    && !UNSAFE_PATH_SEGMENTS.has(segment));
}

function ownDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function readEvidence(evidenceByPath, path) {
  if (evidenceByPath instanceof Map) {
    return evidenceByPath.has(path) ? { supplied: true, value: evidenceByPath.get(path) } : { supplied: false, value: undefined };
  }
  if (isObject(evidenceByPath) && Object.hasOwn(evidenceByPath, path)) {
    return { supplied: true, value: evidenceByPath[path] };
  }
  return { supplied: false, value: undefined };
}

function freezeFinding(ruleId, targetIndex = null) {
  return Object.freeze({ ruleId, targetIndex });
}

function validToolIdentity(value) {
  return isObject(value) && validIdentity(value.name) && validIdentity(value.version);
}

function validParityReceipt(report) {
  return isObject(report)
    && report.schema === REPORT_SCHEMA
    && HEX_256.test(report.runId)
    && report.status === 'passed'
    && report.zeroUnexplainedFindings === true
    && ownDenseArray(report.findings)
    && report.findings.length === 0
    && isObject(report.authorities)
    && report.authorities?.typespec?.authority === 'independently-authored'
    && report.authorities?.typespec?.generatedJsonSchemaRole === 'comparison-evidence-only'
    && report.authorities?.jsonSchema?.authority === 'independently-authored'
    && report.authorities?.precedence === 'none'
    && report.coverage?.differentialInstanceValidation === true
    && report.differential?.disabled !== true
    && Number.isSafeInteger(report.differential?.summary?.probesEvaluated)
    && report.differential.summary.probesEvaluated > 0
    && report.differential.summary.divergences === 0
    && report.differential.summary.refusals === 0;
}

function validContractIr(contractIr, report) {
  return isObject(contractIr)
    && contractIr.schema === CONTRACT_IR_SCHEMA
    && HEX_256.test(contractIr.irId)
    && contractIr.status === 'passed'
    && contractIr.admissible === true
    && contractIr.role === 'downstream-derived-parity-artifact'
    && contractIr.editableAuthority === false
    && ownDenseArray(contractIr.declarations)
    && contractIr.declarations.length > 0
    && ownDenseArray(contractIr.excludedDeclarations)
    && contractIr.excludedDeclarations.length === 0
    && ownDenseArray(contractIr.outOfScopeDeclarations)
    && contractIr.outOfScopeDeclarations.length === 0
    && contractIr.admission?.receipt?.runId === report?.runId;
}

function compareFindings(left, right) {
  if (left.targetIndex !== right.targetIndex) {
    return (left.targetIndex ?? -1) - (right.targetIndex ?? -1);
  }
  return left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0;
}

function freezeCounts(counts) {
  return Object.freeze(counts);
}

export function verifyLanguageBoundaries(options = {}) {
  const manifest = options?.manifest;
  const report = options?.report;
  const contractIr = options?.contractIr;
  const evidenceByPath = options?.evidenceByPath;
  const findings = [];
  const add = (ruleId, targetIndex = null) => findings.push(freezeFinding(ruleId, targetIndex));

  if (!validParityReceipt(report)) add('boundary-parity-receipt-not-admissible');
  if (!validContractIr(contractIr, report)) add('boundary-contract-ir-not-admissible');

  const receiptRunId = HEX_256.test(report?.runId ?? '') ? report.runId : null;
  const contractIrId = HEX_256.test(contractIr?.irId ?? '') ? contractIr.irId : null;
  const binding = Object.freeze({ receiptRunId, contractIrId });

  if (!isObject(manifest) || manifest.schema !== LANGUAGE_BOUNDARY_MANIFEST_SCHEMA) {
    add('boundary-manifest-schema-invalid');
  }
  const authorities = manifest?.authorities;
  if (!isObject(authorities)
      || authorities.typeSpec !== 'peer'
      || authorities.jsonSchema !== 'peer'
      || authorities.generatedWitness !== 'evidence_only') {
    add('boundary-authority-roles-invalid');
  }

  const minimum = manifest?.minimumDistinctLanguages;
  if (!Number.isSafeInteger(minimum) || minimum < 2 || minimum > 64) {
    add('boundary-minimum-languages-invalid');
  }

  const targets = ownDenseArray(manifest?.targets) ? [...manifest.targets] : [];
  if (targets.length === 0) add('boundary-targets-invalid');
  targets.sort((left, right) => {
    const a = `${left?.language ?? ''}\u0000${left?.runtime ?? ''}\u0000${left?.evidence ?? ''}`;
    const b = `${right?.language ?? ''}\u0000${right?.runtime ?? ''}\u0000${right?.evidence ?? ''}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const identities = new Set();
  const paths = new Set();
  const requiredLanguages = new Set();
  let requiredTargets = 0;
  let suppliedEvidence = 0;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (!isObject(target)) {
      add('boundary-target-shape-invalid', index);
      continue;
    }
    const identityValid = validIdentity(target.language) && validIdentity(target.runtime);
    if (!identityValid) add('boundary-target-identity-invalid', index);

    const flagsValid = typeof target.required === 'boolean'
      && typeof target.ingress === 'boolean'
      && typeof target.egress === 'boolean';
    if (!flagsValid) add('boundary-target-flags-invalid', index);

    const pathValid = validEvidencePath(target.evidence);
    if (!pathValid) add('boundary-evidence-path-invalid', index);

    if (identityValid) {
      const identity = `${target.language}\u0000${target.runtime}`;
      if (identities.has(identity)) add('boundary-target-duplicate', index);
      identities.add(identity);
    }
    if (pathValid) {
      if (paths.has(target.evidence)) add('boundary-evidence-path-duplicate', index);
      paths.add(target.evidence);
    }

    if (target.required === true) {
      requiredTargets += 1;
      if (identityValid) requiredLanguages.add(target.language);
      if (target.ingress !== true) add('boundary-required-ingress-disabled', index);
      if (target.egress !== true) add('boundary-required-egress-disabled', index);
    }

    if (!pathValid) continue;
    const supplied = readEvidence(evidenceByPath, target.evidence);
    if (!supplied.supplied) {
      if (target.required === true) add('boundary-evidence-missing', index);
      continue;
    }
    suppliedEvidence += 1;
    const evidence = supplied.value;
    if (!isObject(evidence) || evidence.schema !== LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA) {
      add('boundary-evidence-schema-invalid', index);
      continue;
    }
    if (evidence.status !== 'passed') add('boundary-evidence-not-passed', index);
    if (evidence.language !== target.language || evidence.runtime !== target.runtime) {
      add('boundary-evidence-target-mismatch', index);
    }
    if (!SOURCE_REVISION.test(evidence.sourceRevision ?? '')) {
      add('boundary-source-revision-invalid', index);
    }
    if (!ARTIFACT_DIGEST.test(evidence.artifactDigest ?? '')) {
      add('boundary-artifact-digest-invalid', index);
    }
    if (!validToolIdentity(evidence.toolchain)) add('boundary-toolchain-identity-missing', index);
    if (!validToolIdentity(evidence.generator)) add('boundary-generator-identity-missing', index);
    if (target.ingress === true && evidence.validation?.ingress !== 'passed') {
      add('boundary-ingress-not-verified', index);
    }
    if (target.egress === true && evidence.validation?.egress !== 'passed') {
      add('boundary-egress-not-verified', index);
    }
    if (evidence.contractIrId !== contractIr?.irId) {
      add('boundary-evidence-contract-ir-mismatch', index);
    }
    if (evidence.receiptRunId !== report?.runId) {
      add('boundary-evidence-receipt-mismatch', index);
    }
  }

  if (Number.isSafeInteger(minimum) && minimum >= 2 && requiredLanguages.size < minimum) {
    add('boundary-minimum-languages-not-met');
  }

  findings.sort(compareFindings);
  const frozenFindings = Object.freeze(findings);
  const status = frozenFindings.length === 0 ? 'passed' : 'stopped_for_evaluation';
  const counts = freezeCounts({
    targets: targets.length,
    requiredTargets,
    distinctRequiredLanguages: requiredLanguages.size,
    suppliedEvidence,
    findings: frozenFindings.length,
  });
  const body = Object.freeze({
    schema: LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
    status,
    admissible: status === 'passed',
    binding,
    counts,
    findings: frozenFindings,
  });
  return Object.freeze({
    ...body,
    verificationId: `sha256:${sha256(canonicalStringify(body))}`,
  });
}
