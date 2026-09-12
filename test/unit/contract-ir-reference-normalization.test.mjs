import assert from 'node:assert/strict';
import test from 'node:test';
import { createContractIr } from '../../src/contract-ir.mjs';

const hex = (character) => character.repeat(64);

function referenceEvidence(authoredUserRef = 'https://schemas.example/identifier.json#/$defs/Identifier') {
  const typespecInventory = {
    input: '/repo/contracts/main.tsp',
    projectRoot: '/repo/contracts',
    digest: hex('a'),
    files: [{ path: 'main.tsp', sha256: hex('1') }],
    declarations: [
      {
        kind: 'scalar',
        name: 'Identifier',
        qualifiedName: 'Example.Identifier',
        namespace: 'Example',
        file: '/repo/contracts/main.tsp',
        line: 2,
        column: 1,
      },
      {
        kind: 'model',
        name: 'User',
        qualifiedName: 'Example.User',
        namespace: 'Example',
        file: '/repo/contracts/main.tsp',
        line: 3,
        column: 1,
      },
    ],
    outOfScopeDeclarations: [],
    errors: [],
    ambiguities: [],
  };

  const generatedDocument = {
    path: '/repo/generated/schema.json',
    relativePath: 'schema.json',
    sha256: hex('2'),
    document: { $id: 'https://generated.example/schema.json' },
  };
  const generatedCollection = {
    input: '/repo/generated',
    digest: hex('b'),
    findings: [],
    documents: [generatedDocument],
    declarations: [
      {
        name: 'Identifier',
        kind: 'scalar-like',
        schema: { type: 'string', minLength: 1 },
        source: generatedDocument.path,
        pointer: '#/$defs/Identifier',
      },
      {
        name: 'User',
        kind: 'model',
        schema: {
          type: 'object',
          properties: { id: { $ref: '#/$defs/Identifier' } },
          required: ['id'],
        },
        source: generatedDocument.path,
        pointer: '#/$defs/User',
      },
    ],
  };

  const authoredIdentifierDocument = {
    path: '/repo/authored/identifier.json',
    relativePath: 'identifier.json',
    sha256: hex('3'),
    document: { $id: 'https://schemas.example/identifier.json' },
  };
  const authoredUserDocument = {
    path: '/repo/authored/user.json',
    relativePath: 'user.json',
    sha256: hex('4'),
    document: { $id: 'https://schemas.example/user.json' },
  };
  const authoredCollection = {
    input: '/repo/authored',
    digest: hex('c'),
    findings: [],
    documents: [authoredIdentifierDocument, authoredUserDocument],
    declarations: [
      {
        name: 'Identifier',
        kind: 'scalar-like',
        schema: { type: 'string', minLength: 1 },
        source: authoredIdentifierDocument.path,
        pointer: '#/$defs/Identifier',
      },
      {
        name: 'User',
        kind: 'model',
        schema: {
          type: 'object',
          properties: { id: { $ref: authoredUserRef } },
          required: ['id'],
        },
        source: authoredUserDocument.path,
        pointer: '#/$defs/User',
      },
    ],
  };

  for (const collection of [generatedCollection, authoredCollection]) {
    for (const document of collection.documents) {
      document.document.$defs = Object.fromEntries(collection.declarations
        .filter((declaration) => declaration.source === document.path)
        .map((declaration) => [declaration.name, declaration.schema]));
    }
  }

  const report = {
    schema: 'ores.typespec-json-schema-validator.report/v1',
    runId: hex('d'),
    status: 'passed',
    zeroUnexplainedFindings: true,
    findings: [],
    coverage: {
      directDeclarationInventory: true,
      typespecGeneratedJsonSchemaComparison: true,
      differentialInstanceValidation: true,
    },
    inputs: {
      typespec: {
        input: typespecInventory.input,
        digest: typespecInventory.digest,
        files: typespecInventory.files,
      },
      generatedJsonSchema: {
        input: generatedCollection.input,
        digest: generatedCollection.digest,
        files: generatedCollection.documents,
      },
      authoredJsonSchema: {
        input: authoredCollection.input,
        digest: authoredCollection.digest,
        files: authoredCollection.documents,
      },
    },
    declarationMap: [
      {
        typespec: 'Example.Identifier',
        kind: 'scalar',
        generated: 'Identifier',
        authored: 'Identifier',
      },
      {
        typespec: 'Example.User',
        kind: 'model',
        generated: 'User',
        authored: 'User',
      },
    ],
    toolchain: { validator: { version: 'unit-fixture' } },
    configuration: { mode: 'check' },
  };

  return { report, typespecInventory, generatedCollection, authoredCollection };
}

function namedArrayEvidence({ generatedSchema, authoredSchema }) {
  const typespecInventory = {
    input: '/repo/contracts/main.tsp',
    projectRoot: '/repo/contracts',
    digest: hex('a'),
    files: [{ path: 'main.tsp', sha256: hex('1') }],
    declarations: [
      {
        kind: 'model',
        name: 'Tags',
        qualifiedName: 'Example.Tags',
        namespace: 'Example',
        file: '/repo/contracts/main.tsp',
        line: 2,
        column: 1,
      },
    ],
    outOfScopeDeclarations: [],
    errors: [],
    ambiguities: [],
  };
  const collection = (input, digestCharacter, schema) => ({
    input,
    digest: hex(digestCharacter),
    findings: [],
    documents: [
      {
        path: `${input}/schema.json`,
        relativePath: 'schema.json',
        sha256: hex(digestCharacter),
        document: { $defs: { Tags: schema } },
      },
    ],
    declarations: [
      {
        name: 'Tags',
        kind: schema.type === 'array' ? 'scalar-like' : 'model',
        schema,
        source: `${input}/schema.json`,
        pointer: '#/$defs/Tags',
      },
    ],
  });
  const generatedCollection = collection('/repo/generated', 'b', generatedSchema);
  const authoredCollection = collection('/repo/authored', 'c', authoredSchema);
  const report = {
    schema: 'ores.typespec-json-schema-validator.report/v1',
    runId: hex('d'),
    status: 'passed',
    zeroUnexplainedFindings: true,
    findings: [],
    coverage: {
      directDeclarationInventory: true,
      typespecGeneratedJsonSchemaComparison: true,
      differentialInstanceValidation: true,
    },
    inputs: {
      typespec: {
        input: typespecInventory.input,
        digest: typespecInventory.digest,
        files: typespecInventory.files,
      },
      generatedJsonSchema: {
        input: generatedCollection.input,
        digest: generatedCollection.digest,
        files: generatedCollection.documents,
      },
      authoredJsonSchema: {
        input: authoredCollection.input,
        digest: authoredCollection.digest,
        files: authoredCollection.documents,
      },
    },
    declarationMap: [
      {
        typespec: 'Example.Tags',
        kind: 'model',
        generated: 'Tags',
        authored: 'Tags',
      },
    ],
    toolchain: { validator: { version: 'unit-fixture' } },
    configuration: { mode: 'check' },
  };
  return { report, typespecInventory, generatedCollection, authoredCollection };
}

test('Contract IR accepts only locally proven aliases for mapped cross-document refs', () => {
  const values = referenceEvidence();
  const ir = createContractIr(values);
  const user = ir.declarations.find((declaration) => declaration.id === 'Example.User');
  assert.equal(user.assertionSchema.properties.id.$ref, 'urn:tsjsv:declaration:Identifier');
  assert.equal(ir.authorities.precedence, 'none');
});

test('Contract IR keeps unknown external refs fail-closed', () => {
  const values = referenceEvidence('https://unknown.example/identifier.json#/$defs/Identifier');
  assert.throws(() => createContractIr(values), /json-schema-unresolved-ref/);
});

test('Contract IR accepts emitter-proven TypeSpec named array models without changing lexical IR kind', () => {
  const schema = { type: 'array', items: { type: 'string' }, maxItems: 8 };
  const ir = createContractIr(namedArrayEvidence({ generatedSchema: schema, authoredSchema: schema }));
  assert.equal(ir.declarations[0].kind, 'model');
  assert.equal(ir.declarations[0].lanes.typespecGeneratedJsonSchema.kind, 'scalar-like');
  assert.equal(ir.declarations[0].lanes.authoredJsonSchema.kind, 'scalar-like');
});

test('Contract IR does not reinterpret an ordinary object model as an authored array', () => {
  const values = namedArrayEvidence({
    generatedSchema: { type: 'object', properties: {} },
    authoredSchema: { type: 'array', items: { type: 'string' } },
  });
  assert.throws(() => createContractIr(values), /authored declaration kind/);
});
