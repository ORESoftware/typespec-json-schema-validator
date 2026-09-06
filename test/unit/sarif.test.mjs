import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  SARIF_SCHEMA,
  SARIF_TOOL_NAME,
  SARIF_VERSION,
  serializeSarif,
  toSarif,
  writeSarif,
} from '../../src/sarif.mjs';
import { UnsafeSarifDestinationError } from '../../src/sarif-file.mjs';

const runId = 'a'.repeat(64);
const findingFingerprint = 'b'.repeat(64);

function report(overrides = {}) {
  return {
    schema: 'ores.typespec-json-schema-validator.report/v1',
    runId,
    status: 'stopped_for_evaluation',
    zeroUnexplainedFindings: false,
    toolchain: { validator: { version: '0.1.0' } },
    inputs: {
      typespec: { input: 'contracts/main.tsp' },
      authoredJsonSchema: { input: 'contracts/authored.schema.json' },
      generatedJsonSchema: { input: '.typespec-json-schema-validator/generated/typespec.generated.schema.json' },
    },
    findings: [{
      ruleId: 'generated-authored-semantic-mismatch',
      severity: 'error',
      resolutionState: 'unexplained',
      comparison: 'typespec-generated-vs-authored-json-schema',
      declaration: 'Accounts.User',
      pointer: '#/$defs/User/properties/id/type',
      message: 'secret schema content token=do-not-copy https://private.example.test',
      left: { token: 'do-not-copy' },
      right: { password: 'do-not-copy' },
      witness: { instance: { apiKey: 'do-not-copy' } },
      fingerprint: findingFingerprint,
    }],
    ...overrides,
  };
}

test('emits deterministic SARIF 2.1.0 with stable TSJSV rule identifiers', () => {
  const first = serializeSarif(report());
  const second = serializeSarif(report());
  assert.equal(first, second);

  const value = JSON.parse(first);
  assert.equal(value.version, SARIF_VERSION);
  assert.equal(value.$schema, SARIF_SCHEMA);
  assert.equal(value.runs[0].tool.driver.name, SARIF_TOOL_NAME);
  assert.equal(value.runs[0].tool.driver.rules[0].id, 'TSJSV.generated-authored-semantic-mismatch');
  assert.equal(value.runs[0].results[0].ruleId, 'TSJSV.generated-authored-semantic-mismatch');
  assert.equal(value.runs[0].results[0].partialFingerprints['tsjsv/v1'], findingFingerprint);
  assert.equal(value.runs[0].properties.authoritativeReceipt, 'JSON');
  assert.equal(value.runs[0].properties.presentationOnly, true);
});

test('omits schema values, witness instances, hostnames, and timestamps from SARIF', () => {
  const serialized = serializeSarif(report());
  assert.doesNotMatch(serialized, /do-not-copy/u);
  assert.doesNotMatch(serialized, /private\.example\.test/u);
  assert.doesNotMatch(serialized, /"left"|"right"|"witness"|"instance"/u);
  assert.doesNotMatch(serialized, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
});

test('attaches an authored primary location and generated related location', () => {
  const result = toSarif(report()).runs[0].results[0];
  assert.equal(result.locations[0].physicalLocation.artifactLocation.uri, 'contracts/authored.schema.json');
  assert.equal(result.locations[0].properties.jsonPointer, '#/$defs/User/properties/id/type');
  assert.equal(
    result.relatedLocations[0].physicalLocation.artifactLocation.uri,
    '.typespec-json-schema-validator/generated/typespec.generated.schema.json',
  );
});

test('passed receipts produce a valid empty result set', () => {
  const value = toSarif(report({ status: 'passed', zeroUnexplainedFindings: true, findings: [] }));
  assert.deepEqual(value.runs[0].results, []);
  assert.equal(value.runs[0].invocations[0].executionSuccessful, true);
  assert.equal(value.runs[0].invocations[0].exitCode, 0);
});

test('failed receipts produce a bounded synthetic failure result', () => {
  const value = toSarif(report({ status: 'failed', findings: [] }));
  assert.equal(value.runs[0].results[0].ruleId, 'TSJSV.run-failed');
  assert.equal(value.runs[0].invocations[0].executionSuccessful, false);
  assert.equal(value.runs[0].invocations[0].exitCode, 3);
  assert.doesNotMatch(JSON.stringify(value), /do-not-copy/u);
});

test('safe SARIF writer replaces only validator-owned SARIF', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-sarif-'));
  const path = join(root, 'result.sarif');
  await writeSarif(path, report());
  const first = await readFile(path, 'utf8');
  await writeSarif(path, report({ status: 'passed', zeroUnexplainedFindings: true, findings: [] }));
  const second = await readFile(path, 'utf8');
  assert.notEqual(first, second);
  assert.equal(JSON.parse(second).runs[0].properties.reportStatus, 'passed');

  const source = join(root, 'source.json');
  await writeFile(source, '{"authored":true}\n', 'utf8');
  await assert.rejects(() => writeSarif(source, report()), UnsafeSarifDestinationError);
  assert.equal(await readFile(source, 'utf8'), '{"authored":true}\n');

  const symlinkPath = join(root, 'symlink.sarif');
  await symlink(path, symlinkPath);
  await assert.rejects(() => writeSarif(symlinkPath, report()), UnsafeSarifDestinationError);
});
