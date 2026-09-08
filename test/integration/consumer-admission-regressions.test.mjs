import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
test('real compiler and canonical verifier: seven refusals; stale positive receipt is replaced', async () => {
  // Repository-local temp sources resolve the lockfile-installed TypeSpec emitter.
  const dir = await mkdtemp(join(root, '.consumer-regression-'));
  try {
    const typespec = join(dir, 'main.tsp');
    const schema = join(dir, 'authored.schema.json');
    const report = join(dir, 'report.json');
    const ir = join(dir, 'contract-ir.json');
    const generated = join(dir, 'generated');
    const verification = join(dir, 'verification.json');
    await writeFile(typespec, 'import "@typespec/json-schema";\nusing TypeSpec.JsonSchema;\nnamespace AdmissionRegression;\n@id("Item")\nmodel Item { id: string; }\n');
    await writeFile(schema, JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: { Item: { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'Item',
        type: 'object', properties: { id: { type: 'string' } }, required: ['id'], unevaluatedProperties: false } },
    }));
    const compiled = spawnSync(process.execPath, [resolve(root, 'bin/typespec-json-schema-validator.mjs'),
      'check', `--typespec=${typespec}`, `--schema=${schema}`, `--report=${report}`,
      `--contract-ir=${ir}`, `--output-dir=${generated}`, '--quiet'],
      { cwd: root, encoding: 'utf8', timeout: 120000 });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const env = { ...process.env, GITHUB_WORKSPACE: dir,
      TSJSV_VERIFY_IR: ir, TSJSV_VERIFY_REPORT: report, TSJSV_VERIFY_TYPESPEC: typespec,
      TSJSV_VERIFY_AUTHORED: schema, TSJSV_VERIFY_GENERATED: join(generated, 'typespec.generated.schema.json'),
      TSJSV_VERIFY_DECLARATIONS: '["AdmissionRegression.Item"]', TSJSV_VERIFY_VERIFICATION: verification };
    const run = () => spawnSync(process.execPath, [resolve(root, 'scripts/test-consumer-admission.mjs')],
      { cwd: root, env, encoding: 'utf8', timeout: 120000 });
    const passed = run();
    assert.equal(passed.status, 0, passed.stderr || passed.stdout);
    assert.equal(JSON.parse(passed.stdout).negativeCasesPassed, 7);
    assert.equal(JSON.parse(await readFile(verification, 'utf8')).status, 'passed');
    const altered = JSON.parse(await readFile(ir, 'utf8'));
    altered.irId = '0'.repeat(64);
    await writeFile(ir, JSON.stringify(altered));
    const failed = run();
    assert.equal(failed.status, 2);
    assert.equal(JSON.parse(await readFile(verification, 'utf8')).status, 'failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
