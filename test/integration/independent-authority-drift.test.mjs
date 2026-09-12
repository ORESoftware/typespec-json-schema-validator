import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixtures = resolve(packageRoot, 'test/fixtures/pass');
const integrationTempRoot = resolve(packageRoot, 'test/integration');

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: packageRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

async function createTempFixture(t, prefix) {
  // Keep the copied TypeSpec source below packageRoot so normal Node/TypeSpec
  // package resolution can walk up to this checkout's pinned node_modules.
  // These are independently authored peer authorities. TypeSpec is compiled to
  // generated JSON Schema B only as comparison evidence for authored Schema A.
  const temp = await mkdtemp(join(integrationTempRoot, `.tmp-${prefix}-`));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const typespecPath = join(temp, 'main.tsp');
  const schemaPath = join(temp, 'authored.schema.json');
  await copyFile(resolve(fixtures, 'main.tsp'), typespecPath);
  await copyFile(resolve(fixtures, 'authored.schema.json'), schemaPath);
  return { temp, typespecPath, schemaPath };
}

async function runCheck(temp, typespecPath, schemaPath, name) {
  const outputDir = join(temp, `${name}-generated`);
  const reportPath = join(temp, `${name}-report.json`);
  const result = await run([
    'check',
    `--typespec=${typespecPath}`,
    `--schema=${schemaPath}`,
    `--output-dir=${outputDir}`,
    `--report=${reportPath}`,
    '--max-probes=64',
    '--quiet',
  ]);
  let report = null;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    assert.fail(
      `validator did not emit a readable report (exit=${result.code}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}\n${error}`,
    );
  }
  return { result, report };
}

test('TypeSpec-only semantic drift stops while authored JSON Schema remains unchanged', async (t) => {
  const { temp, typespecPath, schemaPath } = await createTempFixture(t, 'typespec-only-drift');

  const schemaBefore = await readFile(schemaPath, 'utf8');
  const typeSpec = await readFile(typespecPath, 'utf8');
  assert.match(typeSpec, /active: boolean;/);
  // Requiredness is deliberately used as the counterexample because it is a
  // direct, normalization-independent JSON Schema semantic: Schema B must drop
  // `active` from required while independently authored Schema A must not move.
  await writeFile(typespecPath, typeSpec.replace('active: boolean;', 'active?: boolean;'));

  const { result, report } = await runCheck(temp, typespecPath, schemaPath, 'typespec-drift');
  assert.equal(result.code, 2, result.stderr || result.stdout);
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(report.zeroUnexplainedFindings, false);
  assert.ok(report.findings.length > 0);
  assert.ok(
    report.findings.some((finding) => String(finding.pointer ?? '').includes('required')),
    JSON.stringify(report.findings),
  );
  assert.equal(await readFile(schemaPath, 'utf8'), schemaBefore, 'JSON Schema authority was modified');
});

test('JSON-Schema-only semantic drift stops while authored TypeSpec remains unchanged', async (t) => {
  const { temp, typespecPath, schemaPath } = await createTempFixture(t, 'json-only-drift');

  const typeSpecBefore = await readFile(typespecPath, 'utf8');
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  assert.equal(schema.$defs.User.properties.id.type, 'string');
  schema.$defs.User.properties.id.type = 'integer';
  await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

  const { result, report } = await runCheck(temp, typespecPath, schemaPath, 'json-schema-drift');
  assert.equal(result.code, 2, result.stderr || result.stdout);
  assert.equal(report.status, 'stopped_for_evaluation');
  assert.equal(report.zeroUnexplainedFindings, false);
  assert.ok(report.findings.length > 0);
  assert.equal(await readFile(typespecPath, 'utf8'), typeSpecBefore, 'TypeSpec authority was modified');
});

test('unchanged independent peer authorities pass and emit Schema B only as evidence', async (t) => {
  const { temp, typespecPath, schemaPath } = await createTempFixture(t, 'independent-authorities-pass');

  const { result, report } = await runCheck(temp, typespecPath, schemaPath, 'peer-baseline');
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.status, 'passed');
  assert.equal(report.zeroUnexplainedFindings, true);
  assert.equal(report.authorities.precedence, 'none');
  assert.equal(report.authorities.typespec.authority, 'independently-authored');
  assert.equal(report.authorities.jsonSchema.authority, 'independently-authored');
  assert.equal(report.authorities.typespec.generatedJsonSchemaRole, 'comparison-evidence-only');
  assert.equal(report.coverage.typespecGeneratedJsonSchemaComparison, true);
  assert.equal(report.coverage.differentialInstanceValidation, true);
  assert.equal(report.differential.summary.divergences, 0);
  assert.ok(report.differential.summary.probesEvaluated > 0);
  assert.equal(report.inputs.typespec.input.endsWith('main.tsp'), true);
  assert.equal(report.inputs.authoredJsonSchema.input.endsWith('authored.schema.json'), true);
});
