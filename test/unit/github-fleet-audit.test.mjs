import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRepositoryTree,
  evaluateFleetCoverage,
  evaluatePinReachability,
  inspectRepositorySnapshot,
  runGitHubFleetAudit,
  validateAdmittedRevision,
  validateFleetScope,
} from '../../src/github-fleet-audit.mjs';

const CURRENT = '5b04b08512f8a03a376dcb96818969e2d83c2d84';
const OLD = '8bf7ebda4e35c0d11b5b5e5f865867bee4fc3085';
const OTHER = '1111111111111111111111111111111111111111';

function scope(overrides = {}) {
  return {
    schema: 'tjsv-github-fleet-scope/v1',
    minimumOrganizations: 2,
    minimumRepositories: 3,
    includeArchived: false,
    organizations: ['alpha-org', 'beta-org'],
    excludedRepositories: [],
    ...overrides,
  };
}

function repo(fullName, { archived = false, privateRepo = false } = {}) {
  const [owner, name] = fullName.split('/');
  return {
    id: Math.floor(Math.random() * 1_000_000),
    name,
    full_name: fullName,
    archived,
    private: privateRepo,
    default_branch: 'main',
    owner: { login: owner, type: 'Organization' },
  };
}

function snapshot({ paths = [], files = [], repository = repo('alpha-org/contracts') } = {}) {
  return inspectRepositorySnapshot({ repository, paths, files, admittedRevision: CURRENT });
}

test('fleet scope requires unique valid organizations and bounded minimums', () => {
  const parsed = validateFleetScope(scope());
  assert.deepEqual(parsed.organizations, ['alpha-org', 'beta-org']);
  assert.equal(parsed.minimumOrganizations, 2);
  assert.equal(parsed.minimumRepositories, 3);
  assert.throws(() => validateFleetScope(scope({ organizations: ['alpha-org', 'alpha-org'] })), /unique/);
  assert.throws(() => validateFleetScope(scope({ minimumOrganizations: 3 })), /cannot exceed/);
  assert.throws(() => validateFleetScope(scope({ organizations: ['bad/org', 'beta-org'] })), /invalid GitHub organization/);
});

test('admitted revision must be an immutable full Git SHA', () => {
  assert.equal(validateAdmittedRevision(CURRENT.toUpperCase()), CURRENT);
  assert.throws(() => validateAdmittedRevision('main'), /40-character Git SHA/);
  assert.throws(() => validateAdmittedRevision(CURRENT.slice(0, 12)), /40-character Git SHA/);
});

test('tree classification keeps authored authorities separate from generated evidence', () => {
  const result = classifyRepositoryTree([
    'contracts/main.tsp',
    'contracts/authored.schema.json',
    'generated/main.schema.json',
    'dist/generated.schema.json',
    'node_modules/pkg/schema.json',
    'reports/parity-receipt.schema.json',
  ]);
  assert.deepEqual(result.typeSpecFiles, ['contracts/main.tsp']);
  assert.deepEqual(result.authoredJsonSchemaFiles, ['contracts/authored.schema.json']);
  assert.deepEqual(result.generatedJsonSchemaFiles, ['dist/generated.schema.json', 'generated/main.schema.json']);
  assert.equal(result.hasPeerAuthorityCandidates, true);
});

test('floating TJSV action refs block admission', () => {
  const result = snapshot({
    files: [{ path: '.github/workflows/contracts.yml', text: 'uses: ORESoftware/typespec-json-schema-validator@main' }],
  });
  assert.equal(result.findings.some((entry) => entry.rule === 'tjsv-floating-action-ref' && entry.severity === 'blocking'), true);
});

test('current immutable action pin does not emit pin-drift finding', () => {
  const result = snapshot({
    files: [{
      path: '.github/workflows/contracts.yml',
      text: `jobs:\n  parity:\n    runs-on: ${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-latest, windows-2025]\n    steps:\n      - uses: ORESoftware/typespec-json-schema-validator@${CURRENT}\n      - run: test -f report.json\n`,
    }],
  });
  assert.equal(result.findings.some((entry) => entry.rule === 'tjsv-floating-action-ref'), false);
  assert.equal(result.findings.some((entry) => entry.rule === 'tjsv-pin-differs-from-admitted-revision'), false);
  assert.equal(result.findings.some((entry) => entry.rule === 'tjsv-portability-matrix-incomplete'), false);
});

test('old immutable action pin is a review finding pending reachability proof', () => {
  const result = snapshot({
    files: [{ path: '.github/workflows/contracts.yml', text: `uses: ORESoftware/typespec-json-schema-validator@${OLD}` }],
  });
  const finding = result.findings.find((entry) => entry.rule === 'tjsv-pin-differs-from-admitted-revision');
  assert.equal(finding.severity, 'review');
  assert.equal(finding.evidence.ref, OLD);
});

test('source-lock disagreement blocks admission', () => {
  const result = snapshot({
    files: [
      { path: '.github/workflows/contracts.yml', text: `uses: ORESoftware/typespec-json-schema-validator@${OLD}` },
      { path: 'tooling/source-lock.json', text: JSON.stringify({ tools: { tjsv: { sha: CURRENT } } }) },
    ],
  });
  const finding = result.findings.find((entry) => entry.rule === 'tjsv-source-lock-drift');
  assert.equal(finding.severity, 'blocking');
  assert.deepEqual(finding.evidence.conflictingPins, [OLD]);
});

test('malformed source-lock revision blocks admission', () => {
  const result = snapshot({
    files: [{ path: 'tooling/source-lock.json', text: JSON.stringify({ tjsv: { revision: 'main' } }) }],
  });
  assert.equal(result.findings.some((entry) => entry.rule === 'tjsv-source-lock-invalid-revision'), true);
});

test('semver package dependency blocks while immutable Git tarball is accepted', () => {
  const floating = snapshot({ files: [{
    path: 'package.json',
    text: JSON.stringify({ dependencies: { '@oresoftware/typespec-json-schema-validator': '^0.1.0' } }),
  }] });
  assert.equal(floating.findings.some((entry) => entry.rule === 'tjsv-floating-package-ref'), true);

  const immutable = snapshot({ files: [{
    path: 'package.json',
    text: JSON.stringify({ dependencies: {
      '@oresoftware/typespec-json-schema-validator': `https://github.com/ORESoftware/typespec-json-schema-validator/archive/${CURRENT}.tar.gz`,
    } }),
  }] });
  assert.equal(immutable.findings.some((entry) => entry.rule === 'tjsv-floating-package-ref'), false);
});

test('peer authority candidates without visible TJSV admission are review findings', () => {
  const result = snapshot({ paths: ['contracts/main.tsp', 'contracts/authored.schema.json'] });
  assert.equal(result.findings.some((entry) => entry.rule === 'tjsv-admission-not-visible'), true);
});

test('generated schema alone does not masquerade as authored peer authority', () => {
  const result = snapshot({ paths: ['contracts/main.tsp', 'generated/main.schema.json'] });
  assert.equal(result.authorityCandidates.hasPeerAuthorityCandidates, false);
  assert.equal(result.findings.some((entry) => entry.rule === 'tjsv-admission-not-visible'), false);
});

test('credential-bearing GitHub URLs block provenance evaluation without echoing secrets', () => {
  const result = snapshot({ files: [{
    path: 'package.json',
    text: '{"note":"https://alice:super-secret@github.com/ORESoftware/typespec-json-schema-validator"}',
  }] });
  const finding = result.findings.find((entry) => entry.rule === 'tjsv-credential-bearing-github-url');
  assert.equal(finding.severity, 'blocking');
  assert.equal(JSON.stringify(finding).includes('super-secret'), false);
});

test('pin reachability distinguishes stale main ancestors from divergence', () => {
  assert.deepEqual(evaluatePinReachability({
    reference: OLD,
    admittedRevision: CURRENT,
    comparison: {
      status: 'ahead',
      base_commit: { sha: OLD },
      merge_base_commit: { sha: OLD },
    },
  }), { status: 'stale-main-reachable', blocking: false });

  assert.deepEqual(evaluatePinReachability({
    reference: OTHER,
    admittedRevision: CURRENT,
    comparison: {
      status: 'diverged',
      base_commit: { sha: OTHER },
      merge_base_commit: { sha: '2222222222222222222222222222222222222222' },
    },
  }), { status: 'unreachable-or-divergent', blocking: true });
});

test('fleet coverage excludes archived repositories by default and enforces both floors', () => {
  const repositories = [
    repo('alpha-org/a'),
    repo('alpha-org/b'),
    repo('beta-org/c'),
    repo('beta-org/archived', { archived: true }),
  ];
  const result = evaluateFleetCoverage({ scope: scope(), repositories });
  assert.equal(result.status, 'passed');
  assert.equal(result.repositoryCount, 3);
  assert.deepEqual(result.organizations, ['alpha-org', 'beta-org']);

  const failed = evaluateFleetCoverage({ scope: scope({ minimumRepositories: 4 }), repositories });
  assert.equal(failed.status, 'failed');
  assert.match(failed.failures.join('\n'), /only 3 repositories/);
});

test('fleet coverage propagates organization enumeration failures', () => {
  const result = evaluateFleetCoverage({
    scope: scope(),
    repositories: [repo('alpha-org/a'), repo('alpha-org/b'), repo('beta-org/c')],
    organizationFailures: ['beta-org: HTTP 403'],
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.failures.includes('beta-org: HTTP 403'), true);
});

function response(body, { status = 200, remaining = '5000' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return name.toLowerCase() === 'x-ratelimit-remaining' ? remaining : null; } },
    async json() { return body; },
  };
}

test('live fleet audit fails closed before repo inspection when coverage cannot be proven', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/orgs/alpha-org/repos')) return response([repo('alpha-org/a')]);
    if (String(url).includes('/orgs/beta-org/repos')) return response({ message: 'denied' }, { status: 403 });
    throw new Error(`unexpected request: ${url}`);
  };
  const receipt = await runGitHubFleetAudit({
    scope: scope(),
    admittedRevision: CURRENT,
    token: 'test-token',
    fetchImpl,
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.repositories.length, 0);
  assert.match(receipt.coverage.failures.join('\n'), /beta-org/);
});

test('live fleet audit refuses to continue below the GitHub rate-limit safety floor', async () => {
  const fetchImpl = async () => response([], { remaining: '99' });
  const receipt = await runGitHubFleetAudit({
    scope: scope(),
    admittedRevision: CURRENT,
    token: 'test-token',
    fetchImpl,
  });
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.coverage.failures.join('\n'), /safety floor 100/);
});
