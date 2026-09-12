import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixture = resolve(packageRoot, 'test/fixtures/canonical-security-offerings');

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

test('canonical security-offering peer authorities admit the exact six-instance corpus', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-canonical-security-offerings-'));
  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  const generatedPath = join(temp, 'generated', 'typespec.generated.schema.json');
  const result = await run([
    'check',
    `--typespec=${resolve(fixture, 'main.tsp')}`,
    `--schema=${resolve(fixture, 'authored.schema.json')}`,
    `--instances=${resolve(fixture, 'instances')}`,
    `--output-dir=${join(temp, 'generated')}`,
    `--report=${reportPath}`,
    `--contract-ir=${contractIrPath}`,
    '--quiet',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const contractIr = JSON.parse(await readFile(contractIrPath, 'utf8'));
  const generated = JSON.parse(await readFile(generatedPath, 'utf8'));

  assert.equal(report.status, 'passed');
  assert.equal(report.zeroUnexplainedFindings, true);
  assert.equal(report.authorities.typespec.authority, 'independently-authored');
  assert.equal(report.authorities.jsonSchema.authority, 'independently-authored');
  assert.equal(report.authorities.precedence, 'none');
  assert.equal(report.authorities.typespec.generatedJsonSchemaRole, 'comparison-evidence-only');
  assert.equal(report.coverage.typespecGeneratedJsonSchemaComparison, true);
  assert.equal(report.coverage.differentialInstanceValidation, true);
  assert.equal(report.differential.summary.corpusInstances, 6);
  assert.equal(report.differential.summary.divergences, 0);

  assert.equal(contractIr.schema, 'ores.typespec-json-schema-validator.contract-ir/v1');
  assert.equal(contractIr.status, 'passed');
  assert.equal(contractIr.admissible, true);
  assert.equal(contractIr.editableAuthority, false);
  assert.equal(contractIr.authorities.typespec, 'independently-authored');
  assert.equal(contractIr.authorities.jsonSchema, 'independently-authored');
  assert.equal(contractIr.authorities.generatedJsonSchema, 'comparison-evidence-only');
  assert.equal(contractIr.authorities.precedence, 'none');
  assert.equal(contractIr.admission.receipt.runId, report.runId);
  assert.equal(contractIr.declarations.length, 8);
  assert.equal(generated.$schema, 'https://json-schema.org/draft/2020-12/schema');
});
