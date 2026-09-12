import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalStringify } from '../../src/canonical.mjs';
import { crossValidate } from '../../src/differential.mjs';
import { loadSchemaCollection } from '../../src/json-schema.mjs';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const ALIASES = ['/api/docs', '/api-docs', '/api-docs/', '/api-docs.json'];

function docsSchema({ bounded }) {
  const aliases = {
    type: 'array',
    prefixItems: ALIASES.map((value) => ({ type: 'string', const: value })),
  };
  if (bounded) {
    aliases.minItems = 4;
    aliases.maxItems = 4;
  }
  return {
    $schema: DIALECT,
    $defs: {
      DocsProjectionRoutes: {
        type: 'object',
        required: ['openapi', 'openrpc', 'connect'],
        properties: {
          openapi: { type: 'string', const: '/openapi.json' },
          openrpc: { type: 'string', const: '/openrpc.json' },
          connect: { type: 'string', const: '/connect.json' },
        },
        unevaluatedProperties: false,
      },
      DocsDiscoveryManifest: {
        type: 'object',
        required: [
          'schemaVersion', 'service', 'contractSha256', 'routeCount',
          'discovery', 'html', 'catalog', 'projections', 'aliases',
        ],
        properties: {
          schemaVersion: { type: 'string', const: '1.0.0' },
          service: { type: 'string', minLength: 1, maxLength: 128 },
          contractSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          routeCount: { type: 'integer', minimum: 1 },
          discovery: { type: 'string', const: '/api-docs/manifest.json' },
          html: { type: 'string', const: '/docs/api' },
          catalog: { type: 'string', const: '/api/docs.json' },
          projections: { $ref: '#/$defs/DocsProjectionRoutes' },
          aliases,
        },
        unevaluatedProperties: false,
      },
    },
  };
}

test('nested tuple cardinality drift cannot be starved by richer object probes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-nested-array-cardinality-'));
  const generatedPath = join(root, 'generated.schema.json');
  const authoredPath = join(root, 'authored.schema.json');
  await writeFile(generatedPath, `${JSON.stringify(docsSchema({ bounded: false }), null, 2)}\n`);
  await writeFile(authoredPath, `${JSON.stringify(docsSchema({ bounded: true }), null, 2)}\n`);

  const [generatedCollection, authoredCollection] = await Promise.all([
    loadSchemaCollection(generatedPath, { requireDialect: true }),
    loadSchemaCollection(authoredPath, { requireDialect: true }),
  ]);
  const result = crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap: [
      {
        typespec: 'Ores.ApiDocs.DocsDiscoveryManifest',
        generated: 'DocsDiscoveryManifest',
        authored: 'DocsDiscoveryManifest',
      },
      {
        typespec: 'Ores.ApiDocs.DocsProjectionRoutes',
        generated: 'DocsProjectionRoutes',
        authored: 'DocsProjectionRoutes',
      },
    ],
    maxProbes: 64,
  });

  const divergences = result.findings.filter(
    (finding) => finding.ruleId === 'instance-verdict-divergence'
      && finding.declaration === 'DocsDiscoveryManifest',
  );
  assert.ok(
    divergences.some((finding) => {
      const aliases = finding.witness?.instance?.aliases;
      return Array.isArray(aliases)
        && [3, 5].includes(aliases.length)
        && finding.left.valid !== finding.right.valid;
    }),
    `expected a nested aliases length-3/5 witness, got ${canonicalStringify({
      summary: result.summary,
      declarations: result.declarations,
      findings: divergences,
    })}`,
  );
});
