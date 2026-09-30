const ROOT_ACTION = 'oresoftware/typespec-json-schema-validator';
const SOURCE_RECEIPT_SCHEMA = 'ores.typespec-json-schema-validator.github-fleet-audit/v1';
const RECEIPT_SCHEMA = 'ores.typespec-json-schema-validator.github-fleet-manifest-adoption/v1';
const SHA40 = /^[0-9a-f]{40}$/i;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_WORKFLOW_BYTES = 1024 * 1024;
const DEFAULT_RATE_FLOOR = 50;

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function finding(rule, severity, path, message, evidence = {}) {
  return { rule, severity, path, message, evidence };
}

function stripComment(value) {
  const index = value.indexOf(' #');
  return (index === -1 ? value : value.slice(0, index)).trim();
}

function unquote(value) {
  const trimmed = stripComment(value).trim();
  if (trimmed.length >= 2 && ['"', "'"].includes(trimmed[0]) && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function indentation(line) {
  return line.length - line.trimStart().length;
}

function parseUses(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) return null;
  const field = trimmed.startsWith('-') ? trimmed.slice(1).trimStart() : trimmed;
  const raw = field.startsWith('uses:') ? field.slice('uses:'.length).trim() : null;
  if (!raw) return null;
  const value = unquote(raw);
  const split = value.lastIndexOf('@');
  if (split <= 0) return null;
  return { source: value.slice(0, split).toLowerCase(), revision: value.slice(split + 1) };
}

function stepBounds(lines, usesIndex) {
  const usesIndent = indentation(lines[usesIndex]);
  const usesTrimmed = lines[usesIndex].trimStart();
  let start = usesIndex;
  let stepIndent = usesIndent;
  if (!usesTrimmed.startsWith('-')) {
    for (let index = usesIndex - 1; index >= 0; index -= 1) {
      const candidate = lines[index];
      if (indentation(candidate) < usesIndent && candidate.trimStart().startsWith('- ')) {
        start = index;
        stepIndent = indentation(candidate);
        break;
      }
    }
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const candidate = lines[index];
    if (indentation(candidate) === stepIndent && candidate.trimStart().startsWith('- ')) {
      end = index;
      break;
    }
  }
  return [start, end];
}

function withInput(step, name) {
  const withIndex = step.findIndex((line) => line.trimStart() === 'with:');
  if (withIndex === -1) return null;
  const withIndent = indentation(step[withIndex]);
  const prefix = `${name}:`;
  for (const line of step.slice(withIndex + 1)) {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (indentation(line) <= withIndent) break;
    if (trimmed.startsWith(prefix)) return unquote(trimmed.slice(prefix.length));
  }
  return null;
}

function classifyRootActionStep(step) {
  const typespec = withInput(step, 'typespec');
  const schema = withInput(step, 'schema');
  const contract = withInput(step, 'contract');
  const legacyCount = Number(typespec !== null) + Number(schema !== null);

  if (contract !== null && legacyCount > 0) {
    return { mode: 'invalid-mixed', contract, typespec, schema };
  }
  if (legacyCount === 1) {
    return { mode: 'invalid-partial-legacy', contract, typespec, schema };
  }
  if (legacyCount === 2) {
    return { mode: 'legacy-inline', contract: null, typespec, schema };
  }
  if (contract !== null) {
    return { mode: 'manifest-explicit', contract, typespec: null, schema: null };
  }
  return { mode: 'manifest-auto', contract: null, typespec: null, schema: null };
}

export function classifyWorkflowManifestUsage(text) {
  if (typeof text !== 'string') throw new TypeError('workflow text must be a string');
  const lines = text.split(/\r?\n/);
  const steps = [];
  for (let index = 0; index < lines.length; index += 1) {
    const uses = parseUses(lines[index]);
    if (!uses || uses.source !== ROOT_ACTION) continue;
    const [start, end] = stepBounds(lines, index);
    steps.push({
      line: index + 1,
      revision: uses.revision,
      ...classifyRootActionStep(lines.slice(start, end)),
    });
  }
  const modes = sortedUnique(steps.map((step) => step.mode));
  return {
    rootActionCount: steps.length,
    mode: modes.length === 0 ? 'none' : modes.length === 1 ? modes[0] : 'mixed-workflow',
    modes,
    steps,
  };
}

function headerRemaining(response) {
  const raw = response?.headers?.get?.('x-ratelimit-remaining');
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function githubJson(fetchImpl, url, token, rateFloor) {
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'tjsv-github-fleet-manifest-adoption/1',
      'x-github-api-version': '2022-11-28',
    },
  });
  const remaining = headerRemaining(response);
  if (remaining !== null && remaining < rateFloor) {
    const error = new Error(`GitHub rate limit remaining ${remaining} fell below safety floor ${rateFloor}`);
    error.code = 'rate-floor';
    throw error;
  }
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) {
    const error = new Error(`GitHub request failed with HTTP ${response.status}`);
    error.code = `http-${response.status}`;
    throw error;
  }
  return { status: response.status, body: await response.json() };
}

function contentsText(body, path) {
  if (!body || body.type !== 'file' || typeof body.content !== 'string') {
    throw new Error(`${path} must resolve to a regular GitHub contents file`);
  }
  if (Number.isSafeInteger(body.size) && body.size > MAX_WORKFLOW_BYTES) {
    throw new Error(`${path} exceeds ${MAX_WORKFLOW_BYTES} bytes`);
  }
  if (body.encoding !== 'base64') throw new Error(`${path} must use base64 GitHub contents encoding`);
  const bytes = Buffer.from(body.content.replace(/\s/g, ''), 'base64');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${path} must contain valid UTF-8`);
  }
}

function normalizeFleetRepository(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const repository = typeof entry.repository === 'string' ? entry.repository : null;
  if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository)) return null;
  if (!Array.isArray(entry.refs)) return null;

  const rawActionRefs = entry.refs.filter((ref) => ref && ref.kind === 'action');
  const actionPaths = [];
  for (const ref of rawActionRefs) {
    const path = ref.path;
    if (typeof path !== 'string'
      || !path.startsWith('.github/workflows/')
      || path.includes('\\')
      || path.split('/').includes('..')) {
      return null;
    }
    actionPaths.push(path);
  }
  const uniqueActionPaths = sortedUnique(actionPaths);
  const hasTjsvUsage = entry.hasTjsvUsage === true;

  if (uniqueActionPaths.length === 0 && !hasTjsvUsage) {
    return {
      repository,
      defaultBranch: null,
      actionPaths: [],
      hasTjsvUsage: false,
      skip: true,
    };
  }

  const defaultBranch = typeof entry.defaultBranch === 'string' && entry.defaultBranch.trim() !== ''
    ? entry.defaultBranch.trim()
    : null;
  if (!defaultBranch) return null;
  return {
    repository,
    defaultBranch,
    actionPaths: uniqueActionPaths,
    hasTjsvUsage,
    skip: false,
  };
}

function adoptionMode({ manifestPresent, workflows }) {
  const modes = sortedUnique(workflows.flatMap((workflow) => workflow.modes));
  if (modes.some((mode) => mode.startsWith('invalid-'))) return 'mixed-or-invalid';
  if (modes.length === 0) return manifestPresent ? 'manifest-present-no-root-action' : 'no-root-action';

  const hasLegacy = modes.includes('legacy-inline');
  const hasManifestAuto = modes.includes('manifest-auto');
  const hasManifestExplicit = modes.includes('manifest-explicit');
  const hasManifest = hasManifestAuto || hasManifestExplicit;

  if (hasLegacy && hasManifest) {
    return manifestPresent ? 'mixed-legacy-and-manifest' : 'mixed-legacy-and-manifest-missing';
  }
  if (hasLegacy) return manifestPresent ? 'legacy-inline-with-manifest' : 'legacy-inline';
  if (hasManifest) {
    if (!manifestPresent) return 'manifest-missing';
    if (hasManifestAuto && hasManifestExplicit) return 'manifest-mixed-selection';
    return hasManifestExplicit ? 'manifest-explicit' : 'manifest-auto';
  }
  return 'mixed-or-invalid';
}

async function inspectRepository({ repository, defaultBranch, actionPaths, hasTjsvUsage }, token, fetchImpl, rateFloor) {
  const [owner, name] = repository.split('/');
  const encodedRef = encodeURIComponent(defaultBranch);
  const manifestUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/.ores-tjsv.toml?ref=${encodedRef}`;
  const manifestResponse = await githubJson(fetchImpl, manifestUrl, token, rateFloor);
  const manifestPresent = manifestResponse.status === 200;
  if (manifestPresent) {
    if (manifestResponse.body?.type !== 'file' || manifestResponse.body?.name !== '.ores-tjsv.toml') {
      throw new Error('.ores-tjsv.toml must resolve to a regular repository file');
    }
    if (!Number.isSafeInteger(manifestResponse.body?.size) || manifestResponse.body.size < 0) {
      throw new Error('.ores-tjsv.toml must expose a bounded GitHub contents size');
    }
    if (manifestResponse.body.size > MAX_MANIFEST_BYTES) {
      throw new Error(`.ores-tjsv.toml exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
  }

  const workflows = [];
  for (const path of actionPaths) {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodedPath}?ref=${encodedRef}`;
    const response = await githubJson(fetchImpl, url, token, rateFloor);
    if (response.status === 404) throw new Error(`referenced workflow disappeared: ${path}`);
    const text = contentsText(response.body, path);
    workflows.push({ path, ...classifyWorkflowManifestUsage(text) });
  }

  const mode = adoptionMode({ manifestPresent, workflows });
  const findings = [];
  const allModes = sortedUnique(workflows.flatMap((workflow) => workflow.modes));
  for (const workflow of workflows) {
    for (const step of workflow.steps) {
      if (step.mode === 'invalid-mixed') {
        findings.push(finding(
          'tjsv-manifest-action-mixed-inputs', 'blocking', workflow.path,
          'A root TJSV Action step mixes manifest selection with legacy TypeSpec/JSON Schema inputs.',
          { line: step.line },
        ));
      } else if (step.mode === 'invalid-partial-legacy') {
        findings.push(finding(
          'tjsv-manifest-action-partial-legacy', 'blocking', workflow.path,
          'A root TJSV Action step supplies only one legacy peer-authority input.',
          { line: step.line },
        ));
      }
    }
  }
  if (mode === 'manifest-missing' || mode === 'mixed-legacy-and-manifest-missing') {
    findings.push(finding(
      'tjsv-manifest-required-by-workflow', 'blocking', '.ores-tjsv.toml',
      'A root TJSV Action uses manifest mode but the repository has no root .ores-tjsv.toml.',
    ));
  }
  if (['legacy-inline', 'legacy-inline-with-manifest', 'mixed-legacy-and-manifest', 'mixed-legacy-and-manifest-missing'].includes(mode)) {
    findings.push(finding(
      'tjsv-legacy-inline-migration-candidate', 'review', null,
      'Root TJSV Action usage still duplicates consumer contract configuration in workflow YAML.',
      { manifestPresent, workflowPaths: workflows.map((workflow) => workflow.path), modes: allModes },
    ));
  }
  if (mode === 'legacy-inline-with-manifest') {
    findings.push(finding(
      'tjsv-manifest-present-but-inline-action', 'review', '.ores-tjsv.toml',
      'A root manifest exists but root TJSV Action steps still use legacy inline peer-authority inputs.',
    ));
  }
  if (mode === 'mixed-legacy-and-manifest') {
    findings.push(finding(
      'tjsv-manifest-partial-repository-migration', 'review', null,
      'The repository mixes legacy-inline and manifest-backed root TJSV Action workflows.',
      { modes: allModes },
    ));
  }
  if (mode === 'manifest-mixed-selection') {
    findings.push(finding(
      'tjsv-manifest-selection-style-mixed', 'review', null,
      'The repository uses both implicit/default and explicit named manifest contract selection.',
      { modes: allModes },
    ));
  }
  if (mode === 'manifest-present-no-root-action' && hasTjsvUsage) {
    findings.push(finding(
      'tjsv-manifest-present-no-root-action', 'review', '.ores-tjsv.toml',
      'A root manifest exists but no root TJSV Action reference was recorded by the first-stage fleet audit.',
    ));
  }

  return { repository, defaultBranch, manifestPresent, mode, workflows, findings };
}

export async function auditFleetManifestAdoption({
  fleetReceipt,
  token,
  fetchImpl = fetch,
  rateFloor = DEFAULT_RATE_FLOOR,
} = {}) {
  if (!fleetReceipt || typeof fleetReceipt !== 'object' || Array.isArray(fleetReceipt)) {
    throw new TypeError('fleetReceipt must be an object');
  }
  if (fleetReceipt.schema !== SOURCE_RECEIPT_SCHEMA) {
    throw new Error(`fleetReceipt.schema must be ${SOURCE_RECEIPT_SCHEMA}`);
  }
  if (fleetReceipt.status !== 'passed') {
    throw new Error('fleetReceipt.status must be passed before manifest adoption can be evaluated');
  }
  if (!SHA40.test(String(fleetReceipt.admittedRevision ?? ''))) {
    throw new Error('fleetReceipt.admittedRevision must be a full 40-character Git SHA');
  }
  if (!Array.isArray(fleetReceipt.repositories) || fleetReceipt.repositories.length === 0) {
    throw new Error('fleetReceipt.repositories must be a non-empty array');
  }
  if (typeof token !== 'string' || token.trim() === '') throw new Error('GitHub token is required');
  if (!Number.isSafeInteger(rateFloor) || rateFloor < 1) throw new Error('rateFloor must be a positive integer');

  const targets = fleetReceipt.repositories.map((entry, index) => {
    const target = normalizeFleetRepository(entry);
    if (!target) throw new Error(`fleetReceipt repository ${index} is malformed or missing required consumer metadata`);
    return target;
  }).filter((target) => !target.skip);

  const repositories = [];
  const failures = [];
  for (const target of targets) {
    try {
      repositories.push(await inspectRepository(target, token, fetchImpl, rateFloor));
    } catch (error) {
      failures.push(`${target.repository}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  repositories.sort((left, right) => left.repository.localeCompare(right.repository));
  failures.sort();

  const blockingCount = repositories.reduce(
    (count, repository) => count + repository.findings.filter((entry) => entry.severity === 'blocking').length,
    0,
  );
  const reviewCount = repositories.reduce(
    (count, repository) => count + repository.findings.filter((entry) => entry.severity === 'review').length,
    0,
  );
  const migrationQueue = repositories
    .filter((repository) => [
      'legacy-inline',
      'legacy-inline-with-manifest',
      'mixed-legacy-and-manifest',
      'mixed-legacy-and-manifest-missing',
    ].includes(repository.mode))
    .map((repository) => repository.repository)
    .sort();
  const manifestAdopted = repositories.filter(
    (repository) => ['manifest-auto', 'manifest-explicit', 'manifest-mixed-selection'].includes(repository.mode),
  ).length;

  return {
    schema: RECEIPT_SCHEMA,
    status: failures.length > 0 ? 'stopped_for_evaluation' : blockingCount > 0 ? 'failed' : 'passed',
    sourceFleetReceiptSchema: fleetReceipt.schema,
    sourceAdmittedRevision: fleetReceipt.admittedRevision,
    summary: {
      repositoriesInspected: repositories.length,
      manifestAdopted,
      migrationCandidates: migrationQueue.length,
      blockingFindings: blockingCount,
      reviewFindings: reviewCount,
      failures: failures.length,
    },
    migrationQueue,
    failures,
    repositories,
  };
}
