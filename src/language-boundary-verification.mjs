import { canonicalStringify, isPlainObject, sha256, stableFindingFingerprint } from './canonical.mjs';
import {
  LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA,
  LANGUAGE_BOUNDARY_MANIFEST_SCHEMA,
  LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
  verifyLanguageBoundaries as verifyLanguageBoundariesCore,
} from './language-boundary-verification-core.mjs';

export {
  LANGUAGE_BOUNDARY_EVIDENCE_SCHEMA,
  LANGUAGE_BOUNDARY_MANIFEST_SCHEMA,
  LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
};

const REVISION_PATTERN = /^[a-f0-9]{40}$/u;

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

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function evidenceLookup(evidenceByPath, path) {
  if (evidenceByPath instanceof Map) {
    return { present: evidenceByPath.has(path), value: evidenceByPath.get(path) };
  }
  if (isPlainObject(evidenceByPath) && Object.hasOwn(evidenceByPath, path)) {
    return { present: true, value: evidenceByPath[path] };
  }
  return { present: false, value: undefined };
}

function sourceRevisionCoherenceFindings(input) {
  const targets = input?.manifest?.targets;
  if (!denseArray(targets)) return [];

  const revisions = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (!isPlainObject(target) || typeof target.evidence !== 'string') continue;
    const lookup = evidenceLookup(input?.evidenceByPath, target.evidence);
    if (!lookup.present || !isPlainObject(lookup.value)) continue;
    const sourceRevision = lookup.value.sourceRevision;
    if (!REVISION_PATTERN.test(sourceRevision ?? '')) continue;
    revisions.push({ index, required: target.required === true, sourceRevision });
  }

  if (revisions.length < 2) return [];
  const baseline = revisions.find((entry) => entry.required) ?? revisions[0];
  return revisions
    .filter((entry) => entry.sourceRevision !== baseline.sourceRevision)
    .map((entry) => makeFinding(
      'boundary-source-revision-mismatch',
      `runtime evidence must describe one immutable source revision across all supplied targets; target ${entry.index} differs from baseline target ${baseline.index}`,
      `#/evidence/${entry.index}/sourceRevision`,
    ));
}

function hardeningFindings(input) {
  const findings = [];
  const report = input?.report;
  const contractIr = input?.contractIr;
  const targets = input?.manifest?.targets;

  if (Array.isArray(targets) && !denseArray(targets)) {
    findings.push(makeFinding(
      'boundary-target-inventory-sparse',
      'language/runtime target inventories must contain an own value at every index',
      '#/manifest/targets',
    ));
  }

  findings.push(...sourceRevisionCoherenceFindings(input));

  if (isPlainObject(report)) {
    if (!denseArray(report.findings) || report.findings.length !== 0) {
      findings.push(makeFinding(
        'boundary-parity-findings-incomplete',
        'a passing parity report must retain an explicit empty findings inventory',
        '#/report/findings',
      ));
    }
    if (report.differential?.disabled !== true) {
      const summary = report.differential?.summary;
      const complete = report.coverage?.differentialInstanceValidation === true
        && isPlainObject(summary)
        && Number.isSafeInteger(summary.probesEvaluated)
        && summary.probesEvaluated > 0
        && Number.isSafeInteger(summary.divergences)
        && summary.divergences >= 0
        && Number.isSafeInteger(summary.refusals)
        && summary.refusals >= 0;
      if (!complete) {
        findings.push(makeFinding(
          'boundary-differential-evidence-incomplete',
          'runtime boundary admission requires executed differential probes with complete summary evidence',
          '#/report/differential/summary',
        ));
      } else if (summary.divergences !== 0 || summary.refusals !== 0) {
        findings.push(makeFinding(
          'boundary-differential-evidence-not-converged',
          'runtime boundary admission requires zero differential divergences and zero refusals',
          '#/report/differential/summary',
        ));
      }
    }
  }

  if (isPlainObject(contractIr)) {
    if (!denseArray(contractIr.declarations) || contractIr.declarations.length === 0) {
      findings.push(makeFinding(
        'boundary-contract-ir-declarations-incomplete',
        'Contract IR must retain a complete nonempty declaration inventory',
        '#/contractIr/declarations',
      ));
    }
    if (!denseArray(contractIr.excludedDeclarations)
      || contractIr.excludedDeclarations.length !== 0
      || !denseArray(contractIr.outOfScopeDeclarations)
      || contractIr.outOfScopeDeclarations.length !== 0) {
      findings.push(makeFinding(
        'boundary-contract-ir-scope-incomplete',
        'excluded or out-of-scope declarations cannot be promoted across runtime boundaries',
        '#/contractIr',
      ));
    }
  }
  return findings;
}

function uniqueSortedFindings(coreFindings, extraFindings) {
  const findingsByIdentity = new Map();
  for (const finding of [...coreFindings, ...extraFindings]) {
    findingsByIdentity.set(`${finding.ruleId}\u0000${finding.pointer}`, finding);
  }
  return Object.freeze([...findingsByIdentity.values()].sort((left, right) => {
    const byRule = left.ruleId.localeCompare(right.ruleId);
    return byRule !== 0 ? byRule : left.pointer.localeCompare(right.pointer);
  }));
}

function isTargetFinding(finding, index) {
  const targetPointer = `#/manifest/targets/${index}`;
  const evidencePointer = `#/evidence/${index}`;
  return finding.pointer === targetPointer
    || finding.pointer.startsWith(`${targetPointer}/`)
    || finding.pointer === evidencePointer
    || finding.pointer.startsWith(`${evidencePointer}/`);
}

function prerequisitesAdmissible(findings) {
  return findings.every((finding) => finding.ruleId === 'boundary-required-language-count-insufficient'
    || finding.pointer.startsWith('#/manifest/targets/')
    || finding.pointer.startsWith('#/evidence/'));
}

function recountAdmittedEvidence(input, findings) {
  const targets = input?.manifest?.targets;
  if (!denseArray(targets) || !prerequisitesAdmissible(findings)) return 0;
  let admitted = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (!isPlainObject(target) || !evidenceLookup(input?.evidenceByPath, target.evidence).present) continue;
    if (!findings.some((finding) => isTargetFinding(finding, index))) admitted += 1;
  }
  return admitted;
}

function finalize(core, input, findings) {
  const binding = Object.freeze({
    parityReceiptRunId: core.binding?.parityReceiptRunId ?? null,
    contractIrId: core.binding?.contractIrId ?? null,
    typeSpecAuthority: 'peer',
    jsonSchemaAuthority: 'peer',
    generatedWitnessRole: 'evidence_only',
  });
  const targets = denseArray(input?.manifest?.targets) ? input.manifest.targets : [];
  const requiredTargets = targets.filter((target) => target?.required === true);
  const counts = Object.freeze({
    targets: targets.length,
    requiredTargets: requiredTargets.length,
    distinctRequiredLanguages: new Set(requiredTargets.map((target) => target?.language)).size,
    admittedEvidence: recountAdmittedEvidence(input, findings),
    findings: findings.length,
  });
  const receipt = Object.freeze({
    schema: LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
    status: findings.length === 0 ? 'passed' : 'stopped_for_evaluation',
    zeroUnexplainedFindings: findings.length === 0,
    binding,
    counts,
    findings,
  });
  return Object.freeze({
    ...receipt,
    verificationId: `sha256:${sha256(canonicalStringify(receipt))}`,
  });
}

export function verifyLanguageBoundaries(input = {}) {
  const core = verifyLanguageBoundariesCore(input);
  const findings = uniqueSortedFindings(core.findings ?? [], hardeningFindings(input));
  return finalize(core, input, findings);
}
