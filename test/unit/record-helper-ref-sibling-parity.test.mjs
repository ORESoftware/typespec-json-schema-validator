import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalStringify } from '../../src/canonical.mjs';
import {
  extractSchemaDeclarations,
  JSON_SCHEMA_DRAFT_2020_12,
  validateJsonSchemaDocument,
} from '../../src/json-schema.mjs';
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
      declarations: generatedCollection.declarations.map(({ name, kind }) => ({
        name,
        qualifiedName: `Demo.${name}`,
        kind: kind === 'scalar-like' ? 'scalar' : kind,
      })),
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

function generatedSchema(minimum = 0) {
  return {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/root.json',
    $defs: {
      Helper: {
        $schema: JSON_SCHEMA_DRAFT_2020_12,
        $id: 'RecordUnknown.json',
        type: 'object',
        properties: {},
        unevaluatedProperties: {},
      },
      Payload: {
        type: 'object',
        properties: {
          vectorClock: {
            $ref: '#/$defs/Helper',
            additionalProperties: { type: 'integer', minimum },
          },
        },
      },
    },
  };
}

function authoredSchema(minimum = 0) {
  const schema = generatedSchema();
  schema.$defs.Payload.properties.vectorClock = {
    type: 'object',
    additionalProperties: { type: 'integer', minimum },
  };
  return schema;
}

test('Record unknown helper with sibling additionalProperties preserves the value schema', () => {
  const result = compare(generatedSchema(0), authoredSchema(0));
  assert.deepEqual(result.findings, [], canonicalStringify(result.findings));
});

test('Record unknown helper sibling value drift remains visible', () => {
  const result = compare(generatedSchema(0), authoredSchema(1));
  assert.ok(
    result.findings.some(({ ruleId, pointer }) =>
      ruleId === 'generated-authored-semantic-mismatch'
      && pointer.endsWith('/properties/vectorClock/additionalProperties/minimum')),
    canonicalStringify(result.findings),
  );
});

test('other validating siblings remain fail closed', () => {
  const generated = generatedSchema(0);
  generated.$defs.Payload.properties.vectorClock.minProperties = 1;
  const result = compare(generated, authoredSchema(0));
  assert.ok(
    result.findings.some(({ ruleId }) => ruleId === 'json-schema-uncompared-ref-target'),
    canonicalStringify(result.findings),
  );
});
