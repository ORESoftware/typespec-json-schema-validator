import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deepDiff,
  escapeJsonPointerSegment,
  normalizeComparisonRef,
  normalizeSchemaDocument,
  normalizeSchemaDocumentForComparison,
} from '../../src/canonical.mjs';

const preservedReferences = [
  'urn:example:User.json', 'https:User.json', 'file:User.json',
  'data:application/schema+json,User.json', 'C:\\User.json',
  'schemas\\User.json', './schemas\\User.json',
  'User%2FAdmin.json', 'User%7E1Admin.json', 'User%20Name.json',
  'User Name.json', 'User\tName.json', 'User\u0000Name.json',
  'User\u001fName.json', 'User\u007fName.json', 'User.json\n',
  'User.json\r', 'User.json\r\n', 'User\u2028Name.json',
  './urn:example:User.json', 'https://example.test/User.json',
  '//example.test/User.json', '/User.json', '../User.json',
  'schemas/User.json', 'User.json?version=2', 'User.json#/$defs/Other',
];

for (const reference of preservedReferences) {
  test(`comparison preserves non-local or ambiguous reference ${JSON.stringify(reference)}`, () => {
    assert.equal(normalizeComparisonRef(reference), reference);
  });
}

for (const name of ['User', 'User.v2', 'A~B', 'A~1B', 'A~0B', '__proto__', 'München']) {
  for (const prefix of ['', './']) {
    test(`local filename ${prefix}${name}.json matches only its escaped declaration name`, () => {
      const filename = `${prefix}${name}.json`;
      const expected = normalizeComparisonRef(`#/$defs/${escapeJsonPointerSegment(name)}`);
      assert.equal(normalizeComparisonRef(filename), expected);
      assert.equal(normalizeComparisonRef(`#/definitions/${escapeJsonPointerSegment(name)}`), expected);
    });
  }
}

for (const [filename, wrongDeclaration] of [
  ['A~1B.json', 'A~1B'], // literal tilde-one is not the declaration named A/B
  ['A~0B.json', 'A~0B'], // literal tilde-zero is not the declaration named A~B
  ['urn:example:User.json', 'urn:example:User'],
  ['https:User.json', 'https:User'],
  ['User%2FAdmin.json', 'User%2FAdmin'],
]) {
  test(`schema comparison retains a finding for ${filename} versus ${wrongDeclaration}`, () => {
    const left = normalizeSchemaDocumentForComparison({ properties: { user: { $ref: filename } } });
    const right = normalizeSchemaDocumentForComparison({ properties: { user: { $ref: `#/$defs/${wrongDeclaration}` } } });
    assert.deepEqual(deepDiff(left, right).differences.map(({ pointer, kind }) => ({ pointer, kind })), [
      { pointer: '#/properties/user/$ref', kind: 'value-mismatch' },
    ]);
  });
}

test('comparison normalization remains idempotent for a declaration ending in .json', () => {
  const normalized = normalizeComparisonRef('User.json.json');
  assert.equal(normalizeComparisonRef(normalized), normalized);
});

test('runtime references and literal JSON data are not rewritten by comparison rules', () => {
  const literal = { $ref: 'A~1B.json' };
  const document = {
    properties: { user: { $ref: 'A~1B.json' } },
    const: literal,
    enum: [literal],
    'x-evidence': literal,
  };
  const snapshot = structuredClone(document);
  assert.deepEqual(normalizeSchemaDocument(document), document);
  const compared = normalizeSchemaDocumentForComparison(document);
  assert.equal(compared.properties.user.$ref, 'urn:tsjsv:declaration:A~01B');
  assert.deepEqual(compared.const, literal);
  assert.deepEqual(compared.enum, [literal]);
  assert.deepEqual(compared['x-evidence'], literal);
  assert.deepEqual(document, snapshot);
});

test('non-string references are left to structural validation without coercion', () => {
  for (const reference of [null, false, 3, {}, []]) {
    assert.equal(normalizeComparisonRef(reference), reference);
  }
});
