import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const executable = join(root, 'bin/typespec-json-schema-validator.mjs');
const runner = join(root, 'scripts/verify-language-boundaries.mjs');

function evidence(report, contractIr, overrides = {}) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language: 'rust',
    runtime: 'native',
    status: 'passed',
    sourceRevision: 'c'.repeat(40),
    artifactDigest: `sha256:${'1'.repeat(64)}`,
    receiptRunId: report.runId,
    contractIrId: contractIr.irId,
    toolchain: { name: 'rustc', version: '1.95.0' },
    generator: { name: 'fixture-generator', version: '1.0.0' },
    validation: { ingress: 'passed', egress: 'passed' },
    ...overrides,
  };
}

test('language-boundary action entrypoint proves current-input closure and fails closed on evidence drift', async (t) => {
  await mkdir(join(root, 'tmp'), { recursive: true });
  const temp = await mkdtemp(join(root, 'tmp/language-boundary-action-'));
  t.after(() => rm(temp, { recursive: true, force: true }));

  const typespec = join(temp, 'main.tsp');
  const authored = join(temp, 'authored.schema.json');
  await copyFile(join(root, 'test/fixtures/pass/main.tsp'), typespec);
  await copyFile(join(root, 'test/fixtures/pass/authored.schema.json'), authored);

  const generated = join(temp, 'generated');
  const reportPath = join(temp, 'report.json');
  const irPath = join(temp, 'contract-ir.json');
  const compilation = spawnSync(process.execPath, [
    executable,
    'check',
    `--typespec=${typespec}`,
    `--schema=${authored}`,
    `--output-dir=${generated}`,
    `--report=${reportPath}`,
    `--contract-ir=${irPath}`,
    '--quiet',
  ], { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.equal(compilation.status, 0, compilation.stderr || compilation.stdout);

  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const contractIr = JSON.parse(await readFile(irPath, 'utf8'));
  const manifestPath = join(temp, 'manifest.json');
  const evidenceRoot = join(temp, 'evidence');
  const rustEvidence = join(evidenceRoot, 'rust/native.json');
  const verification = join(temp, 'language-boundary-verification.json');
  await mkdir(join(evidenceRoot, 'rust'), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({
    schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
    minimumDistinctLanguages: 1,
    authorities: {
      typeSpec: 'peer',
      jsonSchema: 'peer',
      generatedWitness: 'evidence_only',
    },
    targets: [{
      language: 'rust',
      runtime: 'native',
      required: true,
      ingress: true,
      egress: true,
      evidence: 'rust/native.json',
    }],
  }));
  await writeFile(rustEvidence, JSON.stringify(evidence(report, contractIr)));

  const env = {
    ...process.env,
    GITHUB_WORKSPACE: root,
    TSJSV_BOUNDARY_TYPESPEC: typespec,
    TSJSV_BOUNDARY_GENERATED_SCHEMA: generated,
    TSJSV_BOUNDARY_AUTHORED_SCHEMA: authored,
    TSJSV_BOUNDARY_PARITY_REPORT: reportPath,
    TSJSV_BOUNDARY_CONTRACT_IR: irPath,
    TSJSV_BOUNDARY_MANIFEST: manifestPath,
    TSJSV_BOUNDARY_EVIDENCE_ROOT: evidenceRoot,
    TSJSV_BOUNDARY_VERIFICATION: verification,
  };
  const run = (overrides = {}) => spawnSync(process.execPath, [runner], {
    cwd: root,
    env: { ...env, ...overrides },
    encoding: 'utf8',
    timeout: 120000,
  });

  const accepted = run();
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  const stdout = JSON.parse(accepted.stdout);
  const receipt = JSON.parse(await readFile(verification, 'utf8'));
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.zeroUnexplainedFindings, true);
  assert.equal(receipt.counts.admittedEvidence, 1);
  assert.deepEqual(stdout, receipt);

  await writeFile(rustEvidence, JSON.stringify(evidence(report, contractIr, {
    validation: { ingress: 'failed', egress: 'passed' },
  })));
  const rejected = run();
  assert.equal(rejected.status, 2, rejected.stdout || rejected.stderr);
  const stopped = JSON.parse(await readFile(verification, 'utf8'));
  assert.equal(stopped.status, 'stopped_for_evaluation');
  assert.equal(stopped.zeroUnexplainedFindings, false);
  assert.ok(stopped.findings.some((finding) => finding.ruleId === 'boundary-ingress-not-verified'));

  const outside = resolve(root, '..', 'not-admitted-evidence');
  assert.equal(run({ TSJSV_BOUNDARY_EVIDENCE_ROOT: outside }).status, 2);
});
