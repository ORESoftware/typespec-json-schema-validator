import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLaneResolver } from '../../src/differential.mjs';
import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import { extractSchemaDeclarations } from '../../src/json-schema.mjs';
import { synthesizeInstance } from '../../src/witness.mjs';

function scopedDocument(reference = 'nested/outer.json') {
  return {
    $id: 'https://example.test/root.json',
    $ref: reference,
    $defs: {
      Outer: {
        $id: 'nested/outer.json',
        type: 'object',
        properties: { choice: { $ref: 'choice.json' } },
        required: ['choice'],
        $defs: { Choice: { $id: 'choice.json', type: 'integer' }, Denied: false },
      },
      Decoy: { $id: 'nested/nested/choice.json', type: 'string' },
    },
  };
}

for (const reference of ['nested/outer.json', '#/$defs/Outer', '#/%24defs/Outer']) {
  test(`relative IDs are applied once after reference ${reference}`, () => {
    const document = scopedDocument(reference);
    const resolver = new SchemaResolver([{ document, path: 'scope.json' }]);
    const base = resolver.documents[0].base;
    assert.equal(validateInstance({ schema: document, instance: { choice: 123 }, resolver, base }).valid, true);
    assert.equal(validateInstance({ schema: document, instance: { choice: 'decoy' }, resolver, base }).valid, false);
  });
}

test('a relative root ID containing directories is resolved once at registration and evaluation', () => {
  const document = { $id: 'schemas/root.json', $ref: 'choice.json', $defs: { Choice: { $id: 'choice.json', type: 'integer' } } };
  const resolver = new SchemaResolver([{ document, path: 'root.json' }]);
  const base = resolver.documents[0].base;
  assert.equal(resolver.resolve('#', base).schema, document);
  assert.equal(resolver.resolve('choice.json', base).schema, document.$defs.Choice);
  assert.equal(validateInstance({ schema: document, instance: 1, resolver, base }).valid, true);
  assert.equal(validateInstance({ schema: document, instance: 'wrong', resolver, base }).valid, false);
});

test('an unresolvable embedded ID is refused without partially registering its document', () => {
  const resolver = new SchemaResolver([{ document: { $id: 'https://example.test/retained', type: 'string' }, path: 'retained.json' }]);
  const document = { $id: 'urn:example:root', $defs: { Child: { $id: 'child.json', type: 'integer' } } };
  assert.throws(() => resolver.addDocument(document, 'invalid-scope.json'), (error) => error.name === 'SchemaResolutionError');
  assert.equal(resolver.documents.length, 1);
  assert.equal(resolver.resolve('urn:example:root', 'https://example.test/'), undefined);
  assert.equal(resolver.resolve('https://example.test/retained', 'https://example.test/').schema.type, 'string');
});

test('resource-relative and document-relative pointers retain the same target scope and location', () => {
  const document = scopedDocument();
  const resolver = new SchemaResolver([{ document, path: 'scope.json' }]);
  for (const [reference, base] of [
    ['#/$defs/Outer/$defs/Choice', document.$id],
    ['#/%24defs/Outer/%24defs/Choice', document.$id],
    ['#/$defs/Choice', 'https://example.test/nested/outer.json'],
    ['choice.json', 'https://example.test/nested/outer.json'],
  ]) {
    const target = resolver.resolve(reference, base);
    assert.equal(target.schema, document.$defs.Outer.$defs.Choice);
    assert.equal(target.base, 'https://example.test/nested/choice.json');
    assert.equal(target.parentBase, 'https://example.test/nested/outer.json');
    assert.equal(target.pointer, '#/$defs/Outer/$defs/Choice');
    assert.equal(target.record.path, 'scope.json');
  }
});

test('boolean targets keep their embedded resource scope and document location', () => {
  const document = scopedDocument();
  const resolver = new SchemaResolver([{ document, path: 'scope.json' }]);
  for (const reference of ['#/$defs/Outer/$defs/Denied', '#/%24defs/Outer/%24defs/Denied']) {
    const target = resolver.resolve(reference, document.$id);
    assert.equal(target.schema, false);
    assert.equal(target.base, 'https://example.test/nested/outer.json');
    assert.equal(target.pointer, '#/$defs/Outer/$defs/Denied');
  }
});

test('extracted declarations are evaluated with their own inherited base', () => {
  const document = scopedDocument();
  const collection = {
    documents: [{ document, path: 'scope.json' }],
    declarations: extractSchemaDeclarations(document, 'scope.json'),
  };
  const lane = buildLaneResolver(collection);
  const declaration = collection.declarations.find(({ name }) => name === 'Outer');
  assert.equal(validateInstance({ schema: declaration.schema, instance: { choice: 123 }, resolver: lane.resolver, base: lane.baseFor(declaration) }).valid, true);
  assert.equal(validateInstance({ schema: declaration.schema, instance: { choice: 'wrong' }, resolver: lane.resolver, base: lane.baseFor(declaration) }).valid, false);
});

test('witness synthesis follows the same once-resolved reference target', () => {
  const document = scopedDocument();
  const resolver = new SchemaResolver([{ document, path: 'scope.json' }]);
  const base = resolver.documents[0].base;
  const witness = synthesizeInstance({ schema: document, resolver, base });
  assert.equal(typeof witness.instance.choice, 'number');
  assert.equal(validateInstance({ schema: document, instance: witness.instance, resolver, base }).valid, true);
});
