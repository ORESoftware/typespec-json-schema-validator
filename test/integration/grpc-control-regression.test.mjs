import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixture = resolve(packageRoot, 'test/fixtures/grpc-control');
const typeSpecPath = resolve(fixture, 'main.tsp');
const authoredSchemaPath = resolve(fixture, 'authored.schema.json');
const mappingPath = resolve(fixture, 'mapping.json');

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

function checkArgs(temp, schemaPath, contractIrPath = join(temp, 'contract-ir.json')) {
  return [
    'check',
    `--typespec=${typeSpecPath}`,
    `--schema=${schemaPath}`,
    `--mapping=${mappingPath}`,
    `--instances=${resolve(fixture, 'instances')}`,
    `--output-dir=${join(temp, 'generated')}`,
    `--report=${join(temp, 'report.json')}`,
    `--contract-ir=${contractIrPath}`,
    '--max-findings=100',
    '--quiet',
  ];
}

function boundedFindingSummary(report) {
  if (!report || !Array.isArray(report.findings)) return [];
  return report.findings.slice(0, 20).map((finding) => ({
    ruleId: typeof finding?.ruleId === 'string' ? finding.ruleId : null,
    comparison: typeof finding?.comparison === 'string' ? finding.comparison : null,
    declaration: typeof finding?.declaration === 'string' ? finding.declaration : null,
    leftRefusal: typeof finding?.left?.name === 'string' ? finding.left.name : null,
    rightRefusal: typeof finding?.right?.name === 'string' ? finding.right.name : null,
  }));
}

async function assertPassedCheck(result, reportPath) {
  if (result.code === 0) return;
  let diagnostic = `TJSV check exited ${result.code}`;
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    diagnostic += `; status=${String(report.status)}; findings=${JSON.stringify(boundedFindingSummary(report))}`;
  } catch {
    diagnostic += '; report unavailable';
  }
  assert.equal(result.code, 0, diagnostic);
}

async function assertStoppedForDrift(mutator, prefix) {
  const temp = await mkdtemp(join(tmpdir(), prefix));
  const authored = JSON.parse(await readFile(authoredSchemaPath, 'utf8'));
  mutator(authored);
  const driftSchemaPath = join(temp, 'authored-drift.schema.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  await writeFile(driftSchemaPath, `${JSON.stringify(authored, null, 2)}\n`);

  const result = await run(checkArgs(temp, driftSchemaPath, contractIrPath));
  assert.equal(result.code, 2, `expected fail-closed exit 2, got ${result.code}`);

  const report = JSON.parse(await readFile(join(temp, 'report.json'), 'utf8'));
  assert.equal(report.schema, 'ores.typespec-json-schema-validator.report/v1');
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(report.zeroUnexplainedFindings, false);
  assert.ok(report.findings.length > 0);

  const ir = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(ir.schema, 'ores.typespec-json-schema-validator.contract-ir/v1');
  assert.equal(ir.status, 'stopped_for_evaluation');
  assert.equal(ir.admissible, false);
  assert.deepEqual(ir.declarations, []);
  assert.equal(ir.admission.receipt.runId, report.runId);
}

test('gRPC authored URN authority keeps $defs inside one schema resource', async () => {
  const authored = JSON.parse(await readFile(authoredSchemaPath, 'utf8'));
  assert.equal(authored.$id, 'urn:oresoftware:grpc-pg-control:v1');
  for (const declaration of Object.values(authored.$defs)) {
    assert.equal(Object.hasOwn(declaration, '$id'), false);
  }
  assert.equal(authored.$defs.Drift.properties.kind.$ref, '#/$defs/DriftKind');
  assert.equal(authored.$defs.CheckTargetSummary.properties.target.$ref, '#/$defs/DatabaseTarget');
});

test('gRPC mapping binds qualified TypeSpec declarations to peer schema identities', async () => {
  const mapping = JSON.parse(await readFile(mappingPath, 'utf8'));
  assert.equal(mapping.schema, 'ores.typespec-json-schema-validator.mapping/v1');
  assert.deepEqual(
    mapping.declarations.map(({ typespec, generated, authored }) => [typespec, generated, authored]),
    [
      ['Ores.GrpcPg.Control.V1.DatabaseTarget', 'DatabaseTarget', 'DatabaseTarget'],
      ['Ores.GrpcPg.Control.V1.DriftKind', 'DriftKind', 'DriftKind'],
      ['Ores.GrpcPg.Control.V1.Drift', 'Drift', 'Drift'],
      ['Ores.GrpcPg.Control.V1.WitnessSummary', 'WitnessSummary', 'WitnessSummary'],
      ['Ores.GrpcPg.Control.V1.CheckTargetSummary', 'CheckTargetSummary', 'CheckTargetSummary'],
    ],
  );
});

test('real-world gRPC control authorities produce clean differential and Contract IR evidence', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tjsv-grpc-control-'));
  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  const result = await run(checkArgs(temp, authoredSchemaPath, contractIrPath));

  await assertPassedCheck(result, reportPath);

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

test('gRPC control admission recovers from a fail-closed tombstone only after peer authority is restored', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tjsv-grpc-control-recovery-'));
  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  const typeSpecBefore = await readFile(typeSpecPath, 'utf8');
  const authoredBefore = await readFile(authoredSchemaPath, 'utf8');
  const mappingBefore = await readFile(mappingPath, 'utf8');

  const initial = await run(checkArgs(temp, authoredSchemaPath, contractIrPath));
  await assertPassedCheck(initial, reportPath);
  const initialReport = JSON.parse(await readFile(reportPath, 'utf8'));
  const initialIr = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(initialReport.status, 'passed');
  assert.equal(initialIr.admissible, true);

  const drifted = JSON.parse(authoredBefore);
  drifted.$defs.CheckTargetSummary.required = drifted.$defs.CheckTargetSummary.required.filter(
    (name) => name !== 'witnessCount',
  );
  const driftSchemaPath = join(temp, 'authored-recovery-drift.schema.json');
  await writeFile(driftSchemaPath, `${JSON.stringify(drifted, null, 2)}\n`);

  const stopped = await run(checkArgs(temp, driftSchemaPath, contractIrPath));
  assert.equal(stopped.code, 2);
  const stoppedReport = JSON.parse(await readFile(reportPath, 'utf8'));
  const stoppedIr = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(stoppedReport.status, 'stopped_for_evaluation');
  assert.equal(stoppedReport.zeroUnexplainedFindings, false);
  assert.ok(stoppedReport.findings.length > 0);
  assert.equal(stoppedIr.status, 'stopped_for_evaluation');
  assert.equal(stoppedIr.admissible, false);
  assert.deepEqual(stoppedIr.declarations, []);
  assert.notEqual(stoppedReport.runId, initialReport.runId);

  const recovered = await run(checkArgs(temp, authoredSchemaPath, contractIrPath));
  await assertPassedCheck(recovered, reportPath);
  const recoveredReport = JSON.parse(await readFile(reportPath, 'utf8'));
  const recoveredIr = JSON.parse(await readFile(contractIrPath, 'utf8'));
  assert.equal(recoveredReport.status, 'passed');
  assert.equal(recoveredReport.zeroUnexplainedFindings, true);
  assert.deepEqual(recoveredReport.findings, []);
  assert.equal(recoveredReport.differential.summary.refusals, 0);
  assert.equal(recoveredReport.differential.summary.divergences, 0);
  assert.equal(recoveredReport.runId, initialReport.runId);
  assert.equal(recoveredIr.status, 'passed');
  assert.equal(recoveredIr.admissible, true);
  assert.deepEqual(recoveredIr.declarations, initialIr.declarations);
  assert.equal(recoveredIr.admission.receipt.runId, recoveredReport.runId);

  assert.equal(await readFile(typeSpecPath, 'utf8'), typeSpecBefore);
  assert.equal(await readFile(authoredSchemaPath, 'utf8'), authoredBefore);
  assert.equal(await readFile(mappingPath, 'utf8'), mappingBefore);
});

test('gRPC control enum drift stops promotion and emits only a non-admissible Contract IR tombstone', async () => {
  await assertStoppedForDrift((authored) => {
    authored.$defs.DriftKind.enum = authored.$defs.DriftKind.enum.filter(
      (value) => value !== 'DRIFT_KIND_CONTRACT_MISMATCH',
    );
  }, 'tjsv-grpc-control-enum-drift-');
});

test('gRPC control requiredness drift stops promotion and emits only a non-admissible Contract IR tombstone', async () => {
  await assertStoppedForDrift((authored) => {
    authored.$defs.Drift.required = authored.$defs.Drift.required.filter((name) => name !== 'actual');
  }, 'tjsv-grpc-control-required-drift-');
});
