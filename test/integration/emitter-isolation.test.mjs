import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const packageRoot = resolve(import.meta.dirname, '../..');
const executable = resolve(packageRoot, 'bin/typespec-json-schema-validator.mjs');
const fixtures = resolve(packageRoot, 'test/fixtures/pass');

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

test('explicit JSON Schema emitter excludes project-configured OpenAPI emitters', async (t) => {
  // Keep the fixture below packageRoot so the normal tsp subprocess can resolve
  // the lockfile-pinned TypeSpec libraries by walking up to packageRoot/node_modules.
  // A system tmp directory would exercise TJSV's pinned-compiler fallback instead.
  const temp = await mkdtemp(join(packageRoot, 'test', 'tmp-emitter-isolation-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const typespec = join(temp, 'main.tsp');
  const authored = join(temp, 'authored.schema.json');
  const report = join(temp, 'report.json');
  const generated = join(temp, 'generated');

  await copyFile(resolve(fixtures, 'main.tsp'), typespec);
  await copyFile(resolve(fixtures, 'authored.schema.json'), authored);

  // @typespec/openapi3 is deliberately not installed by TJSV. If tspconfig emitters
  // are additive to the explicit CLI --emit, the subprocess must fail resolution
  // and TJSV will fall back to its pinned in-process compiler. Requiring normal
  // subprocess mode proves the configured emitter was not activated.
  await writeFile(join(temp, 'tspconfig.yaml'), [
    'emit:',
    '  - "@typespec/openapi3"',
    'options:',
    '  "@typespec/openapi3":',
    '    emitter-output-dir: "{output-dir}/../should-not-exist"',
    '',
  ].join('\n'));

  const result = await run([
    'check',
    `--typespec=${typespec}`,
    `--schema=${authored}`,
    `--output-dir=${generated}`,
    `--report=${report}`,
    '--quiet',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.configuration.executionMode, 'subprocess');
  assert.equal(receipt.configuration.emitter, '@typespec/json-schema');
});
