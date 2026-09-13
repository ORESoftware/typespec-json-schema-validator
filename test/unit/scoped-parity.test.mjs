import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStringify } from '../../src/canonical.mjs';
import { extractSchemaDeclarations, JSON_SCHEMA_DRAFT_2020_12, validateJsonSchemaDocument } from '../../src/json-schema.mjs';
import { compareParity } from '../../src/parity.mjs';

function collection(document, path) {
  return { documents: [{ document, path }], declarations: extractSchemaDeclarations(document, path), findings: validateJsonSchemaDocument(document) };
}

function compare(generated, authored, mapping = { declarations: [], ignore: { typespec: [], generated: [], authored: [] } }) {
  const generatedCollection = collection(generated, 'generated.json');
  return compareParity({
    generatedCollection,
    authoredCollection: collection(authored, 'authored.json'),
    typespecInventory: {
      declarations: generatedCollection.declarations.map(({ name, kind }) => ({ name, qualifiedName: `Demo.${name}`, kind: kind === 'scalar-like' ? 'scalar' : kind })),
      errors: [], ambiguities: [],
    },
    mapping,
  });
}

function schema(id) {
  return {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/root.json',
    $defs: {
      Payload: {
        ...(id ? { $id: id } : {}),
        type: 'object',
        properties: { value: { $ref: '#/$defs/Value' } },
        required: ['value'],
        $defs: { Value: { type: 'integer' } },
      },
      Value: { type: 'string' },
    },
  };
}

function ignoredHelperMapping(name) {
  return {
    declarations: [],
    ignore: {
      typespec: [`Demo.${name}`],
      generated: [name],
      authored: [],
    },
  };
}

for (const reverse of [false, true]) {
  test(`a resource boundary cannot hide a different reference target (reverse=${reverse})`, () => {
    const lanes = [schema(), schema('nested.json')];
    if (reverse) lanes.reverse();
    const result = compare(...lanes);
    assert.ok(result.findings.some(({ ruleId, pointer }) => ruleId === 'generated-authored-semantic-mismatch' && pointer.endsWith('/properties/value/$ref')), canonicalStringify(result.findings));
  });
}

test('independently named resources compare by their actual mapped schema locations', () => {
  const generated = schema('generated/payload.json');
  const authored = schema('authored/payload.json');
  const snapshots = structuredClone([generated, authored]);
  const result = compare(generated, authored);
  assert.equal(result.findingCount, 0, canonicalStringify(result.findings));
  assert.deepEqual([generated, authored], snapshots);
  assert.deepEqual(compare(generated, authored), result);
});

test('file-looking references cannot alias a declaration without an actual resolvable resource', () => {
  const generated = schema();
  generated.$defs.Payload.properties.value.$ref = 'Value.json';
  const result = compare(generated, schema());
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'json-schema-unresolved-ref'), canonicalStringify(result.findings));
});

test('unresolved optional references stop static comparison even when both lanes are identical', () => {
  const document = schema();
  document.$defs.Payload.properties.optional = { $ref: 'missing.json' };
  const result = compare(document, structuredClone(document));
  assert.ok(result.findings.some(({ ruleId, pointer }) => ruleId === 'json-schema-unresolved-ref' && pointer.endsWith('/properties/optional/$ref')), canonicalStringify(result.findings));
});

test('unsupported dynamic reference scope cannot disappear in static comparison', () => {
  const document = schema();
  document.$defs.Payload.properties.value = { $dynamicRef: '#value' };
  const result = compare(document, structuredClone(document));
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'json-schema-unsupported-reference'), canonicalStringify(result.findings));
});

test('an embedded unsupported dialect cannot disappear as presentation metadata', () => {
  const document = schema('nested.json');
  document.$defs.Payload.$schema = 'http://json-schema.org/draft-07/schema#';
  const result = compare(document, structuredClone(document));
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'json-schema-unsupported-dialect'), canonicalStringify(result.findings));
});

test('references outside the compared declaration set stop static admission', () => {
  const document = schema();
  document.$defs.Payload.properties.value = { $ref: '#' };
  const result = compare(document, structuredClone(document));
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'json-schema-uncompared-ref-target'), canonicalStringify(result.findings));
});

test('ignored generated primitive helpers compare by resolved leaf constraints', () => {
  const generated = {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/generated.json',
    $defs: {
      Payload: {
        type: 'object',
        properties: {
          hosts: {
            type: 'array',
            items: { $ref: '#/$defs/Hostname' },
          },
        },
        required: ['hosts'],
      },
      Hostname: {
        type: 'string',
        format: 'hostname',
        maxLength: 253,
      },
    },
  };
  const authored = {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/authored.json',
    $defs: {
      Payload: {
        type: 'object',
        properties: {
          hosts: {
            type: 'array',
            items: {
              type: 'string',
              format: 'hostname',
              maxLength: 253,
            },
          },
        },
        required: ['hosts'],
      },
    },
  };

  const snapshots = structuredClone([generated, authored]);
  const result = compare(generated, authored, ignoredHelperMapping('Hostname'));
  assert.equal(result.findingCount, 0, canonicalStringify(result.findings));
  assert.deepEqual([generated, authored], snapshots);
});

test('ignored generated primitive helpers still expose changed inline constraints', () => {
  const generated = {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/generated.json',
    $defs: {
      Payload: {
        type: 'object',
        properties: { names: { type: 'array', items: { $ref: '#/$defs/BoundedString' } } },
      },
      BoundedString: { type: 'string', minLength: 1, maxLength: 500 },
    },
  };
  const authored = {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/authored.json',
    $defs: {
      Payload: {
        type: 'object',
        properties: { names: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 501 } } },
      },
    },
  };

  const result = compare(generated, authored, ignoredHelperMapping('BoundedString'));
  assert.ok(result.findings.some(({ ruleId, pointer }) =>
    ruleId === 'generated-authored-semantic-mismatch' && pointer.endsWith('/properties/names/items/maxLength')),
  canonicalStringify(result.findings));
});

test('ignored object helpers remain outside static comparison admission', () => {
  const generated = {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/generated.json',
    $defs: {
      Payload: {
        type: 'object',
        properties: { nested: { $ref: '#/$defs/Helper' } },
      },
      Helper: {
        type: 'object',
        properties: { value: { type: 'string' } },
      },
    },
  };
  const authored = {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id: 'https://example.test/authored.json',
    $defs: {
      Payload: {
        type: 'object',
        properties: { nested: { type: 'object', properties: { value: { type: 'string' } } } },
      },
    },
  };

  const result = compare(generated, authored, ignoredHelperMapping('Helper'));
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'json-schema-uncompared-ref-target'), canonicalStringify(result.findings));
});

test('literal JSON that looks like reference syntax remains opaque', () => {
  const document = schema();
  document.$defs.Payload.properties.literal = { const: { $id: 'other.json', $ref: 'missing.json', $dynamicRef: '#x' } };
  assert.equal(compare(document, structuredClone(document)).findingCount, 0);
  const changed = structuredClone(document);
  changed.$defs.Payload.properties.literal.const.$id = 'different.json';
  assert.ok(compare(document, changed).findings.some(({ pointer }) => pointer.endsWith('/const/$id')));
});

test('equivalent URI fragment encodings identify the same nested schema location', () => {
  const authored = schema('nested.json');
  authored.$defs.Payload.properties.value.$ref = '#/%24defs/Value';
  const result = compare(schema('nested.json'), authored);
  assert.equal(result.findingCount, 0, canonicalStringify(result.findings));
});
