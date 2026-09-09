import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStringify } from '../../src/canonical.mjs';
import { compareParity } from '../../src/parity.mjs';

function resourcePairInput(authoredRoleRef) {
  const generatedSource = '/repo/generated/schema.json';
  const authoredSource = '/repo/authored/support.schema.json';
  const role = { type: 'string', enum: ['admin', 'user'] };
  const generatedUser = {
    type: 'object',
    properties: { role: { $ref: 'Role.json' } },
    required: ['role'],
  };
  const authoredUser = {
    type: 'object',
    properties: { role: { $ref: authoredRoleRef } },
    required: ['role'],
  };

  return {
    typespecInventory: {
      declarations: [
        { kind: 'model', name: 'User', qualifiedName: 'Example.User' },
        { kind: 'enum', name: 'Role', qualifiedName: 'Example.Role' },
      ],
      errors: [],
      ambiguities: [],
    },
    generatedCollection: {
      findings: [],
      documents: [{
        path: generatedSource,
        relativePath: 'schema.json',
        document: {
          $id: 'https://generated.example.test/schema.json',
          $defs: { User: generatedUser, Role: role },
        },
      }],
      declarations: [
        { name: 'User', kind: 'model', schema: generatedUser, source: generatedSource, pointer: '#/$defs/User' },
        { name: 'Role', kind: 'enum', schema: role, source: generatedSource, pointer: '#/$defs/Role' },
      ],
    },
    authoredCollection: {
      findings: [],
      documents: [{
        path: authoredSource,
        relativePath: 'support.schema.json',
        document: {
          $id: 'https://schemas.example.test/support.schema.json',
          $defs: { AccountUser: authoredUser, accountRole: role },
        },
      }],
      declarations: [
        { name: 'AccountUser', kind: 'model', schema: authoredUser, source: authoredSource, pointer: '#/$defs/AccountUser' },
        { name: 'accountRole', kind: 'enum', schema: role, source: authoredSource, pointer: '#/$defs/accountRole' },
      ],
    },
    mapping: {
      declarations: [
        { typespec: 'Example.User', generated: 'User', authored: 'AccountUser' },
        { typespec: 'Example.Role', generated: 'Role', authored: 'accountRole' },
      ],
      ignore: { typespec: [], generated: [], authored: [] },
    },
  };
}

test('known absolute $id references compare by resolved declaration identity', () => {
  const input = resourcePairInput(
    'https://schemas.example.test/support.schema.json#/$defs/accountRole',
  );
  const generatedSnapshot = structuredClone(input.generatedCollection);
  const authoredSnapshot = structuredClone(input.authoredCollection);
  const result = compareParity(input);

  assert.equal(result.findingCount, 0, canonicalStringify(result.findings));
  assert.deepEqual(input.generatedCollection, generatedSnapshot, 'generated authority must remain untouched');
  assert.deepEqual(input.authoredCollection, authoredSnapshot, 'authored authority must remain untouched');
});

test('unknown external absolute references remain fail-closed', () => {
  const result = compareParity(resourcePairInput(
    'https://external.example.test/roles.schema.json#/$defs/accountRole',
  ));

  assert(result.findings.some(({ ruleId, pointer }) =>
    ruleId === 'generated-authored-semantic-mismatch' && pointer.endsWith('/properties/role/$ref')),
  canonicalStringify(result.findings));
});

test('known absolute reference to the wrong declaration still fails', () => {
  const result = compareParity(resourcePairInput(
    'https://schemas.example.test/support.schema.json#/$defs/AccountUser',
  ));

  assert(result.findings.some(({ ruleId, pointer }) =>
    ruleId === 'generated-authored-semantic-mismatch' && pointer.endsWith('/properties/role/$ref')),
  canonicalStringify(result.findings));
});
