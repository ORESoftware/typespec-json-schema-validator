import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStringify } from '../../src/canonical.mjs';
import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import {
  OUT_OF_DOMAIN_STRING,
  UNEXPECTED_PROPERTY,
  buildProbes,
  collectValueDomains,
  mutateInstance,
  synthesizeInstance,
} from '../../src/witness.mjs';

const BUNDLE = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'witness.schema.json',
  $defs: {
    Role: { $id: 'Role', type: 'string', enum: ['admin', 'member', 'owner'] },
    User: {
      $id: 'User',
      type: 'object',
      properties: {
        id: { type: 'string' },
        role: { $ref: 'Role' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 2 },
        age: { type: 'integer', minimum: 18 },
        nickname: { type: 'string' },
      },
      required: ['id', 'role', 'tags', 'age'],
      unevaluatedProperties: false,
    },
  },
};

function lane() {
  const resolver = new SchemaResolver();
  const record = resolver.addDocument(BUNDLE, 'witness.schema.json');
  return { resolver, base: record.base };
}

test('synthesized instances satisfy the schema they were derived from', () => {
  const { resolver, base } = lane();
  for (const mode of ['minimal', 'full']) {
    const { instance } = synthesizeInstance({ schema: BUNDLE.$defs.User, base, resolver, mode });
    const result = validateInstance({ schema: BUNDLE.$defs.User, instance, resolver, base });
    assert.equal(result.valid, true, `${mode} synthesis produced ${canonicalStringify(instance)}: ${canonicalStringify(result.errors)}`);
  }
});

test('minimal synthesis omits optional properties and full synthesis includes them', () => {
  const { resolver, base } = lane();
  const minimal = synthesizeInstance({ schema: BUNDLE.$defs.User, base, resolver, mode: 'minimal' }).instance;
  const full = synthesizeInstance({ schema: BUNDLE.$defs.User, base, resolver, mode: 'full' }).instance;
  assert.equal('nickname' in minimal, false);
  assert.equal('nickname' in full, true);
});

test('synthesis honours constraints on numbers and arrays', () => {
  const { resolver, base } = lane();
  const instance = synthesizeInstance({ schema: BUNDLE.$defs.User, base, resolver, mode: 'full' }).instance;
  assert.equal(instance.age, 18);
  assert.equal(instance.tags.length, 2);
});

test('synthesis is deterministic', () => {
  const first = (() => {
    const { resolver, base } = lane();
    return canonicalStringify(synthesizeInstance({ schema: BUNDLE.$defs.User, base, resolver }).instance);
  })();
  const second = (() => {
    const { resolver, base } = lane();
    return canonicalStringify(synthesizeInstance({ schema: BUNDLE.$defs.User, base, resolver }).instance);
  })();
  assert.equal(first, second);
});

test('value domains are collected across references', () => {
  const { resolver, base } = lane();
  const domains = collectValueDomains({ schema: BUNDLE.$defs.User, base, resolver });
  const role = domains.find((domain) => domain.pointer === '/role');
  assert.ok(role, `expected a /role domain, received ${canonicalStringify(domains)}`);
  assert.deepEqual(role.values, ['admin', 'member', 'owner']);
});

test('mutation covers deletion, injection and typed substitution and stays bounded', () => {
  const seed = { id: 'a', nested: { b: 1 } };
  const mutants = mutateInstance(seed, { limit: 200 });
  const mutations = new Set(mutants.map((mutant) => mutant.mutation));
  assert.ok(mutations.has('delete-property'));
  assert.ok(mutations.has('inject-unexpected-property'));
  assert.ok(mutations.has('substitute-null'));
  assert.ok(mutants.some((mutant) => canonicalStringify(mutant.instance).includes(UNEXPECTED_PROPERTY)));
  assert.ok(mutants.some((mutant) => canonicalStringify(mutant.instance).includes(OUT_OF_DOMAIN_STRING)));
  assert.equal(mutateInstance(seed, { limit: 5 }).length, 5);
  assert.deepEqual(seed, { id: 'a', nested: { b: 1 } }, 'mutation must not alter the seed');
});

test('mutation ordering is stable across runs', () => {
  const seed = { b: 1, a: { c: 'x' } };
  const first = mutateInstance(seed, { limit: 40 }).map((mutant) => `${mutant.mutation}:${mutant.pointer}`);
  const second = mutateInstance(seed, { limit: 40 }).map((mutant) => `${mutant.mutation}:${mutant.pointer}`);
  assert.deepEqual(first, second);
});

test('probe corpora are deduplicated, bounded and carry declared examples', () => {
  const { resolver, base } = lane();
  const schema = { ...BUNDLE.$defs.Role, examples: ['member'], default: 'admin' };
  const probes = buildProbes({ schema, base, resolver, lane: 'authored', declaration: 'Role', maxProbes: 24 });
  assert.ok(probes.length > 0);
  assert.ok(probes.length <= 24);
  assert.equal(new Set(probes.map((probe) => canonicalStringify(probe.instance))).size, probes.length);
  assert.ok(probes.some((probe) => probe.origin === 'declared-example-0'));
  for (const value of ['admin', 'member', 'owner']) {
    assert.ok(
      probes.some((probe) => probe.instance === value),
      `expected enum member ${value} to be probed`,
    );
  }
});

test('probe identifiers are stable and namespaced by lane and declaration', () => {
  const { resolver, base } = lane();
  const probes = buildProbes({ schema: BUNDLE.$defs.Role, base, resolver, lane: 'generated', declaration: 'Role', maxProbes: 8 });
  assert.ok(probes.every((probe) => probe.id.startsWith('generated:Role:')));
  const repeat = buildProbes({ schema: BUNDLE.$defs.Role, base, resolver, lane: 'generated', declaration: 'Role', maxProbes: 8 });
  assert.deepEqual(probes.map((probe) => probe.id), repeat.map((probe) => probe.id));
});
