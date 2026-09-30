const ROOT_ACTION = 'oresoftware/typespec-json-schema-validator';
const RECEIPT_SCHEMA = 'ores.typespec-json-schema-validator.github-fleet-manifest-adoption/v1';
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
  return Buffer.from(body.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

function normalizeFleetRepository(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const repository = typeof entry.repository === 'string' ? entry.repository : null;
  const defaultBranch = typeof entry.defaultBranch === 'string' && entry.defaultBranch !== ''
    ? entry.defaultBranch
    : 'main';
  if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository)) return null;
  const actionPaths = sortedUnique((entry.refs ?? [])
    .filter((ref) => ref && ref.kind === 'action' && typeof ref.path === 'string')
    .map((ref) => ref.path)
    .filter((path) => path.startsWith('.github/workflows/')));
  return { repository, defaultBranch, actionPaths, hasTjsvUsage: entry.hasTjsvUsage === true };
}

function adoptionMode({ manifestPresent, workflows }) {
  const modes = sortedUnique(workflows.flatMap((workflow) => workflow.modes));
  if (modes.some((mode) => mode.startsWith('invalid-')) || modes.length > 1) return 'mixed-or-invalid';
  if (modes.length === 0) return manifestPresent ? 'manifest-present-no-root-action' : 'no-root-action';
  if (modes[0] === 'legacy-inline') return manifestPresent ? 'legacy-inline-with-manifest' : 'legacy-inline';
  if (modes[0].startsWith('manifest-')) return manifestPresent ? modes[0] : 'manifest-missing';
  return 'mixed-or-invalid';
}

async function inspectRepository({ repository, defaultBranch, actionPaths, hasTjsvUsage }, token, fetchImpl, rateFloor) {
  const [owner, name] = repository.split('/');
  const encodedRef = encodeURIComponent(defaultBranch);
  const manifestUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/.ores-tjsv.toml?ref=${encodedRef}`;
  const manifestResponse = await githubJson(fetchImpl, manifestUrl, token, rateFloor);
  const manifestPresent = manifestResponse.status === 200;
  if (manifestPresent && (manifestResponse.body?.type !== 'file' || manifestResponse.body?.name !== '.ores-tjsv.toml')) {
    throw new Error('.ores-tjsv.toml must resolve to a regular repository file');
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
  if (mode === 'manifest-missing') {
    findings.push(finding(
      'tjsv-manifest-required-by-workflow', 'blocking', '.ores-tjsv.toml',
      'A root TJSV Action uses manifest mode but the repository has no root .ores-tjsv.toml.',
    ));
  }
  if (mode === 'legacy-inline' || mode === 'legacy-inline-with-manifest') {
    findings.push(finding(
      'tjsv-legacy-inline-migration-candidate', 'review', null,
      'Root TJSV Action usage still duplicates consumer contract configuration in workflow YAML.',
      { manifestPresent, workflowPaths: workflows.map((workflow) => workflow.path) },
    ));
  }
  if (mode === 'legacy-inline-with-manifest') {
    findings.push(finding(
      'tjsv-manifest-present-but-inline-action', 'review', '.ores-tjsv.toml',
      'A root manifest exists but root TJSV Action steps still use legacy inline peer-authority inputs.',
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
  if (!Array.isArray(fleetReceipt.repositories)) throw new Error('fleetReceipt.repositories must be an array');
  if (typeof token !== 'string' || token.trim() === '') throw new Error('GitHub token is required');
  if (!Number.isSafeInteger(rateFloor) || rateFloor < 1) throw new Error('rateFloor must be a positive integer');

  const targets = fleetReceipt.repositories.map(normalizeFleetRepository).filter(Boolean);
  const repositories = [];
  const failures = [];
  for (const target of targets) {
    if (target.actionPaths.length === 0 && !target.hasTjsvUsage) continue;
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
    .filter((repository) => ['legacy-inline', 'legacy-inline-with-manifest'].includes(repository.mode))
    .map((repository) => repository.repository)
    .sort();
  const manifestAdopted = repositories.filter(
    (repository) => ['manifest-auto', 'manifest-explicit'].includes(repository.mode),
  ).length;

  return {
    schema: RECEIPT_SCHEMA,
    status: failures.length > 0 ? 'stopped_for_evaluation' : blockingCount > 0 ? 'failed' : 'passed',
    sourceFleetReceiptSchema: fleetReceipt.schema ?? null,
    sourceAdmittedRevision: fleetReceipt.admittedRevision ?? null,
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
