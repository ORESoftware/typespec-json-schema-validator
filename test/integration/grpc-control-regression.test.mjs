import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixture = resolve(packageRoot, 'test/fixtures/grpc-control');

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: packageRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

test('real-world gRPC control authorities produce clean differential and Contract IR evidence', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tjsv-grpc-control-'));
  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  const result = await run([
    'check',
    `--typespec=${resolve(fixture, 'main.tsp')}`,
    `--schema=${resolve(fixture, 'authored.schema.json')}`,
    `--instances=${resolve(fixture, 'instances')}`,
    `--output-dir=${join(temp, 'generated')}`,
    `--report=${reportPath}`,
    `--contract-ir=${contractIrPath}`,
    '--max-findings=100',
    '--quiet',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.schema, 'ores.typespec-json-schema-validator.report/v1');
  assert.equal(report.status, 'passed');
  assert.equal(report.zeroUnexplainedFindings, true);
  assert.deepEqual(report.findings, []);
  assert.ok(report.differential.summary.probesEvaluated > 0);
  assert.ok(report.differential.summary.corpusInstances >= 10);
  assert.equal(report.differential.summary.divergences, 0);
  assert.equal(report.differential.summary.refusals, 0);

  const ir = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(ir.schema, 'ores.typespec-json-schema-validator.contract-ir/v1');
  assert.equal(ir.status, 'passed');
  assert.equal(ir.admissible, true);
  assert.deepEqual(
    ir.declarations.map((declaration) => declaration.names.authoredJsonSchema).sort(),
    ['CheckTargetSummary', 'DatabaseTarget', 'Drift', 'DriftKind', 'WitnessSummary'].sort(),
  );
});
