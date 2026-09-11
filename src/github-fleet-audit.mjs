const SHA40 = /^[0-9a-f]{40}$/i;
const ORG_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const RECEIPT_SCHEMA = 'ores.typespec-json-schema-validator.github-fleet-audit/v1';
const DEFAULT_FILE_LIMIT = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_FLOOR = 100;

const NON_AUTHORITY_SEGMENTS = new Set([
  'build', 'coverage', 'dist', 'generated', 'node_modules', 'target', 'tmp', 'vendor',
]);

const GENERATED_EVIDENCE_SEGMENTS = new Set([
  'build', 'coverage', 'dist', 'generated', 'target', 'tmp',
]);

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function canonicalString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function validateFleetScope(document) {
  const value = assertObject(document, 'fleet scope');
  if (value.schema !== 'tjsv-github-fleet-scope/v1') {
    throw new Error('fleet scope schema must be tjsv-github-fleet-scope/v1');
  }
  if (!Array.isArray(value.organizations) || value.organizations.length === 0) {
    throw new Error('fleet scope organizations must be a non-empty array');
  }
  const organizations = uniqueSorted(value.organizations.map((entry, index) => {
    const organization = canonicalString(entry, `organization ${index}`);
    if (!ORG_NAME.test(organization)) throw new Error(`invalid GitHub organization: ${organization}`);
    return organization;
  }));
  if (organizations.length !== value.organizations.length) {
    throw new Error('fleet scope organizations must be unique');
  }

  const minimumOrganizations = positiveInteger(value.minimumOrganizations, 'minimumOrganizations');
  const minimumRepositories = positiveInteger(value.minimumRepositories, 'minimumRepositories');
  if (minimumOrganizations > organizations.length) {
    throw new Error('minimumOrganizations cannot exceed configured organizations');
  }

  const excludedRepositories = uniqueSorted((value.excludedRepositories ?? []).map((entry, index) => {
    const repository = canonicalString(entry, `excluded repository ${index}`);
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
      throw new Error(`invalid excluded repository: ${repository}`);
    }
    return repository;
  }));

  return Object.freeze({
    schema: value.schema,
    organizations,
    minimumOrganizations,
    minimumRepositories,
    includeArchived: value.includeArchived === true,
    excludedRepositories,
  });
}

export function validateAdmittedRevision(value) {
  const revision = canonicalString(value, 'admitted TJSV revision').toLowerCase();
  if (!SHA40.test(revision)) {
    throw new Error('admitted TJSV revision must be a full 40-character Git SHA');
  }
  return revision;
}

function sourcePathSegments(path) {
  return path.toLowerCase().split('/').filter(Boolean);
}

export function classifyRepositoryTree(paths) {
  const normalized = uniqueSorted((paths ?? [])
    .filter((path) => typeof path === 'string' && path !== '')
    .map((path) => path.replaceAll('\\', '/')));

  const authoredCandidates = normalized.filter((path) => {
    const segments = sourcePathSegments(path);
    return !segments.some((segment) => NON_AUTHORITY_SEGMENTS.has(segment));
  });

  const typeSpecFiles = authoredCandidates.filter((path) => path.toLowerCase().endsWith('.tsp'));
  const authoredJsonSchemaFiles = authoredCandidates.filter((path) => {
    const lower = path.toLowerCase();
    return lower.endsWith('.schema.json')
      && !lower.includes('contract-ir')
      && !lower.includes('receipt')
      && !lower.includes('report');
  });
  const generatedJsonSchemaFiles = normalized.filter((path) => {
    if (!path.toLowerCase().endsWith('.json')) return false;
    const segments = sourcePathSegments(path);
    return segments.some((segment) => GENERATED_EVIDENCE_SEGMENTS.has(segment));
  });

  return {
    typeSpecFiles,
    authoredJsonSchemaFiles,
    generatedJsonSchemaFiles,
    hasPeerAuthorityCandidates: typeSpecFiles.length > 0 && authoredJsonSchemaFiles.length > 0,
  };
}

function finding(rule, severity, path, message, evidence = {}) {
  return { rule, severity, path, message, evidence };
}

function actionRefs(text) {
  const matches = [];
  const regex = /uses\s*:\s*ORESoftware\/typespec-json-schema-validator@([^\s#'"}]+)/gi;
  for (const match of text.matchAll(regex)) matches.push(match[1]);
  return matches;
}

function checkoutRefs(text) {
  const lines = text.split(/\r?\n/);
  const refs = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/repository\s*:\s*ORESoftware\/typespec-json-schema-validator\s*$/i.test(lines[index].trim())) {
      continue;
    }
    for (let offset = 1; offset <= 12 && index + offset < lines.length; offset += 1) {
      const trimmed = lines[index + offset].trim();
      const match = /^ref\s*:\s*([^\s#'"}]+)/i.exec(trimmed);
      if (match) {
        refs.push(match[1]);
        break;
      }
      if (/^-\s+name\s*:|^-\s+uses\s*:/i.test(trimmed)) break;
    }
  }
  return refs;
}

function dependencyRefs(text) {
  const refs = [];
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    return refs;
  }
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = document?.[section];
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
    const value = dependencies['@oresoftware/typespec-json-schema-validator'];
    if (typeof value === 'string') refs.push({ section, value });
  }
  return refs;
}

function sourceLockRevision(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  const candidates = [
    document?.tjsv?.revision,
    document?.tjsv?.sha,
    document?.tools?.tjsv?.revision,
    document?.tools?.tjsv?.sha,
    document?.sources?.tjsv?.revision,
    document?.sources?.tjsv?.sha,
    document?.sources?.['typespec-json-schema-validator']?.revision,
    document?.sources?.['typespec-json-schema-validator']?.sha,
  ];
  return candidates.find((candidate) => typeof candidate === 'string') ?? null;
}

function workflowPlatforms(text) {
  const lower = text.toLowerCase();
  const platforms = [];
  if (/ubuntu-(?:latest|\d+)/.test(lower)) platforms.push('ubuntu');
  if (/macos-(?:latest|\d+)/.test(lower)) platforms.push('macos');
  if (/windows-(?:latest|\d+)/.test(lower)) platforms.push('windows');
  return platforms;
}

function credentialBearingUrl(text) {
  const regex = /https:\/\/([^\s/'"@]+):([^\s/'"@]+)@github\.com\//gi;
  return regex.test(text);
}

function looksLikeTjsvUsage(text) {
  return /typespec-json-schema-validator|@oresoftware\/typespec-json-schema-validator|\btjsv\b|\btsjsv\b/i.test(text);
}

function normalizeRef(raw) {
  return String(raw).trim().toLowerCase();
}

function inspectConfigFile({ path, text, admittedRevision }) {
  const findings = [];
  const refs = [];
  const lowerPath = path.toLowerCase();
  const workflow = lowerPath.startsWith('.github/workflows/')
    && (lowerPath.endsWith('.yml') || lowerPath.endsWith('.yaml'));

  if (credentialBearingUrl(text)) {
    findings.push(finding(
      'tjsv-credential-bearing-github-url',
      'blocking',
      path,
      'GitHub URL embeds credentials; refuse credential-bearing TJSV provenance inputs.',
    ));
  }

  for (const raw of actionRefs(text)) {
    const ref = normalizeRef(raw);
    refs.push({ kind: 'action', ref, path });
    if (!SHA40.test(ref)) {
      findings.push(finding(
        'tjsv-floating-action-ref', 'blocking', path,
        'TJSV GitHub Action references must use an immutable full Git SHA.', { ref },
      ));
    }
  }

  for (const raw of checkoutRefs(text)) {
    const ref = normalizeRef(raw);
    refs.push({ kind: 'checkout', ref, path });
    if (!SHA40.test(ref)) {
      findings.push(finding(
        'tjsv-floating-checkout-ref', 'blocking', path,
        'TJSV source checkouts must use an immutable full Git SHA.', { ref },
      ));
    }
  }

  if (lowerPath.endsWith('package.json')) {
    for (const dependency of dependencyRefs(text)) {
      const value = dependency.value.trim();
      const tarball = /github\.com\/ORESoftware\/typespec-json-schema-validator\/(?:archive|tarball)\/([0-9a-f]{40})(?:\.tar\.gz)?/i.exec(value);
      const gitSha = /#([0-9a-f]{40})$/i.exec(value);
      const ref = tarball?.[1] ?? gitSha?.[1] ?? null;
      if (ref) {
        refs.push({ kind: `package:${dependency.section}`, ref: normalizeRef(ref), path });
      } else {
        findings.push(finding(
          'tjsv-floating-package-ref', 'blocking', path,
          'TJSV package dependencies must resolve from an immutable full Git SHA.',
          { section: dependency.section, value },
        ));
      }
    }
  }

  if (workflow && looksLikeTjsvUsage(text)) {
    const platforms = workflowPlatforms(text);
    const missing = ['ubuntu', 'macos', 'windows'].filter((platform) => !platforms.includes(platform));
    if (missing.length > 0) {
      findings.push(finding(
        'tjsv-portability-matrix-incomplete', 'review', path,
        'TJSV admission workflow does not visibly certify all three primary runner families.',
        { present: platforms, missing },
      ));
    }
    if (!/report|receipt|sarif|status/i.test(text)) {
      findings.push(finding(
        'tjsv-evidence-assertion-not-visible', 'review', path,
        'TJSV workflow use is visible but a durable report/receipt/status assertion was not found.',
      ));
    }
  }

  for (const reference of refs) {
    if (SHA40.test(reference.ref) && reference.ref !== admittedRevision) {
      findings.push(finding(
        'tjsv-pin-differs-from-admitted-revision', 'review', path,
        'TJSV pin differs from the configured admitted revision; reachability must be verified.',
        { kind: reference.kind, ref: reference.ref, admittedRevision },
      ));
    }
  }

  return { refs, findings };
}

export function inspectRepositorySnapshot({ repository, paths, files, admittedRevision }) {
  const repo = assertObject(repository, 'repository');
  const fullName = canonicalString(repo.full_name ?? repo.fullName, 'repository full name');
  const revision = validateAdmittedRevision(admittedRevision);
  const tree = classifyRepositoryTree(paths);
  const findings = [];
  const refs = [];
  let lockRevision = null;
  let hasTjsvUsage = false;

  for (const file of files ?? []) {
    if (!file || typeof file.path !== 'string' || typeof file.text !== 'string') continue;
    if (looksLikeTjsvUsage(file.text)) hasTjsvUsage = true;
    const inspected = inspectConfigFile({ path: file.path, text: file.text, admittedRevision: revision });
    findings.push(...inspected.findings);
    refs.push(...inspected.refs);
    if (file.path.toLowerCase() === 'tooling/source-lock.json') {
      const candidate = sourceLockRevision(file.text);
      if (candidate !== null) lockRevision = normalizeRef(candidate);
    }
  }

  if (lockRevision !== null) {
    if (!SHA40.test(lockRevision)) {
      findings.push(finding(
        'tjsv-source-lock-invalid-revision', 'blocking', 'tooling/source-lock.json',
        'TJSV source-lock revision must be a full 40-character Git SHA.', { ref: lockRevision },
      ));
    } else {
      const pinned = uniqueSorted(refs.filter((entry) => SHA40.test(entry.ref)).map((entry) => entry.ref));
      const drift = pinned.filter((ref) => ref !== lockRevision);
      if (drift.length > 0) {
        findings.push(finding(
          'tjsv-source-lock-drift', 'blocking', 'tooling/source-lock.json',
          'TJSV workflow/package pins disagree with the repository source lock.',
          { lockRevision, conflictingPins: drift },
        ));
      }
    }
  }

  if (tree.hasPeerAuthorityCandidates && !hasTjsvUsage) {
    findings.push(finding(
      'tjsv-admission-not-visible', 'review', null,
      'Repository contains TypeSpec and authored JSON Schema candidates but no visible TJSV admission use.',
      {
        typeSpecExamples: tree.typeSpecFiles.slice(0, 5),
        authoredSchemaExamples: tree.authoredJsonSchemaFiles.slice(0, 5),
      },
    ));
  }

  findings.sort((left, right) => `${left.rule}:${left.path ?? ''}:${JSON.stringify(left.evidence)}`
    .localeCompare(`${right.rule}:${right.path ?? ''}:${JSON.stringify(right.evidence)}`));

  return {
    repository: fullName,
    archived: repo.archived === true,
    private: repo.private === true,
    defaultBranch: repo.default_branch ?? repo.defaultBranch ?? null,
    authorityCandidates: tree,
    hasTjsvUsage,
    refs,
    findings,
  };
}

export function evaluatePinReachability({ reference, admittedRevision, comparison }) {
  const ref = validateAdmittedRevision(reference);
  const admitted = validateAdmittedRevision(admittedRevision);
  if (ref === admitted) return { status: 'current', blocking: false };
  const value = assertObject(comparison, 'GitHub compare response');
  const mergeBase = value.merge_base_commit?.sha?.toLowerCase();
  const base = value.base_commit?.sha?.toLowerCase();
  if (value.status === 'ahead' && mergeBase === ref && base === ref) {
    return { status: 'stale-main-reachable', blocking: false };
  }
  if (value.status === 'identical') return { status: 'current', blocking: false };
  return { status: 'unreachable-or-divergent', blocking: true };
}

export function evaluateFleetCoverage({ scope, repositories, organizationFailures = [] }) {
  const normalizedScope = validateFleetScope(scope);
  const excluded = new Set(normalizedScope.excludedRepositories.map((name) => name.toLowerCase()));
  const counted = (repositories ?? []).filter((repo) => {
    if (!repo || typeof repo.full_name !== 'string') return false;
    if (excluded.has(repo.full_name.toLowerCase())) return false;
    return normalizedScope.includeArchived || repo.archived !== true;
  });
  const organizations = uniqueSorted(counted.map((repo) => String(repo.owner?.login ?? '').trim()).filter(Boolean));
  const failures = [...organizationFailures];
  if (organizations.length < normalizedScope.minimumOrganizations) {
    failures.push(`only ${organizations.length} organizations were enumerated; minimum is ${normalizedScope.minimumOrganizations}`);
  }
  if (counted.length < normalizedScope.minimumRepositories) {
    failures.push(`only ${counted.length} repositories were enumerated; minimum is ${normalizedScope.minimumRepositories}`);
  }
  return {
    organizations,
    repositoryCount: counted.length,
    status: failures.length === 0 ? 'passed' : 'failed',
    failures: uniqueSorted(failures),
  };
}

function candidateTextPath(path, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > DEFAULT_FILE_LIMIT) return false;
  const lower = path.toLowerCase();
  if (lower === 'package.json' || lower.endsWith('/package.json')) return true;
  if (lower === 'tooling/source-lock.json') return true;
  if (lower.startsWith('.github/workflows/') && (lower.endsWith('.yml') || lower.endsWith('.yaml'))) return true;
  return lower.endsWith('.tjsv.json') || lower.endsWith('.tjsv.toml');
}

async function githubJson(fetchImpl, token, url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'tjsv-github-fleet-audit/1',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response || typeof response.ok !== 'boolean') throw new Error('invalid GitHub response');
  if (!response.ok) throw new Error(`GitHub request failed with HTTP ${response.status}`);
  const remaining = Number(response.headers?.get?.('x-ratelimit-remaining'));
  if (Number.isFinite(remaining) && remaining < DEFAULT_RATE_FLOOR) {
    throw new Error(`GitHub rate limit remaining ${remaining} is below safety floor ${DEFAULT_RATE_FLOOR}`);
  }
  return response.json();
}

async function listOrganizationRepositories(fetchImpl, token, organization, timeoutMs) {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/orgs/${encodeURIComponent(organization)}/repos?type=all&per_page=100&page=${page}`;
    const batch = await githubJson(fetchImpl, token, url, { timeoutMs });
    if (!Array.isArray(batch)) throw new Error(`GitHub repository list for ${organization} is not an array`);
    repositories.push(...batch);
    if (batch.length < 100) break;
  }
  return repositories;
}

async function repositoryTree(fetchImpl, token, repository, timeoutMs) {
  const branch = canonicalString(repository.default_branch, `${repository.full_name} default branch`);
  const url = `https://api.github.com/repos/${repository.full_name}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const document = await githubJson(fetchImpl, token, url, { timeoutMs });
  if (document.truncated === true) throw new Error(`${repository.full_name} recursive tree was truncated`);
  if (!Array.isArray(document.tree)) throw new Error(`${repository.full_name} recursive tree is missing`);
  return document.tree;
}

async function repositoryFileText(fetchImpl, token, repository, path, timeoutMs) {
  const url = `https://api.github.com/repos/${repository.full_name}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(repository.default_branch)}`;
  const document = await githubJson(fetchImpl, token, url, { timeoutMs });
  if (document.type !== 'file' || document.encoding !== 'base64' || typeof document.content !== 'string') {
    throw new Error(`${repository.full_name}:${path} is not a base64 GitHub file response`);
  }
  return Buffer.from(document.content.replaceAll('\n', ''), 'base64').toString('utf8');
}

export async function runGitHubFleetAudit({
  scope,
  admittedRevision,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedScope = validateFleetScope(scope);
  const revision = validateAdmittedRevision(admittedRevision);
  const githubToken = canonicalString(token, 'GitHub token');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const repositories = [];
  const organizationFailures = [];
  for (const organization of normalizedScope.organizations) {
    try {
      const batch = await listOrganizationRepositories(fetchImpl, githubToken, organization, timeoutMs);
      repositories.push(...batch);
    } catch (error) {
      organizationFailures.push(`${organization}: ${error.message}`);
    }
  }

  const coverage = evaluateFleetCoverage({ scope: normalizedScope, repositories, organizationFailures });
  if (coverage.status !== 'passed') {
    return {
      schema: RECEIPT_SCHEMA,
      status: 'failed',
      admittedRevision: revision,
      coverage,
      repositories: [],
      findings: [],
    };
  }

  const excluded = new Set(normalizedScope.excludedRepositories.map((name) => name.toLowerCase()));
  const selected = repositories
    .filter((repo) => (normalizedScope.includeArchived || repo.archived !== true)
      && !excluded.has(String(repo.full_name).toLowerCase()))
    .sort((left, right) => left.full_name.localeCompare(right.full_name));

  const snapshots = [];
  const infrastructureFailures = [];
  for (const repository of selected) {
    try {
      const tree = await repositoryTree(fetchImpl, githubToken, repository, timeoutMs);
      const blobs = tree.filter((entry) => entry.type === 'blob' && typeof entry.path === 'string');
      const files = [];
      for (const entry of blobs.filter((candidate) => candidateTextPath(candidate.path, candidate.size))) {
        files.push({
          path: entry.path,
          text: await repositoryFileText(fetchImpl, githubToken, repository, entry.path, timeoutMs),
        });
      }
      snapshots.push(inspectRepositorySnapshot({
        repository,
        paths: blobs.map((entry) => entry.path),
        files,
        admittedRevision: revision,
      }));
    } catch (error) {
      infrastructureFailures.push(`${repository.full_name}: ${error.message}`);
    }
  }

  const findings = snapshots.flatMap((snapshot) => snapshot.findings.map((entry) => ({
    repository: snapshot.repository,
    ...entry,
  }))).sort((left, right) => `${left.repository}:${left.rule}:${left.path ?? ''}`
    .localeCompare(`${right.repository}:${right.rule}:${right.path ?? ''}`));

  const blocking = findings.filter((entry) => entry.severity === 'blocking');
  const review = findings.filter((entry) => entry.severity === 'review');
  const status = infrastructureFailures.length > 0
    ? 'failed'
    : blocking.length > 0 || review.length > 0
      ? 'stopped_for_evaluation'
      : 'passed';

  return {
    schema: RECEIPT_SCHEMA,
    status,
    admittedRevision: revision,
    coverage,
    repositories: snapshots,
    findings,
    summary: {
      blocking: blocking.length,
      review: review.length,
      infrastructureFailures: infrastructureFailures.length,
    },
    infrastructureFailures: uniqueSorted(infrastructureFailures),
  };
}

export { RECEIPT_SCHEMA };
