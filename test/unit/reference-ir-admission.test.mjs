import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildContractIr, verifyContractIr } from '../../src/contract-ir.mjs';
import { JSON_SCHEMA_DRAFT_2020_12 } from '../../src/json-schema.mjs';
import { runCompare } from '../../src/run.mjs';

async function inputs(generated, authored, source) {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-reference-ir-'));
  const paths = { typespec: join(root, 'main.tsp'), generatedSchema: join(root, 'generated.json'), authoredSchema: join(root, 'authored.json') };
  await writeFile(paths.typespec, source);
  await writeFile(paths.generatedSchema, JSON.stringify(generated));
  await writeFile(paths.authoredSchema, JSON.stringify(authored));
  return paths;
}

function document(id) {
  return {
    $schema: JSON_SCHEMA_DRAFT_2020_12, $id: 'https://example.test/root.json',
    $defs: {
      Value: { type: 'string' },
      Payload: {
        ...(id ? { $id: id } : {}), type: 'object',
        properties: { value: { $ref: '#/$defs/Value' } }, required: ['value'],
        $defs: { Value: { type: 'integer' } },
      },
    },
  };
}

// Model a previously false-green receipt with its exact current source closure.
// Admission must recheck semantics; self-consistent digests alone are insufficient.
function legacyPassedReceipt(stopped) {
  return {
    ...stopped, status: 'passed', zeroUnexplainedFindings: true, findings: [],
    counts: { ...stopped.counts, structuralFindings: 0, differentialFindings: 0, findings: 0, findingsTruncated: false },
    differential: { ...stopped.differential, summary: { ...stopped.differential.summary, refusals: 0, divergences: 0 } },
  };
}

test('a legacy false-green scope receipt cannot build an admissible Contract IR', async () => {
  const paths = await inputs(document(), document('nested.json'), 'namespace Demo; scalar Value extends string; model Payload { value: Value; }');
  const report = legacyPassedReceipt(await runCompare(paths));
  await assert.rejects(buildContractIr({ ...paths, report }), /reference|converge/iu);
});

test('a legacy false-green cyclic receipt cannot build an admissible Contract IR', async () => {
  const schema = { $schema: JSON_SCHEMA_DRAFT_2020_12, $defs: { Loop: { not: { $ref: '#/$defs/Loop' } } } };
  const paths = await inputs(schema, schema, 'scalar Loop extends string;');
  const report = legacyPassedReceipt(await runCompare(paths));
  await assert.rejects(buildContractIr({ ...paths, report }), /differential|evaluation|converge/iu);
});

test('IR admission and verification share resource-aware parity for equivalent pointer encodings', async () => {
  const authored = document('independent/payload.json');
  authored.$defs.Payload.properties.value.$ref = '#/%24defs/Value';
  const paths = await inputs(document('generated/payload.json'), authored, 'namespace Demo; scalar Value extends string; model Payload { value: Value; }');
  const report = await runCompare(paths);
  assert.equal(report.status, 'passed', JSON.stringify(report.findings));
  const contractIr = await buildContractIr({ ...paths, report });
  assert.equal(contractIr.admissible, true);
  assert.equal((await verifyContractIr({ ...paths, report, contractIr })).admissible, true);
});
