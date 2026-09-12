import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalStringify } from '../../src/canonical.mjs';
import { crossValidate } from '../../src/differential.mjs';
import { loadSchemaCollection } from '../../src/json-schema.mjs';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

function tupleSchema({ bounded }) {
  const tuple = {
    type: 'array',
    prefixItems: [
      { type: 'string', const: '/api/docs' },
      { type: 'string', const: '/api-docs' },
      { type: 'string', const: '/api-docs/' },
      { type: 'string', const: '/api-docs.json' },
    ],
  };
  if (bounded) {
    tuple.minItems = 4;
    tuple.maxItems = 4;
  }
  return {
    $schema: DIALECT,
    $defs: { RouteAliases: tuple },
  };
}

test('differential probing witnesses tuple cardinality drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-array-cardinality-'));
  const generatedPath = join(root, 'generated.schema.json');
  const authoredPath = join(root, 'authored.schema.json');
  await writeFile(generatedPath, `${JSON.stringify(tupleSchema({ bounded: false }), null, 2)}\n`);
  await writeFile(authoredPath, `${JSON.stringify(tupleSchema({ bounded: true }), null, 2)}\n`);

  const [generatedCollection, authoredCollection] = await Promise.all([
    loadSchemaCollection(generatedPath, { requireDialect: true }),
    loadSchemaCollection(authoredPath, { requireDialect: true }),
  ]);
  const result = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: [{
      typespec: 'Example.RouteAliases',
      generated: 'RouteAliases',
      authored: 'RouteAliases',
    }],
    maxProbes: 64,
  });

  assert.ok(result.summary.divergences > 0, canonicalStringify(result));
  const divergences = result.findings.filter(
    (finding) => finding.ruleId === 'instance-verdict-divergence',
  );
  assert.ok(divergences.length > 0, canonicalStringify(result.findings));
  assert.ok(
    divergences.some((finding) =>
      Array.isArray(finding.witness?.instance)
      && [3, 5].includes(finding.witness.instance.length)),
    `expected a length-3 or length-5 tuple witness, got ${canonicalStringify(divergences)}`,
  );
  for (const finding of divergences) {
    assert.notEqual(finding.left.valid, finding.right.valid);
  }
});
