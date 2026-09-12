import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalStringify, sha256 } from '../canonical.mjs';
import { verifyContractIr } from '../contract-ir.mjs';
import {
  SchemaEvaluationError,
  SchemaResolutionError,
  SchemaResolver,
  UnsupportedKeywordError,
  validateInstance,
} from '../instance-validator.mjs';
import { writeReportFile } from '../report-file.mjs';

export const LEGAL_ROLLOUT_MANIFEST_SCHEMA = 'ores.legal-rollout.manifest/v1';
export const LEGAL_ROLLOUT_RECEIPT_SCHEMA = 'ores.legal-rollout.receipt/v1';
export const LEGAL_ROLLOUT_DECLARATION = 'LegalRolloutManifest';
export const LEGAL_DRAFT_BANNER =
  'DRAFT TEMPLATE — NOT AN EXECUTED AGREEMENT — NOT LEGAL ADVICE';
export const LEGAL_APPROVED_BANNER = 'APPROVED TEMPLATE — NOT AN EXECUTED AGREEMENT';

const HEX_256 = /^[a-f0-9]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const CLASSIFICATIONS = new Set(['internal', 'external']);
const STATUSES = new Set(['draft', 'approved', 'expired', 'superseded']);
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENTS = 2_000;
const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\blin_api_[A-Za-z0-9]{20,}\b/u,
  /\bsk-[A-Za-z0-9]{32,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
];
const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/u,
  /\b(?:4\d{3}|5[1-5]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/u,
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, limit = 512) {
  const rendered = String(value ?? '');
  return rendered.length <= limit ? rendered : `${rendered.slice(0, limit)}…`;
}

function makeFinding(ruleId, path, message, details = undefined) {
  const body = {
    ruleId,
    severity: 'error',
    resolutionState: 'unexplained',
    comparison: 'legal-rollout-admission',
    path: path || null,
    message: bounded(message),
    ...(details === undefined ? {} : { details }),
  };
  return { ...body, fingerprint: sha256(canonicalStringify(body)) };
}

function sortFindings(findings) {
  return [...findings].sort((left, right) =>
    canonicalStringify([left.ruleId, left.path, left.message, left.fingerprint]).localeCompare(
      canonicalStringify([right.ruleId, right.path, right.message, right.fingerprint]),
    ),
  );
}

function isWithin(root, child) {
  const rendered = relative(root, child);
  return rendered === '' || (!rendered.startsWith(`..${sep}`) && rendered !== '..' && !isAbsolute(rendered));
}

function canonicalRelativePath(value, label) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${label} must be a nonempty repository-relative path`);
  }
  if (value.includes('\\') || value.startsWith('/') || value.endsWith('/') || value.includes('//')) {
    throw new Error(`${label} must use canonical forward-slash repository-relative syntax`);
  }
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${label} contains an unsafe path segment`);
  }
  return value;
}

async function rejectSymlinkComponents(root, target, label) {
  if (!isWithin(root, target)) {
    throw new Error(`${label} escapes the project root`);
  }
  const rendered = relative(root, target);
  if (rendered === '') return;
  let current = root;
  for (const part of rendered.split(sep)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error(`${label} traverses a symbolic link`);
    }
  }
}

async function readOwnedFile(path, label, maxBytes) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symbolic-link file`);
  }
  if (info.nlink !== 1) {
    throw new Error(`${label} must not have multiple hard links`);
  }
  if (info.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  }
  return { bytes: await readFile(path), size: info.size };
}

class StrictJsonScanner {
  constructor(source, label) {
    this.source = source;
    this.label = label;
    this.index = 0;
  }

  fail(message) {
    throw new Error(`${this.label}: ${message} at byte ${this.index}`);
  }

  whitespace() {
    while (/\s/u.test(this.source[this.index] ?? '')) this.index += 1;
  }

  string() {
    if (this.source[this.index] !== '"') this.fail('expected JSON string');
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index));
      }
      if (character === '\\') {
        this.index += 1;
        const escape = this.source[this.index];
        if (!'"\\/bfnrtu'.includes(escape ?? '')) this.fail('invalid JSON string escape');
        if (escape === 'u') {
          const digits = this.source.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) this.fail('invalid JSON unicode escape');
          this.index += 4;
        }
        this.index += 1;
        continue;
      }
      if (character.codePointAt(0) < 0x20) this.fail('unescaped control character in JSON string');
      this.index += 1;
    }
    this.fail('unterminated JSON string');
  }

  number() {
    const expression = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;
    expression.lastIndex = this.index;
    const match = expression.exec(this.source);
    if (!match) this.fail('invalid JSON number');
    this.index = expression.lastIndex;
  }

  literal(value) {
    if (!this.source.startsWith(value, this.index)) this.fail(`expected ${value}`);
    this.index += value.length;
  }

  array(depth) {
    this.index += 1;
    this.whitespace();
    if (this.source[this.index] === ']') {
      this.index += 1;
      return;
    }
    while (true) {
      this.value(depth + 1);
      this.whitespace();
      if (this.source[this.index] === ']') {
        this.index += 1;
        return;
      }
      if (this.source[this.index] !== ',') this.fail('expected comma or closing bracket');
      this.index += 1;
      this.whitespace();
    }
  }

  object(depth) {
    this.index += 1;
    this.whitespace();
    const keys = new Set();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return;
    }
    while (true) {
      const key = this.string();
      if (keys.has(key)) this.fail(`duplicate JSON object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.whitespace();
      if (this.source[this.index] !== ':') this.fail('expected colon after object key');
      this.index += 1;
      this.whitespace();
      this.value(depth + 1);
      this.whitespace();
      if (this.source[this.index] === '}') {
        this.index += 1;
        return;
      }
      if (this.source[this.index] !== ',') this.fail('expected comma or closing brace');
      this.index += 1;
      this.whitespace();
    }
  }

  value(depth) {
    if (depth > 128) this.fail('JSON nesting limit exceeded');
    this.whitespace();
    const character = this.source[this.index];
    if (character === '{') return this.object(depth);
    if (character === '[') return this.array(depth);
    if (character === '"') return this.string();
    if (character === 't') return this.literal('true');
    if (character === 'f') return this.literal('false');
    if (character === 'n') return this.literal('null');
    if (character === '-' || /\d/u.test(character ?? '')) return this.number();
    this.fail('unexpected JSON token');
  }

  complete() {
    this.value(0);
    this.whitespace();
    if (this.index !== this.source.length) this.fail('trailing content after JSON value');
  }
}

export function parseStrictJson(source, label = 'JSON input') {
  if (typeof source !== 'string') throw new TypeError(`${label} must be UTF-8 text`);
  new StrictJsonScanner(source, label).complete();
  return JSON.parse(source);
}

async function readJsonArtifact(path, label, projectRoot) {
  const absolute = resolve(path);
  await rejectSymlinkComponents(projectRoot, absolute, label);
  const { bytes, size } = await readOwnedFile(absolute, label, MAX_JSON_BYTES);
  const text = UTF8.decode(bytes);
  return {
    absolute,
    relativePath: relative(projectRoot, absolute).replaceAll('\\', '/'),
    digest: sha256(bytes),
    size,
    value: parseStrictJson(text, label),
  };
}

function schemaLane(contractIr, laneName, declarationName) {
  const resolver = new SchemaResolver();
  const byName = new Map();
  for (const declaration of contractIr.declarations ?? []) {
    const lane = declaration?.lanes?.[laneName];
    if (!isObject(lane) || !isObject(lane.normalizedSchema) || typeof lane.name !== 'string') continue;
    const schema = structuredClone(lane.normalizedSchema);
    if (typeof schema.$id !== 'string' || schema.$id === '') schema.$id = lane.name;
    const record = resolver.addDocument(schema, `${lane.name}.schema.json`);
    const target = { schema, base: record.base, declaration };
    byName.set(declaration.id, target);
    byName.set(lane.name, target);
    for (const name of Object.values(declaration.names ?? {})) {
      if (typeof name === 'string') byName.set(name, target);
    }
  }
  const target = byName.get(declarationName);
  if (!target) throw new Error(`Contract IR does not admit declaration ${declarationName}`);
  return { resolver, ...target };
}

function summarizeSchemaErrors(errors) {
  return errors.slice(0, 16).map((error) => ({
    keyword: bounded(error.keyword, 80),
    instancePath: bounded(error.instancePath || '#', 256),
    schemaPointer: bounded(error.schemaPointer || '#', 256),
    message: bounded(error.message, 256),
  }));
}

export function validateLegalManifestLanes(contractIr, manifest, declarationName = LEGAL_ROLLOUT_DECLARATION) {
  const findings = [];
  const verdicts = {};
  for (const [label, laneName] of [
    ['typespec-generated-json-schema', 'typespecGeneratedJsonSchema'],
    ['authored-json-schema', 'authoredJsonSchema'],
  ]) {
    try {
      const lane = schemaLane(contractIr, laneName, declarationName);
      const result = validateInstance({
        schema: lane.schema,
        instance: manifest,
        resolver: lane.resolver,
        base: lane.base,
        maxErrors: 32,
      });
      verdicts[label] = result.valid;
      if (!result.valid) {
        findings.push(makeFinding(
          'legal-manifest-schema-invalid',
          'manifest',
          `legal manifest is rejected by the ${label} lane`,
          { lane: label, errors: summarizeSchemaErrors(result.errors) },
        ));
      }
    } catch (error) {
      verdicts[label] = null;
      const refusal = error instanceof UnsupportedKeywordError || error instanceof SchemaResolutionError || error instanceof SchemaEvaluationError;
      findings.push(makeFinding(
        refusal ? 'legal-manifest-validation-refused' : 'legal-manifest-validation-failed',
        'manifest',
        `${label} validation ${refusal ? 'was refused' : 'failed'}: ${bounded(error.message)}`,
        { lane: label, errorName: bounded(error.name, 80) },
      ));
    }
  }
  if (
    Object.hasOwn(verdicts, 'typespec-generated-json-schema')
    && Object.hasOwn(verdicts, 'authored-json-schema')
    && verdicts['typespec-generated-json-schema'] !== verdicts['authored-json-schema']
  ) {
    findings.push(makeFinding(
      'legal-manifest-lane-divergence',
      'manifest',
      'the two peer-authority schema lanes disagree on the legal manifest instance',
      { verdicts },
    ));
  }
  return { verdicts, findings: sortFindings(findings) };
}

async function collectMarkdown(directory, projectRoot, classification, findings, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    findings.push(makeFinding(
      'legal-classification-directory-missing',
      relative(projectRoot, directory).replaceAll('\\', '/'),
      `cannot read ${classification} legal directory: ${bounded(error.message)}`,
    ));
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(directory, entry.name);
    const path = relative(projectRoot, absolute).replaceAll('\\', '/');
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      findings.push(makeFinding('legal-tree-symbolic-link', path, 'legal trees must not contain symbolic links'));
      continue;
    }
    if (info.isDirectory()) {
      await collectMarkdown(absolute, projectRoot, classification, findings, files);
    } else if (info.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name !== 'README.md') {
      files.push({ absolute, path, classification });
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function inspectDocumentText(text, document, path, release) {
  const findings = [];
  const classification = document.classification;
  const classificationPattern = new RegExp(
    `\\*\\*Classification:\\*\\*\\s*${escapeRegExp(classification)}`,
    'iu',
  );
  if (!classificationPattern.test(text)) {
    findings.push(makeFinding(
      'legal-document-classification-marker',
      path,
      `document does not declare ${classification} classification in its Markdown body`,
    ));
  }
  if (!/\[[A-Z][A-Z0-9 /_—-]{1,120}\]/u.test(text)) {
    findings.push(makeFinding(
      'legal-document-placeholder',
      path,
      'document must retain at least one square-bracket template placeholder',
    ));
  }
  if (!/initials[^\n]{0,120}_{4,}/iu.test(text)) {
    findings.push(makeFinding('legal-document-initials', path, 'document is missing a blank signer initials field'));
  }
  if (!/^By:\s*_{8,}[^\n]*Date:\s*_{8,}/imu.test(text)) {
    findings.push(makeFinding('legal-document-signature', path, 'document is missing a blank By and Date signature line'));
  }
  if (!/^Name:\s*(?:\[[^\]\r\n]+\]|_{4,})/imu.test(text)) {
    findings.push(makeFinding('legal-document-signer-name', path, 'document is missing a signer name field'));
  }
  if (!/^(?:Title(?:\/(?:Capacity|Role|Professional capacity))?|Role|Capacity):\s*(?:\[[^\]\r\n]+\]|_{4,})/imu.test(text)) {
    findings.push(makeFinding('legal-document-signer-capacity', path, 'document is missing a signer title, role, or capacity field'));
  }
  if (!/(?:Executed|Completed)-copy location:[^\n]*NEVER GIT/iu.test(text)) {
    findings.push(makeFinding(
      'legal-document-records-destination',
      path,
      'document must name an approved executed/completed-copy location outside Git',
    ));
  }
  if (/^\s*(?:Signature|Signed)\s*:\s*(?![_\s[]|$)\S/imu.test(text)) {
    findings.push(makeFinding('legal-document-appears-executed', path, 'document contains a filled signature field'));
  }
  if (/^By:\s*(?!_{8,})\S+/imu.test(text)) {
    findings.push(makeFinding('legal-document-appears-executed', path, 'document contains a filled By field'));
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    findings.push(makeFinding('legal-document-secret-shaped-data', path, 'document contains credential-shaped material'));
  }
  if (PII_PATTERNS.some((pattern) => pattern.test(text))) {
    findings.push(makeFinding('legal-document-sensitive-identifier', path, 'document contains sensitive identifier-shaped material'));
  }

  if (document.status === 'draft' && !text.includes(LEGAL_DRAFT_BANNER)) {
    findings.push(makeFinding('legal-document-draft-banner', path, 'draft document is missing the required draft banner'));
  }
  if (document.status === 'approved') {
    if (text.includes(LEGAL_DRAFT_BANNER)) {
      findings.push(makeFinding('legal-document-approved-still-draft', path, 'approved document still carries the draft banner'));
    }
    if (!text.includes(LEGAL_APPROVED_BANNER)) {
      findings.push(makeFinding('legal-document-approved-banner', path, 'approved document is missing the approved-template banner'));
    }
  }
  if (release && document.required && document.status !== 'approved') {
    findings.push(makeFinding(
      'legal-document-release-status',
      path,
      `required release document has non-approved status ${JSON.stringify(document.status)}`,
    ));
  }
  return findings;
}

export async function auditLegalRollout({
  manifest,
  projectRoot = '.',
  legalRoot = 'docs/legal',
  release = false,
  minExternal = 5,
  minInternal = 3,
}) {
  const findings = [];
  const evidence = [];
  const root = resolve(projectRoot);
  const legalRootPath = canonicalRelativePath(legalRoot, 'legal root');
  const legalAbsolute = resolve(root, legalRootPath);
  if (!isWithin(root, legalAbsolute)) throw new Error('legal root escapes the project root');

  if (!isObject(manifest)) {
    return {
      findings: [makeFinding('legal-manifest-object', 'manifest', 'legal manifest must be a JSON object')],
      evidence,
      coverage: { external: 0, internal: 0, documents: 0, completeInventory: false },
    };
  }
  if (manifest.schema !== LEGAL_ROLLOUT_MANIFEST_SCHEMA) {
    findings.push(makeFinding(
      'legal-manifest-schema-id',
      'manifest',
      `manifest schema must be ${LEGAL_ROLLOUT_MANIFEST_SCHEMA}`,
    ));
  }
  if (typeof manifest.repository !== 'string' || !REPOSITORY.test(manifest.repository)) {
    findings.push(makeFinding('legal-manifest-repository', 'manifest', 'repository must use owner/name syntax'));
  }
  if (manifest.legalRoot !== legalRootPath) {
    findings.push(makeFinding(
      'legal-manifest-root-mismatch',
      'manifest',
      `manifest legalRoot must equal ${legalRootPath}`,
    ));
  }
  if (typeof manifest.releaseApproved !== 'boolean') {
    findings.push(makeFinding('legal-manifest-release-flag', 'manifest', 'releaseApproved must be boolean'));
  }
  if (!Array.isArray(manifest.documents)) {
    findings.push(makeFinding('legal-manifest-documents', 'manifest', 'documents must be an array'));
    return {
      findings: sortFindings(findings),
      evidence,
      coverage: { external: 0, internal: 0, documents: 0, completeInventory: false },
    };
  }
  if (manifest.documents.length > MAX_DOCUMENTS) {
    findings.push(makeFinding(
      'legal-manifest-document-limit',
      'manifest',
      `documents exceeds the ${MAX_DOCUMENTS}-entry limit`,
    ));
  }

  const ids = new Set();
  const paths = new Set();
  const agreementTypes = { internal: new Set(), external: new Set() };
  const counts = { internal: 0, external: 0 };
  const normalizedDocuments = [];

  for (const [index, document] of manifest.documents.slice(0, MAX_DOCUMENTS).entries()) {
    const location = `manifest#/documents/${index}`;
    if (!isObject(document)) {
      findings.push(makeFinding('legal-manifest-document-object', location, 'document entry must be an object'));
      continue;
    }
    if (typeof document.id !== 'string' || document.id.trim() === '') {
      findings.push(makeFinding('legal-manifest-document-id', location, 'document id must be nonempty'));
    } else if (ids.has(document.id)) {
      findings.push(makeFinding('legal-manifest-document-id-duplicate', location, `duplicate document id ${document.id}`));
    } else {
      ids.add(document.id);
    }
    if (!CLASSIFICATIONS.has(document.classification)) {
      findings.push(makeFinding('legal-manifest-classification', location, 'classification must be internal or external'));
      continue;
    }
    counts[document.classification] += 1;
    if (typeof document.agreementType !== 'string' || document.agreementType.trim() === '') {
      findings.push(makeFinding('legal-manifest-agreement-type', location, 'agreementType must be nonempty'));
    } else {
      agreementTypes[document.classification].add(document.agreementType);
    }
    if (!STATUSES.has(document.status)) {
      findings.push(makeFinding('legal-manifest-document-status', location, 'document status is unsupported'));
    }
    if (typeof document.required !== 'boolean') {
      findings.push(makeFinding('legal-manifest-required', location, 'required must be boolean'));
    }
    if (typeof document.sha256 !== 'string' || !HEX_256.test(document.sha256)) {
      findings.push(makeFinding('legal-manifest-document-digest', location, 'sha256 must be 64 lowercase hexadecimal characters'));
    }
    if (document.status === 'approved') {
      if (typeof document.effectiveDate !== 'string' || document.effectiveDate.trim() === '') {
        findings.push(makeFinding('legal-manifest-effective-date', location, 'approved document needs an effectiveDate'));
      }
      if (typeof document.approvalRecord !== 'string' || document.approvalRecord.trim() === '') {
        findings.push(makeFinding('legal-manifest-approval-record', location, 'approved document needs an approvalRecord'));
      }
    }

    let path;
    try {
      path = canonicalRelativePath(document.path, `${location}/path`);
    } catch (error) {
      findings.push(makeFinding('legal-manifest-document-path', location, error.message));
      continue;
    }
    if (paths.has(path)) {
      findings.push(makeFinding('legal-manifest-document-path-duplicate', path, 'document path appears more than once'));
      continue;
    }
    paths.add(path);
    const expectedPrefix = `${legalRootPath}/${document.classification}/`;
    if (!path.startsWith(expectedPrefix) || !path.toLowerCase().endsWith('.md')) {
      findings.push(makeFinding(
        'legal-manifest-document-boundary',
        path,
        `document must be Markdown below ${expectedPrefix}`,
      ));
      continue;
    }
    normalizedDocuments.push({ ...document, path });
  }

  if (agreementTypes.external.size < minExternal) {
    findings.push(makeFinding(
      'legal-rollout-external-coverage',
      'manifest',
      `expected at least ${minExternal} distinct external agreement types; found ${agreementTypes.external.size}`,
    ));
  }
  if (agreementTypes.internal.size < minInternal) {
    findings.push(makeFinding(
      'legal-rollout-internal-coverage',
      'manifest',
      `expected at least ${minInternal} distinct internal agreement types; found ${agreementTypes.internal.size}`,
    ));
  }
  if (release && manifest.releaseApproved !== true) {
    findings.push(makeFinding('legal-rollout-release-not-approved', 'manifest', 'release mode requires releaseApproved=true'));
  }
  if (manifest.releaseApproved === true) {
    for (const document of normalizedDocuments.filter((item) => item.required)) {
      if (document.status !== 'approved') {
        findings.push(makeFinding(
          'legal-rollout-inconsistent-approval',
          document.path,
          'manifest claims release approval while a required document is not approved',
        ));
      }
    }
  }

  const actualFiles = [];
  for (const classification of ['external', 'internal']) {
    await collectMarkdown(
      resolve(legalAbsolute, classification),
      root,
      classification,
      findings,
      actualFiles,
    );
  }
  const actualPaths = new Set(actualFiles.map((item) => item.path));
  for (const path of [...actualPaths].sort()) {
    if (!paths.has(path)) {
      findings.push(makeFinding('legal-rollout-unmanifested-document', path, 'legal Markdown file is absent from the manifest'));
    }
  }
  for (const path of [...paths].sort()) {
    if (!actualPaths.has(path)) {
      findings.push(makeFinding('legal-rollout-missing-document', path, 'manifested legal Markdown file does not exist'));
    }
  }

  for (const document of normalizedDocuments.sort((left, right) => left.path.localeCompare(right.path))) {
    const absolute = resolve(root, document.path);
    if (!actualPaths.has(document.path)) continue;
    try {
      await rejectSymlinkComponents(root, absolute, document.path);
      const { bytes, size } = await readOwnedFile(absolute, document.path, MAX_DOCUMENT_BYTES);
      const digest = sha256(bytes);
      if (digest !== document.sha256) {
        findings.push(makeFinding(
          'legal-document-digest-mismatch',
          document.path,
          'document bytes do not match the manifest SHA-256',
          { expected: document.sha256, actual: digest },
        ));
      }
      const text = UTF8.decode(bytes);
      findings.push(...inspectDocumentText(text, document, document.path, release));
      evidence.push({
        id: document.id,
        path: document.path,
        classification: document.classification,
        agreementType: document.agreementType,
        status: document.status,
        required: document.required,
        sha256: digest,
        bytes: size,
      });
    } catch (error) {
      findings.push(makeFinding('legal-document-read-failed', document.path, bounded(error.message)));
    }
  }

  const sortedFindings = sortFindings(findings);
  return {
    findings: sortedFindings,
    evidence: evidence.sort((left, right) => left.path.localeCompare(right.path)),
    coverage: {
      documents: normalizedDocuments.length,
      external: counts.external,
      internal: counts.internal,
      externalAgreementTypes: agreementTypes.external.size,
      internalAgreementTypes: agreementTypes.internal.size,
      actualMarkdownDocuments: actualPaths.size,
      completeInventory: [...actualPaths].every((path) => paths.has(path))
        && [...paths].every((path) => actualPaths.has(path)),
    },
  };
}

function verificationEvidence(verification) {
  return {
    status: verification?.status ?? 'failed',
    admissible: verification?.admissible === true,
    suppliedIrId: verification?.suppliedIrId ?? null,
    computedIrId: verification?.computedIrId ?? null,
    expectedIrId: verification?.expectedIrId ?? null,
    receiptRunId: verification?.receiptRunId ?? null,
  };
}

function buildReceipt({ status, findings, inputs, coverage, configuration, admission, error = null }) {
  const body = {
    schema: LEGAL_ROLLOUT_RECEIPT_SCHEMA,
    status,
    zeroUnexplainedFindings: status === 'passed' && findings.length === 0,
    findings: sortFindings(findings),
    role: 'legal-rollout-admission-evidence',
    editableAuthority: false,
    configuration,
    admission,
    inputs,
    coverage,
    ...(error === null ? {} : { error }),
  };
  return { ...body, runId: sha256(canonicalStringify(body)) };
}

export async function runLegalRollout(options) {
  const root = resolve(options.projectRoot ?? '.');
  const configuration = {
    declaration: options.declaration ?? LEGAL_ROLLOUT_DECLARATION,
    legalRoot: options.legalRoot ?? 'docs/legal',
    release: options.release === true,
    minExternal: options.minExternal ?? 5,
    minInternal: options.minInternal ?? 3,
  };
  try {
    const [manifestArtifact, parityArtifact, contractIrArtifact] = await Promise.all([
      readJsonArtifact(options.manifest, 'legal manifest', root),
      readJsonArtifact(options.parityReport, 'parity report', root),
      readJsonArtifact(options.contractIr, 'Contract IR', root),
    ]);
    const verification = await verifyContractIr({
      contractIr: contractIrArtifact.value,
      report: parityArtifact.value,
      typespec: options.typespec,
      generatedSchema: options.generatedSchema,
      authoredSchema: options.authoredSchema,
    });
    const findings = [];
    if (verification.status !== 'passed' || verification.admissible !== true) {
      findings.push(makeFinding(
        'legal-rollout-contract-ir-not-admissible',
        contractIrArtifact.relativePath,
        'Contract IR failed exact-input verification and cannot admit legal rollout evidence',
        verificationEvidence(verification),
      ));
    }
    const laneValidation = validateLegalManifestLanes(
      contractIrArtifact.value,
      manifestArtifact.value,
      configuration.declaration,
    );
    findings.push(...laneValidation.findings);
    const audit = await auditLegalRollout({
      manifest: manifestArtifact.value,
      projectRoot: root,
      legalRoot: configuration.legalRoot,
      release: configuration.release,
      minExternal: configuration.minExternal,
      minInternal: configuration.minInternal,
    });
    findings.push(...audit.findings);
    const sorted = sortFindings(findings);
    return buildReceipt({
      status: sorted.length === 0 ? 'passed' : 'stopped_for_evaluation',
      findings: sorted,
      configuration,
      admission: {
        contractIr: verificationEvidence(verification),
        manifestLaneVerdicts: laneValidation.verdicts,
      },
      inputs: {
        manifest: {
          path: manifestArtifact.relativePath,
          sha256: manifestArtifact.digest,
          bytes: manifestArtifact.size,
        },
        parityReport: {
          path: parityArtifact.relativePath,
          sha256: parityArtifact.digest,
          runId: parityArtifact.value?.runId ?? null,
        },
        contractIr: {
          path: contractIrArtifact.relativePath,
          sha256: contractIrArtifact.digest,
          irId: contractIrArtifact.value?.irId ?? null,
        },
        documents: audit.evidence,
      },
      coverage: audit.coverage,
    });
  } catch (error) {
    const message = bounded(String(error?.message ?? error).replaceAll(root, '.'));
    return buildReceipt({
      status: 'failed',
      findings: [makeFinding('legal-rollout-execution-failed', null, message, {
        errorName: bounded(error?.name ?? 'Error', 80),
      })],
      configuration,
      admission: {
        contractIr: {
          status: 'failed',
          admissible: false,
          suppliedIrId: null,
          computedIrId: null,
          expectedIrId: null,
          receiptRunId: null,
        },
        manifestLaneVerdicts: {},
      },
      inputs: { manifest: null, parityReport: null, contractIr: null, documents: [] },
      coverage: {
        documents: 0,
        external: 0,
        internal: 0,
        externalAgreementTypes: 0,
        internalAgreementTypes: 0,
        actualMarkdownDocuments: 0,
        completeInventory: false,
      },
      error: { name: bounded(error?.name ?? 'Error', 80), message },
    });
  }
}

export async function writeLegalRolloutReceipt(path, receipt) {
  const serialized = `${canonicalStringify(receipt, 2)}\n`;
  return writeReportFile(path, serialized, LEGAL_ROLLOUT_RECEIPT_SCHEMA);
}

export function renderLegalRolloutSummary(receipt) {
  const counts = receipt.coverage ?? {};
  const lines = [
    `legal rollout: ${receipt.status}`,
    `documents: ${counts.documents ?? 0} (${counts.external ?? 0} external, ${counts.internal ?? 0} internal)`,
    `findings: ${receipt.findings?.length ?? 0}`,
  ];
  for (const finding of (receipt.findings ?? []).slice(0, 20)) {
    lines.push(`- ${finding.ruleId}${finding.path ? ` [${finding.path}]` : ''}: ${finding.message}`);
  }
  if ((receipt.findings?.length ?? 0) > 20) lines.push('- additional findings omitted from human summary');
  return `${lines.join('\n')}\n`;
}
