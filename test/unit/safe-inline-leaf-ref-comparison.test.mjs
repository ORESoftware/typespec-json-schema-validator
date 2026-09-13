import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalStringify } from '../../src/canonical.mjs';
import { extractSchemaDeclarations, JSON_SCHEMA_DRAFT_2020_12, validateJsonSchemaDocument } from '../../src/json-schema.mjs';
import { compareParity } from '../../src/parity.mjs';

function collection(document, path) {
  return {
    documents: [{ document, path }],
    declarations: extractSchemaDeclarations(document, path),
    findings: validateJsonSchemaDocument(document),
  };
}

function compare(generated, authored) {
  const generatedCollection = collection(generated, 'generated.json');
  return compareParity({
    generatedCollection,
    authoredCollection: collection(authored, 'authored.json'),
    typespecInventory: {
      declarations: [
        { name: 'Payload', qualifiedName: 'Demo.Payload', kind: 'model' },
      ],
      errors: [],
      ambiguities: [],
    },
    mapping: {
      declarations: [],
      ignore: {
        typespec: ['Demo.Helper'],
        generated: ['Helper'],
        authored: ['Helper'],
      },
    },
  });
}

function generatedSchema(helper = {}) {
  return {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/root.json',
    $defs: {
      Payload: {
        type: 'object',
        properties: { value: { $ref: 'Helper.json' } },
        required: ['value'],
      },
      Helper: {
        $schema: JSON_SCHEMA_DRAFT_2020_12,
        $id: 'Helper.json',
        type: 'string',
        minLength: 1,
        maxLength: 253,
        format: 'hostname',
        ...helper,
      },
    },
  };
}

function authoredSchema() {
  return {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/authored.json',
    $defs: {
      Payload: {
        type: 'object',
        properties: {
          value: {
            type: 'string',
            minLength: 1,
            maxLength: 253,
            format: 'hostname',
          },
        },
        required: ['value'],
      },
    },
  };
}

test('comparison inlines a self-contained ignored string helper resource', () => {
  const generated = generatedSchema();
  const authored = authoredSchema();
  const snapshots = structuredClone([generated, authored]);
  const result = compare(generated, authored);
  assert.equal(result.findingCount, 0, canonicalStringify(result.findings));
  assert.deepEqual([generated, authored], snapshots);
});

test('a helper with a non-2020-12 dialect stays fail-closed', () => {
  const generated = generatedSchema({ $schema: 'http://json-schema.org/draft-07/schema#' });
  const result = compare(generated, authoredSchema());
  assert.ok(
    result.findings.some(({ ruleId }) => ruleId === 'json-schema-uncompared-ref-target'),
    canonicalStringify(result.findings),
  );
});

test('a helper with composition stays fail-closed', () => {
  const generated = generatedSchema({ allOf: [{ maxLength: 253 }] });
  const result = compare(generated, authoredSchema());
  assert.ok(
    result.findings.some(({ ruleId }) => ruleId === 'json-schema-uncompared-ref-target'),
    canonicalStringify(result.findings),
  );
});
