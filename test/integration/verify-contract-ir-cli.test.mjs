import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixtures = resolve(packageRoot, 'test/fixtures');

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

async function createPassingArtifacts(temp) {
  const reportPath = join(temp, 'report.json');
  const contractIrPath = join(temp, 'contract-ir.json');
  const outputDir = join(temp, 'generated');
  const result = await run([
    'check',
    `--typespec=${resolve(fixtures, 'pass/main.tsp')}`,
    `--schema=${resolve(fixtures, 'pass/authored.schema.json')}`,
    `--output-dir=${outputDir}`,
    `--report=${reportPath}`,
    `--contract-ir=${contractIrPath}`,
    '--quiet',
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  return {
    report,
    reportPath,
    contractIrPath,
    generatedSchema: report.inputs.generatedJsonSchema.input,
  };
}

function verifyArgs(artifacts, verificationPath, overrides = {}) {
  return [
    'verify-ir',
    `--contract-ir=${artifacts.contractIrPath}`,
    `--parity-receipt=${artifacts.reportPath}`,
    `--typespec=${overrides.typespec ?? resolve(fixtures, 'pass/main.tsp')}`,
    `--generated-schema=${overrides.generatedSchema ?? artifacts.generatedSchema}`,
    `--schema=${overrides.authoredSchema ?? resolve(fixtures, 'pass/authored.schema.json')}`,
    `--verification=${verificationPath}`,
    '--quiet',
  ];
}

test('verify-ir admits only the exact current receipt, IR, and input closure', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-verify-ir-pass-'));
  const artifacts = await createPassingArtifacts(temp);
  const verificationPath = join(temp, 'verification.json');
  const result = await run(verifyArgs(artifacts, verificationPath));
  assert.equal(result.code, 0, result.stderr || result.stdout);

  const contractIr = JSON.parse(await readFile(artifacts.contractIrPath, 'utf8'));
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  assert.equal(verification.status, 'passed');
  assert.equal(verification.admissible, true);
  assert.equal(verification.suppliedIrId, contractIr.irId);
  assert.equal(verification.computedIrId, contractIr.irId);
  assert.equal(verification.expectedIrId, contractIr.irId);
  assert.equal(verification.receiptRunId, artifacts.report.runId);
  assert.match(verification.verificationId, /^[a-f0-9]{64}$/);
});

test('verify-ir replaces prior green verification with failure on stale current inputs', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-verify-ir-stale-'));
  const artifacts = await createPassingArtifacts(temp);
  const verificationPath = join(temp, 'verification.json');
  const passing = await run(verifyArgs(artifacts, verificationPath));
  assert.equal(passing.code, 0, passing.stderr || passing.stdout);

  const staleTypespec = join(temp, 'stale-main.tsp');
  const originalTypespec = await readFile(resolve(fixtures, 'pass/main.tsp'), 'utf8');
  await writeFile(staleTypespec, `${originalTypespec}\n// changed after the parity receipt\n`);
  const stale = await run(verifyArgs(artifacts, verificationPath, {
    typespec: staleTypespec,
  }));
  assert.equal(stale.code, 3, stale.stderr || stale.stdout);
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  assert.equal(verification.status, 'failed');
  assert.equal(verification.admissible, false);
  assert.match(verification.error, /TypeSpec input digest no longer matches the receipt/);
});

test('verify-ir detects tampered IR and never repairs or overwrites its input', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-verify-ir-tamper-'));
  const artifacts = await createPassingArtifacts(temp);
  const contractIr = JSON.parse(await readFile(artifacts.contractIrPath, 'utf8'));
  contractIr.declarations[0].assertionSchema.type = 'integer';
  const tamperedText = `${JSON.stringify(contractIr, null, 2)}\n`;
  await writeFile(artifacts.contractIrPath, tamperedText);

  const verificationPath = join(temp, 'verification.json');
  const result = await run(verifyArgs(artifacts, verificationPath));
  assert.equal(result.code, 3, result.stderr || result.stdout);
  assert.equal(await readFile(artifacts.contractIrPath, 'utf8'), tamperedText);
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  assert.equal(verification.status, 'failed');
  assert.equal(verification.admissible, false);
  assert.notEqual(verification.suppliedIrId, verification.computedIrId);
});

test('verify-ir usage failures never reinterpret the Contract IR input as an output tombstone', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-verify-ir-usage-'));
  const contractIrPath = join(temp, 'contract-ir.json');
  const inputText = '{"this":"is an immutable verification input"}\n';
  await writeFile(contractIrPath, inputText);
  const verificationPath = join(temp, 'verification.json');
  const result = await run([
    'verify-ir',
    `--contract-ir=${contractIrPath}`,
    `--typespec=${resolve(fixtures, 'pass/main.tsp')}`,
    `--generated-schema=${resolve(fixtures, 'equivalent/generated.schema.json')}`,
    `--schema=${resolve(fixtures, 'pass/authored.schema.json')}`,
    `--verification=${verificationPath}`,
    '--quiet',
  ]);
  assert.equal(result.code, 3);
  assert.equal(await readFile(contractIrPath, 'utf8'), inputText);
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  assert.equal(verification.status, 'failed');
  assert.equal(verification.admissible, false);
});

test('usage failure preserves a separately supplied verification destination', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'tsjsv-verify-ir-usage-spaced-'));
  const contractIrPath = join(temp, 'contract-ir.json');
  await writeFile(contractIrPath, '{"immutable":true}\n');
  const verificationPath = join(temp, 'spaced-verification.json');
  const result = await run([
    'verify-ir',
    `--contract-ir=${contractIrPath}`,
    `--typespec=${resolve(fixtures, 'pass/main.tsp')}`,
    `--generated-schema=${resolve(fixtures, 'equivalent/generated.schema.json')}`,
    `--schema=${resolve(fixtures, 'pass/authored.schema.json')}`,
    '--verification',
    verificationPath,
    '--quiet',
  ]);
  assert.equal(result.code, 3);
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  assert.equal(verification.status, 'failed');
  assert.equal(verification.admissible, false);
});
