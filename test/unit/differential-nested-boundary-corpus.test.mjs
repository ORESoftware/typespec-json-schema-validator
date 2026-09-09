import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalStringify } from '../../src/canonical.mjs';
import { crossValidate, loadInstanceCorpus } from '../../src/differential.mjs';
import { loadSchemaCollection } from '../../src/json-schema.mjs';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

function schema({ strictNestedBoundaries }) {
  const tags = {
    type: 'array',
    maxItems: 100,
    items: strictNestedBoundaries
      ? { type: 'string', minLength: 1, maxLength: 128 }
      : { type: 'string' },
  };
  if (strictNestedBoundaries) {
    tags.uniqueItems = true;
  }

  return {
    $schema: DIALECT,
    $id: strictNestedBoundaries ? 'authored.schema.json' : 'generated.schema.json',
    $defs: {
      TicketSnapshot: {
        type: 'object',
        properties: {
          protocol: { const: 'ores.chat.support/v1', type: 'string' },
          tags,
          custom_fields: {
            type: 'object',
            ...(strictNestedBoundaries ? { maxProperties: 100 } : {}),
            additionalProperties: strictNestedBoundaries
              ? { type: 'string', maxLength: 4096 }
              : { type: 'string' },
          },
        },
        required: ['protocol', 'tags', 'custom_fields'],
        unevaluatedProperties: false,
      },
    },
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

test('explicit corpus witnesses nested collection and record boundary drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-nested-boundaries-'));
  const authoredPath = join(root, 'authored.schema.json');
  const generatedPath = join(root, 'generated.schema.json');
  await writeJson(authoredPath, schema({ strictNestedBoundaries: true }));
  await writeJson(generatedPath, schema({ strictNestedBoundaries: false }));

  const invalid = join(root, 'instances', 'TicketSnapshot', 'invalid');
  await mkdir(invalid, { recursive: true });
  const base = { protocol: 'ores.chat.support/v1', tags: ['alpha'], custom_fields: {} };
  const cases = {
    'duplicate-tags.json': { ...base, tags: ['alpha', 'alpha'] },
    'empty-tag.json': { ...base, tags: [''] },
    'overlong-tag.json': { ...base, tags: ['x'.repeat(129)] },
    'too-many-custom-fields.json': {
      ...base,
      custom_fields: Object.fromEntries(
        Array.from({ length: 101 }, (_, index) => [`field_${String(index).padStart(3, '0')}`, 'ok']),
      ),
    },
    'overlong-custom-field-value.json': {
      ...base,
      custom_fields: { note: 'x'.repeat(4097) },
    },
  };
  for (const [name, instance] of Object.entries(cases)) {
    await writeJson(join(invalid, name), instance);
  }

  const [authoredCollection, generatedCollection, corpus] = await Promise.all([
    loadSchemaCollection(authoredPath, { requireDialect: true }),
    loadSchemaCollection(generatedPath, { requireDialect: true }),
    loadInstanceCorpus(join(root, 'instances')),
  ]);

  const result = crossValidate({
    authoredCollection,
    generatedCollection,
    declarationMap: [{
      typespec: 'Ores.Chat.Support.V1.TicketSnapshot',
      generated: 'TicketSnapshot',
      authored: 'TicketSnapshot',
    }],
    corpus,
    maxProbes: 128,
  });

  assert.equal(result.summary.corpusInstances, 5);
  assert.equal(result.summary.refusals, 0, canonicalStringify(result.findings));

  const corpusDivergences = result.findings.filter(
    (finding) => finding.ruleId === 'instance-verdict-divergence'
      && finding.witness?.origin === 'corpus',
  );
  assert.equal(corpusDivergences.length, 5, canonicalStringify(result.findings));

  const witnessedSources = new Set(
    corpusDivergences.map((finding) => finding.witness.probeId.replace(/^corpus:/u, '')),
  );
  for (const name of Object.keys(cases)) {
    assert.ok(
      witnessedSources.has(`TicketSnapshot/invalid/${name}`),
      `missing differential witness for ${name}: ${canonicalStringify(corpusDivergences)}`,
    );
  }

  for (const finding of corpusDivergences) {
    assert.equal(finding.left.valid, false, canonicalStringify(finding));
    assert.equal(finding.right.valid, true, canonicalStringify(finding));
    assert.equal(finding.witness.synthesisComplete, true);
  }
});
