import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditFleetManifestAdoption,
  classifyWorkflowManifestUsage,
} from '../../src/github-fleet-manifest-adoption.mjs';

const SHA = 'd776d54d7138bb199ed86d550e22b1570536f4df';

function workflow(body) {
  return `jobs:\n  parity:\n    steps:\n      - uses: ORESoftware/typespec-json-schema-validator@${SHA}\n${body}`;
}

function response(body, { status = 200, remaining = '5000' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return name.toLowerCase() === 'x-ratelimit-remaining' ? remaining : null; } },
    async json() { return body; },
  };
}

function fileBody(name, text) {
  return {
    type: 'file',
    name,
    size: Buffer.byteLength(text),
    encoding: 'base64',
    content: Buffer.from(text).toString('base64'),
  };
}

function fleetReceipt(repositories, overrides = {}) {
  return {
    schema: 'ores.typespec-json-schema-validator.github-fleet-audit/v1',
    status: 'passed',
    admittedRevision: SHA,
    repositories,
    ...overrides,
  };
}

function repository(name, path = '.github/workflows/contracts.yml') {
  return {
    repository: name,
    defaultBranch: 'main',
    hasTjsvUsage: true,
    refs: [{ kind: 'action', ref: SHA, path }],
  };
}

test('workflow classifier distinguishes legacy, explicit manifest, and auto manifest modes', () => {
  const legacy = classifyWorkflowManifestUsage(workflow(
    '        with:\n          typespec: contracts/main.tsp\n          schema: contracts/authored.schema.json\n',
  ));
  assert.equal(legacy.mode, 'legacy-inline');
  assert.equal(legacy.rootActionCount, 1);

  const explicit = classifyWorkflowManifestUsage(workflow(
    '        with:\n          contract: rpc-v1\n',
  ));
  assert.equal(explicit.mode, 'manifest-explicit');
  assert.equal(explicit.steps[0].contract, 'rpc-v1');

  const automatic = classifyWorkflowManifestUsage(workflow(''));
  assert.equal(automatic.mode, 'manifest-auto');
});

test('workflow classifier fails closed on mixed or partial legacy inputs', () => {
  const mixed = classifyWorkflowManifestUsage(workflow(
    '        with:\n          contract: rpc-v1\n          typespec: contracts/main.tsp\n          schema: contracts/authored.schema.json\n',
  ));
  assert.equal(mixed.mode, 'invalid-mixed');

  const partial = classifyWorkflowManifestUsage(workflow(
    '        with:\n          typespec: contracts/main.tsp\n',
  ));
  assert.equal(partial.mode, 'invalid-partial-legacy');
});

test('adoption audit emits a deterministic migration queue while accepting manifest consumers', async () => {
  const legacyPath = '.github/workflows/legacy.yml';
  const manifestPath = '.github/workflows/manifest.yml';
  const receipt = fleetReceipt([
    repository('alpha-org/legacy', legacyPath),
    repository('beta-org/manifest', manifestPath),
  ]);
  const legacyWorkflow = workflow(
    '        with:\n          typespec: contracts/main.tsp\n          schema: contracts/authored.schema.json\n',
  );
  const manifestWorkflow = workflow('        with:\n          contract: default\n');

  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/alpha-org/legacy/contents/.ores-tjsv.toml')) {
      return response(null, { status: 404 });
    }
    if (value.includes('/alpha-org/legacy/contents/.github/workflows/legacy.yml')) {
      return response(fileBody('legacy.yml', legacyWorkflow));
    }
    if (value.includes('/beta-org/manifest/contents/.ores-tjsv.toml')) {
      return response(fileBody('.ores-tjsv.toml', 'version = 1\n'));
    }
    if (value.includes('/beta-org/manifest/contents/.github/workflows/manifest.yml')) {
      return response(fileBody('manifest.yml', manifestWorkflow));
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await auditFleetManifestAdoption({
    fleetReceipt: receipt,
    token: 'test-token',
    fetchImpl,
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.migrationQueue, ['alpha-org/legacy']);
  assert.equal(result.summary.manifestAdopted, 1);
  assert.equal(result.summary.migrationCandidates, 1);
  assert.equal(result.repositories.find((entry) => entry.repository === 'alpha-org/legacy').mode, 'legacy-inline');
  assert.equal(result.repositories.find((entry) => entry.repository === 'beta-org/manifest').mode, 'manifest-explicit');
});

test('partial repository migration stays in the migration queue', async () => {
  const legacyPath = '.github/workflows/legacy.yml';
  const manifestPath = '.github/workflows/manifest.yml';
  const candidate = repository('alpha-org/partial', legacyPath);
  candidate.refs.push({ kind: 'action', ref: SHA, path: manifestPath });
  const receipt = fleetReceipt([candidate]);
  const legacyWorkflow = workflow(
    '        with:\n          typespec: contracts/main.tsp\n          schema: contracts/authored.schema.json\n',
  );
  const manifestWorkflow = workflow('        with:\n          contract: default\n');

  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/contents/.ores-tjsv.toml')) {
      return response(fileBody('.ores-tjsv.toml', 'version = 1\n'));
    }
    if (value.includes('/contents/.github/workflows/legacy.yml')) {
      return response(fileBody('legacy.yml', legacyWorkflow));
    }
    if (value.includes('/contents/.github/workflows/manifest.yml')) {
      return response(fileBody('manifest.yml', manifestWorkflow));
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await auditFleetManifestAdoption({
    fleetReceipt: receipt,
    token: 'test-token',
    fetchImpl,
  });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.migrationQueue, ['alpha-org/partial']);
  assert.equal(result.repositories[0].mode, 'mixed-legacy-and-manifest');
  assert.equal(
    result.repositories[0].findings.some((entry) => entry.rule === 'tjsv-manifest-partial-repository-migration'),
    true,
  );
});

test('manifest-mode Action without root manifest is blocking', async () => {
  const path = '.github/workflows/contracts.yml';
  const receipt = fleetReceipt([repository('alpha-org/missing', path)]);
  const manifestWorkflow = workflow('        with:\n          contract: default\n');
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/contents/.ores-tjsv.toml')) return response(null, { status: 404 });
    if (value.includes('/contents/.github/workflows/contracts.yml')) {
      return response(fileBody('contracts.yml', manifestWorkflow));
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await auditFleetManifestAdoption({
    fleetReceipt: receipt,
    token: 'test-token',
    fetchImpl,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.summary.blockingFindings, 1);
  assert.equal(
    result.repositories[0].findings.some((entry) => entry.rule === 'tjsv-manifest-required-by-workflow'),
    true,
  );
});

test('non-passing first-stage receipt is refused before GitHub reads', async () => {
  await assert.rejects(
    auditFleetManifestAdoption({
      fleetReceipt: fleetReceipt([], { status: 'failed' }),
      token: 'test-token',
      fetchImpl: async () => { throw new Error('must not fetch'); },
    }),
    /fleetReceipt\.status must be passed/,
  );
});

test('GitHub read failures stop evaluation rather than silently shrinking the fleet', async () => {
  const receipt = fleetReceipt([repository('alpha-org/private')]);
  const fetchImpl = async () => response({ message: 'denied' }, { status: 403 });
  const result = await auditFleetManifestAdoption({
    fleetReceipt: receipt,
    token: 'test-token',
    fetchImpl,
  });
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.summary.failures, 1);
  assert.match(result.failures[0], /HTTP 403/);
});

test('rate-floor exhaustion stops evaluation', async () => {
  const receipt = fleetReceipt([repository('alpha-org/limited')]);
  const fetchImpl = async () => response(null, { status: 404, remaining: '49' });
  const result = await auditFleetManifestAdoption({
    fleetReceipt: receipt,
    token: 'test-token',
    fetchImpl,
  });
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.match(result.failures[0], /safety floor 50/);
});
