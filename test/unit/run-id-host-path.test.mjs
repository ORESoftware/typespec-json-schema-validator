import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  runCheck,
  runIdentityConfiguration,
  runIdentityToolchain,
} from '../../src/run.mjs';

const fixtures = resolve(import.meta.dirname, '../fixtures');

function identityConfiguration(outputDir, instanceCorpus, executionMode = 'subprocess') {
  return {
    mode: 'check',
    maxFindings: 250,
    bundleId: 'typespec.generated.schema.json',
    emitter: '@typespec/json-schema',
    emitterOptions: {
      'emitter-output-dir': outputDir,
      'file-type': 'json',
      bundleId: 'typespec.generated.schema.json',
      emitAllModels: 'true',
      emitAllRefs: 'true',
      'int64-strategy': 'string',
      'seal-object-schemas': 'true',
      'polymorphic-models-strategy': 'oneOf',
    },
    executionMode,
    mappingSchema: 'ores.typespec-json-schema-validator.mapping/v1',
    differential: {
      enabled: true,
      maxProbesPerDeclarationPerLane: 64,
      formatAssertion: false,
      instanceCorpus,
      instanceCorpusDigest: 'a'.repeat(64),
    },
  };
}

test('run identity excludes host paths and execution mechanism but keeps semantic emitter options', () => {
  const linux = identityConfiguration(
    '/home/runner/work/_temp/ores-public-admission-a/witness',
    '/home/runner/work/_temp/ores-public-admission-a/instances',
    'subprocess',
  );
  const mac = identityConfiguration(
    '/Users/runner/work/_temp/ores-public-admission-b/witness',
    '/Users/runner/work/_temp/ores-public-admission-b/instances',
    'pinned-compiler-fallback',
  );

  assert.notDeepEqual(linux, mac, 'diagnostic configurations should retain invocation details');
  assert.deepEqual(
    runIdentityConfiguration(linux),
    runIdentityConfiguration(mac),
    'receipt identity must not include output/corpus locations or execution mechanism',
  );

  const changedSemantics = structuredClone(mac);
  changedSemantics.emitterOptions['seal-object-schemas'] = 'false';
  assert.notDeepEqual(
    runIdentityConfiguration(linux),
    runIdentityConfiguration(changedSemantics),
    'semantic emitter options must remain identity-bearing',
  );
});

test('run identity excludes compiler executable location but keeps compiler version', () => {
  const linux = {
    validator: { name: '@oresoftware/typespec-json-schema-validator', version: '0.1.0' },
    typespecCompiler: {
      command: '/home/runner/work/repo/node_modules/@typespec/compiler/cmd/tsp.js',
      available: true,
      version: '1.16.0',
    },
    jsonSchemaEmitter: '@typespec/json-schema',
  };
  const mac = {
    ...linux,
    typespecCompiler: {
      command: '/Users/runner/work/repo/node_modules/@typespec/compiler/cmd/tsp.js',
      available: true,
      version: '1.16.0',
    },
  };

  assert.deepEqual(runIdentityToolchain(linux), runIdentityToolchain(mac));
  assert.notDeepEqual(
    runIdentityToolchain(linux),
    runIdentityToolchain({
      ...mac,
      typespecCompiler: { ...mac.typespecCompiler, version: '1.17.0' },
    }),
    'compiler version remains identity-bearing',
  );
});

test('check-mode runId is stable across independently-created output directories', async () => {
  const fixture = resolve(fixtures, 'pass');
  const typespec = resolve(fixture, 'main.tsp');
  const authoredSchema = resolve(fixture, 'authored.schema.json');
  const tspBin = resolve(import.meta.dirname, '../helpers/fake-tsp.mjs');
  const firstOutput = await mkdtemp(join(tmpdir(), 'tjsv-output-location-a-'));
  const secondOutput = await mkdtemp(join(tmpdir(), 'tjsv-output-location-b-'));

  const options = (outputDir) => ({
    typespec,
    authoredSchema,
    outputDir,
    bundleId: 'typespec.generated.schema.json',
    maxFindings: 250,
    tspBin,
    int64Strategy: 'string',
    sealObjectSchemas: true,
    polymorphicModelsStrategy: 'oneOf',
  });

  const first = await runCheck(options(firstOutput));
  const second = await runCheck(options(secondOutput));
  assert.equal(first.status, 'passed');
  assert.equal(second.status, 'passed');
  assert.notEqual(
    first.configuration.emitterOptions['emitter-output-dir'],
    second.configuration.emitterOptions['emitter-output-dir'],
    'diagnostic output locations should remain visible',
  );
  assert.equal(first.runId, second.runId, 'receipt identity must be output-location independent');
});
