import { basename, isAbsolute } from 'node:path';
import { canonicalStringify, sha256 } from './canonical.mjs';
import { writeSarifFile } from './sarif-file.mjs';

export const SARIF_VERSION = '2.1.0';
export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
export const SARIF_TOOL_NAME = '@oresoftware/typespec-json-schema-validator';
const REPORT_SCHEMA = 'ores.typespec-json-schema-validator.report/v1';
const REPORT_STATUSES = new Set(['passed', 'stopped_for_evaluation', 'failed']);
const HEX_64 = /^[a-f0-9]{64}$/;

const RULE_DESCRIPTIONS = Object.freeze({
  'mapping-target-collision': 'Multiple TypeSpec declarations map to the same peer declaration.',
  'typespec-ambiguous-simple-name': 'A simple TypeSpec declaration name is ambiguous.',
  'generated-declaration-missing': 'The TypeSpec-generated JSON Schema lane is missing a declaration.',
  'authored-declaration-missing': 'The independently authored JSON Schema lane is missing a declaration.',
  'generated-declaration-extra': 'The generated JSON Schema lane contains an unmatched declaration.',
  'authored-declaration-extra': 'The authored JSON Schema lane contains an unmatched declaration.',
  'generated-authored-declaration-set-mismatch': 'The generated and authored JSON Schema declaration sets differ.',
  'generated-authored-kind-mismatch': 'The generated and authored declaration kind families differ.',
  'generated-authored-semantic-mismatch': 'The generated and authored JSON Schema semantics differ.',
  'instance-verdict-divergence': 'The two authorities return different validation verdicts for one instance.',
  'differential-validation-refused': 'The validator refused to approximate unsupported schema semantics.',
  'declared-example-rejected': 'A declared example or default is rejected by both authorities.',
  'corpus-instance-rejected': 'Both authorities reject an instance marked valid by the independent corpus.',
  'corpus-instance-accepted': 'Both authorities accept an instance marked invalid by the independent corpus.',
  'corpus-declaration-unknown': 'The independent corpus names a declaration missing from an authority.',
  'json-schema-dialect': 'A JSON Schema authority does not declare Draft 2020-12.',
  'json-schema-unresolved-local-ref': 'A local JSON Schema reference does not resolve.',
  'json-schema-required-property-missing': 'A required JSON Schema property is not declared.',
  'json-schema-duplicate-array-item': 'A set-like JSON Schema keyword contains a duplicate item.',
  'json-schema-openapi-nullable-keyword': 'An OpenAPI-only nullable keyword appears in JSON Schema.',
  'json-schema-impossible-range': 'A JSON Schema lower bound exceeds its upper bound.',
  'run-failed': 'The validator could not complete the requested parity run.',
});

function assertReport(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError('validator report must be an object');
  }
  if (report.schema !== REPORT_SCHEMA) {
    throw new TypeError(`validator report must declare schema ${REPORT_SCHEMA}`);
  }
  if (typeof report.runId !== 'string' || !HEX_64.test(report.runId)) {
    throw new TypeError('validator report runId must be a 64-character lowercase hexadecimal digest');
  }
  if (!REPORT_STATUSES.has(report.status)) {
    throw new TypeError('validator report status is not recognized');
  }
  if (!Array.isArray(report.findings)) {
    throw new TypeError('validator report findings must be an array');
  }
}

function staticDescription(ruleId) {
  if (RULE_DESCRIPTIONS[ruleId]) {
    return RULE_DESCRIPTIONS[ruleId];
  }
  if (ruleId.startsWith('typespec-source-')) {
    return 'The TypeSpec source inventory found malformed or unsupported source structure.';
  }
  if (ruleId.startsWith('json-schema-invalid-')) {
    return 'A JSON Schema keyword has an invalid value or shape.';
  }
  if (ruleId.endsWith('-declaration-kind-mismatch')) {
    return 'A declaration kind family differs between peer authorities.';
  }
  return 'The TypeSpec and JSON Schema peer-authority convergence gate reported a finding.';
}

function sarifRuleId(sourceRuleId) {
  return `TSJSV.${sourceRuleId}`;
}

function safeIdentifier(value, fallback = '') {
  if (typeof value !== 'string' || value === '') {
    return fallback;
  }
  const withoutUrls = value.replace(/(?:https?|file):\/\/\S+/giu, '[redacted-uri]');
  const withoutTimestamps = withoutUrls.replace(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})\b/gu,
    '[redacted-time]',
  );
  return withoutTimestamps
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .replace(/\s+/gu, ' ')
    .slice(0, 512);
}

function safeArtifactUri(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  let rendered = value.replaceAll('\\', '/');
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(rendered) || rendered.startsWith('//')) {
    return null;
  }
  if (isAbsolute(rendered) || /^[A-Za-z]:\//u.test(rendered) || rendered.split('/').includes('..')) {
    rendered = basename(rendered);
  }
  rendered = rendered.replace(/^\.\//u, '');
  if (rendered === '' || rendered === '.' || rendered === '/') {
    return null;
  }
  return encodeURI(rendered).replaceAll('#', '%23');
}

function inputPath(report, lane) {
  const input = report.inputs?.[lane]?.input;
  return safeArtifactUri(input);
}

function parseTypeSpecPointer(pointer) {
  if (typeof pointer !== 'string') {
    return null;
  }
  const match = /^(.*):(\d+):(\d+)$/u.exec(pointer);
  if (!match) {
    return null;
  }
  const uri = safeArtifactUri(match[1]);
  if (!uri) {
    return null;
  }
  return {
    uri,
    region: {
      startLine: Number(match[2]),
      startColumn: Number(match[3]),
    },
  };
}

function sourceCandidates(finding, report) {
  const explicit = safeArtifactUri(finding.source);
  if (explicit) {
    return [explicit];
  }

  const parsedTypeSpec = parseTypeSpecPointer(finding.pointer);
  if (parsedTypeSpec) {
    return [parsedTypeSpec.uri];
  }

  const typespec = inputPath(report, 'typespec');
  const generated = inputPath(report, 'generatedJsonSchema');
  const authored = inputPath(report, 'authoredJsonSchema');
  const comparison = finding.comparison ?? '';
  const sources = [];

  if (comparison === 'typespec-generated-vs-authored-json-schema'
    || comparison === 'generated-vs-authored-inventory') {
    for (const source of [authored, generated, typespec]) {
      if (source) sources.push(source);
    }
    return [...new Set(sources)];
  }

  if (comparison.includes('typespec-source') || finding.ruleId?.startsWith('typespec-')) {
    if (typespec) sources.push(typespec);
  }
  if (comparison.includes('authored') || finding.ruleId?.startsWith('authored-')) {
    if (authored) sources.push(authored);
  }
  if (comparison.includes('generated') || finding.ruleId?.startsWith('generated-')) {
    if (generated) sources.push(generated);
  }
  if (comparison === 'declaration-inventory' && sources.length === 0) {
    for (const source of [typespec, generated, authored]) {
      if (source) sources.push(source);
    }
  }
  if (comparison === 'differential-instance-validation') {
    for (const source of [authored, generated]) {
      if (source) sources.push(source);
    }
  }

  return [...new Set(sources)];
}

function primaryLocation(finding, report) {
  const sources = sourceCandidates(finding, report);
  if (sources.length === 0) {
    return null;
  }
  const parsedTypeSpec = parseTypeSpecPointer(finding.pointer);
  const physicalLocation = {
    artifactLocation: { uri: sources[0] },
  };
  if (parsedTypeSpec?.uri === sources[0]) {
    physicalLocation.region = parsedTypeSpec.region;
  }
  const location = { physicalLocation };
  const declaration = safeIdentifier(finding.declaration);
  if (declaration) {
    location.logicalLocations = [{ kind: 'declaration', name: declaration }];
  }
  if (typeof finding.pointer === 'string' && finding.pointer.startsWith('#')) {
    location.properties = { jsonPointer: safeIdentifier(finding.pointer) };
  }
  return location;
}

function relatedLocations(finding, report) {
  return sourceCandidates(finding, report).slice(1).map((uri, index) => ({
    id: index + 1,
    physicalLocation: { artifactLocation: { uri } },
  }));
}

function ruleDescriptor(sourceRuleId) {
  return {
    id: sarifRuleId(sourceRuleId),
    shortDescription: { text: staticDescription(sourceRuleId) },
    fullDescription: {
      text: `${staticDescription(sourceRuleId)} Full values and adjudication evidence remain only in the deterministic JSON receipt.`,
    },
    helpUri: 'https://github.com/ORESoftware/typespec-json-schema-validator/blob/main/docs/rules.md',
    defaultConfiguration: { level: 'error' },
    properties: {
      sourceRuleId,
      tags: ['TypeSpec', 'JSON Schema', 'peer-authority parity'],
    },
  };
}

function findingResult(finding, report) {
  if (finding === null || typeof finding !== 'object' || Array.isArray(finding)) {
    throw new TypeError('validator finding must be an object');
  }
  if (typeof finding.ruleId !== 'string' || finding.ruleId === '') {
    throw new TypeError('validator finding ruleId must be a nonempty string');
  }
  if (typeof finding.fingerprint !== 'string' || !HEX_64.test(finding.fingerprint)) {
    throw new TypeError(`validator finding ${finding.ruleId} has an invalid fingerprint`);
  }

  const description = staticDescription(finding.ruleId);
  const declaration = safeIdentifier(finding.declaration);
  const pointer = typeof finding.pointer === 'string' && finding.pointer.startsWith('#')
    ? safeIdentifier(finding.pointer)
    : '';
  const context = [
    declaration ? `Declaration: ${declaration}.` : '',
    pointer ? `JSON Pointer: ${pointer}.` : '',
  ].filter(Boolean).join(' ');
  const result = {
    ruleId: sarifRuleId(finding.ruleId),
    level: 'error',
    message: { text: context ? `${description} ${context}` : description },
    partialFingerprints: { 'tsjsv/v1': finding.fingerprint },
    properties: {
      sourceRuleId: finding.ruleId,
      comparison: safeIdentifier(finding.comparison, 'unknown'),
      resolutionState: safeIdentifier(finding.resolutionState, 'unexplained'),
      reportRunId: report.runId,
      detailsAvailableInJsonReceipt: true,
    },
  };
  if (declaration) result.properties.declaration = declaration;
  if (pointer) result.properties.jsonPointer = pointer;

  const location = primaryLocation(finding, report);
  if (location) result.locations = [location];
  const related = relatedLocations(finding, report);
  if (related.length > 0) result.relatedLocations = related;
  return result;
}

function failedResult(report) {
  const fingerprint = sha256(`${report.runId}:run-failed`);
  return {
    ruleId: sarifRuleId('run-failed'),
    level: 'error',
    message: {
      text: 'The validator could not complete the parity run. Bounded failure details remain in the deterministic JSON receipt.',
    },
    partialFingerprints: { 'tsjsv/v1': fingerprint },
    properties: {
      sourceRuleId: 'run-failed',
      comparison: 'validator-execution',
      resolutionState: 'failed',
      reportRunId: report.runId,
      detailsAvailableInJsonReceipt: true,
    },
  };
}

function sortedFindings(findings) {
  return [...findings].sort((left, right) => canonicalStringify([
    left?.ruleId ?? '',
    left?.declaration ?? '',
    left?.pointer ?? '',
    left?.fingerprint ?? '',
  ]).localeCompare(canonicalStringify([
    right?.ruleId ?? '',
    right?.declaration ?? '',
    right?.pointer ?? '',
    right?.fingerprint ?? '',
  ])));
}

export function toSarif(report) {
  assertReport(report);
  const findings = sortedFindings(report.findings);
  const sourceRuleIds = new Set(findings.map((finding) => finding.ruleId));
  if (report.status === 'failed') sourceRuleIds.add('run-failed');
  const rules = [...sourceRuleIds].sort().map(ruleDescriptor);
  const results = findings.map((finding) => findingResult(finding, report));
  if (report.status === 'failed' && results.length === 0) {
    results.push(failedResult(report));
  }

  const driver = {
    name: SARIF_TOOL_NAME,
    informationUri: 'https://github.com/ORESoftware/typespec-json-schema-validator',
    rules,
  };
  const version = report.toolchain?.validator?.version;
  if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    driver.semanticVersion = version;
  }

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [{
      tool: { driver },
      invocations: [{
        executionSuccessful: report.status !== 'failed',
        exitCode: report.status === 'passed' ? 0 : report.status === 'stopped_for_evaluation' ? 2 : 3,
      }],
      results,
      properties: {
        reportSchema: report.schema,
        reportRunId: report.runId,
        reportStatus: report.status,
        admissionArtifact: false,
        presentationOnly: true,
        authoritativeReceipt: 'JSON',
      },
    }],
  };
}

export function serializeSarif(report) {
  return `${canonicalStringify(toSarif(report), 2)}\n`;
}

export async function writeSarif(path, report) {
  return writeSarifFile(path, serializeSarif(report));
}
