import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalStringify } from '../../src/canonical.mjs';
import { compareParity } from '../../src/parity.mjs';

const HEADER_PATTERN = "^(?!(?:authorization|baggage|connection|content-encoding|content-length|content-type|cookie|forwarded|host|keep-alive|proxy-authenticate|proxy-authorization|set-cookie|te|traceparent|tracestate|trailer|transfer-encoding|upgrade|x-real-ip)$)(?!x-forwarded-)(?!grpc-)[!#$%&'*+.^_`|~0-9a-z-]+$";

function collection(schema, origin) {
  return {
    findings: [],
    declarations: [
      {
        name: 'HeaderDeclaration',
        kind: 'model',
        schema,
        pointer: '#/$defs/HeaderDeclaration',
        origin,
      },
    ],
  };
}

function compare(generated, authored) {
  return compareParity({
    typespecInventory: {
      declarations: [
        {
          kind: 'model',
          name: 'HeaderDeclaration',
          qualifiedName: 'Ores.Http.HeaderPolicy.HeaderDeclaration',
        },
      ],
      errors: [],
      ambiguities: [],
    },
    generatedCollection: collection(generated, 'generated.schema.json'),
    authoredCollection: collection(authored, 'authored.schema.json'),
    mapping: {
      declarations: [],
      ignore: { typespec: [], generated: [], authored: [] },
    },
    maxFindings: 250,
  });
}

function headerDeclarationSchema({ pattern = HEADER_PATTERN, closed = true } = {}) {
  return {
    type: 'object',
    additionalProperties: closed ? false : true,
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern,
      },
      required: { type: 'boolean' },
    },
    required: ['name', 'required'],
  };
}

test('header-policy canonical-name and closed-object constraints compare cleanly when peers agree', () => {
  const schema = headerDeclarationSchema();
  const result = compare(schema, structuredClone(schema));
  assert.equal(result.findingCount, 0, canonicalStringify(result.findings));
});

test('header-policy name-pattern drift is a parity failure', () => {
  const result = compare(
    headerDeclarationSchema(),
    headerDeclarationSchema({ pattern: '^[A-Za-z0-9-]+$' }),
  );
  assert.ok(result.findingCount > 0);
  assert.match(canonicalStringify(result.findings), /pattern/);
});

test('header-policy open-object drift is a parity failure', () => {
  const result = compare(headerDeclarationSchema(), headerDeclarationSchema({ closed: false }));
  assert.ok(result.findingCount > 0);
  assert.match(canonicalStringify(result.findings), /additionalProperties/);
});
