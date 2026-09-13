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

function baseSchema() {
  return {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/root.json',
    $defs: {
      Payload: {
        type: 'object',
        properties: {},
      },
    },
  };
}

test('ignored string helper still exposes changed inline constraints', () => {
  const generated = baseSchema();
  generated.$defs.Helper = { type: 'string', minLength: 1, maxLength: 500 };
  generated.$defs.Payload.properties.value = { $ref: '#/$defs/Helper' };

  const authored = structuredClone(generated);
  authored.$defs.Payload.properties.value = { type: 'string', minLength: 1, maxLength: 501 };

  const result = compare(generated, authored);
  assert.ok(
    result.findings.some(({ ruleId, pointer }) =>
      ruleId === 'generated-authored-semantic-mismatch'
      && pointer.endsWith('/properties/value/maxLength')),
    canonicalStringify(result.findings),
  );
});

test('ignored object helper remains outside static comparison admission', () => {
  const generated = baseSchema();
  generated.$defs.Helper = {
    type: 'object',
    properties: { value: { type: 'string' } },
  };
  generated.$defs.Payload.properties.nested = { $ref: '#/$defs/Helper' };

  const authored = structuredClone(generated);
  authored.$defs.Payload.properties.nested = {
    type: 'object',
    properties: { value: { type: 'string' } },
  };

  const result = compare(generated, authored);
  assert.ok(
    result.findings.some(({ ruleId }) => ruleId === 'json-schema-uncompared-ref-target'),
    canonicalStringify(result.findings),
  );
});

test('ignored non-string scalar helpers remain fail-closed', () => {
  const generated = baseSchema();
  generated.$defs.Helper = { type: 'integer', minimum: 0, maximum: 10 };
  generated.$defs.Payload.properties.count = { $ref: '#/$defs/Helper' };

  const authored = structuredClone(generated);
  authored.$defs.Payload.properties.count = { type: 'integer', minimum: 0, maximum: 10 };

  const result = compare(generated, authored);
  assert.ok(
    result.findings.some(({ ruleId }) => ruleId === 'json-schema-uncompared-ref-target'),
    canonicalStringify(result.findings),
  );
});
