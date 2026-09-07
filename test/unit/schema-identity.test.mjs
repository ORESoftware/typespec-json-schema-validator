import test from 'node:test';
import assert from 'node:assert/strict';
import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';

const ROOT = 'https://schemas.example/root';
const CHILD = 'https://schemas.example/child';
const collision = (error) => error?.name === 'SchemaIdentityError';

for (const reverse of [false, true]) {
  for (const identical of [false, true]) {
    test(`duplicate document identities are rejected (reverse=${reverse}, identical=${identical})`, () => {
      const entries = [
        { path: 'first.json', document: { $id: ROOT, type: 'string' } },
        { path: 'second.json', document: { $id: ROOT, type: identical ? 'string' : 'number' } },
      ];
      assert.throws(() => new SchemaResolver(reverse ? entries.reverse() : entries), collision);
    });
  }
}

for (const [label, ids] of [
  ['exact', [CHILD, CHILD]],
  ['normalized host and port', ['https://SCHEMAS.example:443/child', CHILD]],
  ['normalized path', ['https://schemas.example/sub/../child', CHILD]],
  ['empty fragment', [CHILD, `${CHILD}#`]],
]) {
  test(`embedded resources reject ${label} duplicate identity`, () => {
    const document = { $id: ROOT, $defs: {
      first: { $id: ids[0], type: 'string' },
      second: { $id: ids[1], type: 'number' },
    } };
    assert.throws(() => new SchemaResolver([{ path: 'bundle.json', document }]), collision);
  });
}

test('embedded resource cannot replace its document root', () => {
  assert.throws(() => new SchemaResolver([{ path: 'root.json', document: {
    $id: ROOT, type: 'object', $defs: { replacement: { $id: ROOT, type: 'number' } },
  } }]), collision);
});

for (const keyword of ['$defs', 'properties', 'dependentSchemas', 'patternProperties']) {
  test(`duplicate anchors in ${keyword} are rejected before instance evaluation`, () => {
    const document = { $id: ROOT, [keyword]: {
      first: { $anchor: 'value', type: 'string' },
      second: { $anchor: 'value', type: 'number' },
    } };
    assert.throws(() => new SchemaResolver([{ path: 'anchors.json', document }]), collision);
  });
}

test('root anchor cannot be replaced by a nested anchor', () => {
  assert.throws(() => new SchemaResolver([{ document: {
    $id: ROOT, $anchor: 'value', $defs: { other: { $anchor: 'value' } },
  } }]), collision);
});

test('sharing a JavaScript object does not disguise two schema locations', () => {
  const child = { $id: CHILD };
  assert.throws(() => new SchemaResolver([{ document: {
    $id: ROOT, $defs: { first: child, second: child },
  } }]), collision);
});

test('a rejected later document leaves every existing target and document unchanged', () => {
  const original = { $id: CHILD, type: 'string' };
  const resolver = new SchemaResolver([{ path: 'original.json', document: original }]);
  const before = resolver.documents;
  const target = resolver.resolve(CHILD, ROOT);
  const incoming = { $id: ROOT, $defs: {
    fresh: { $id: 'https://schemas.example/fresh', $anchor: 'fresh' },
    replacement: { $id: CHILD, type: 'number' },
  } };
  const untouched = structuredClone(incoming);
  assert.throws(() => resolver.addDocument(incoming, 'incoming.json'), collision);
  assert.deepEqual(resolver.documents, before);
  assert.strictEqual(resolver.resolve(CHILD, ROOT), target);
  assert.equal(resolver.resolve(ROOT, ROOT), undefined);
  assert.equal(resolver.resolve('https://schemas.example/fresh', ROOT), undefined);
  assert.equal(resolver.resolve('https://schemas.example/fresh#fresh', ROOT), undefined);
  assert.deepEqual(incoming, untouched);
  const check = (instance) => validateInstance({ schema: { $ref: CHILD }, instance, resolver, base: ROOT }).valid;
  assert.equal(check('retained definition'), true);
  assert.equal(check(42), false);
});

test('late duplicate anchor rolls back root, earlier anchors, and document count', () => {
  const resolver = new SchemaResolver();
  assert.throws(() => resolver.addDocument({ $id: ROOT, $defs: {
    first: { $anchor: 'taken' }, unique: { $anchor: 'unique' },
    last: { $anchor: 'taken' },
  } }, 'rejected.json'), collision);
  assert.deepEqual(resolver.documents, []);
  assert.equal(resolver.resolve(`${ROOT}#unique`, ROOT), undefined);
  const accepted = resolver.addDocument({ type: 'string' }, 'accepted.json');
  assert.equal(accepted.base, 'https://tsjsv.invalid/0/accepted.json');
});

test('registration of one exact root at its URI and empty fragment remains valid', () => {
  const document = { $id: ROOT, $anchor: 'root', type: 'string' };
  const resolver = new SchemaResolver([{ path: 'root.json', document }]);
  for (const reference of [ROOT, `${ROOT}#`, `${ROOT}#root`]) {
    assert.strictEqual(resolver.resolve(reference, ROOT).schema, document);
  }
});

test('the same anchor name in distinct resources is not a collision', () => {
  const first = { $id: CHILD, $anchor: 'value', type: 'string' };
  const second = { $id: 'https://schemas.example/other', $anchor: 'value', type: 'number' };
  const resolver = new SchemaResolver([{ document: { $id: ROOT, $defs: { first, second } } }]);
  assert.strictEqual(resolver.resolve(`${CHILD}#value`, ROOT).schema, first);
  assert.strictEqual(resolver.resolve('https://schemas.example/other#value', ROOT).schema, second);
});

for (const keyword of ['const', 'enum', 'default', 'examples', 'x-extension']) {
  test(`identity-looking literal data in ${keyword} does not register resources`, () => {
    const data = { $id: ROOT, $anchor: 'value', properties: { x: { $id: CHILD } } };
    const literal = ['enum', 'examples'].includes(keyword) ? [data] : data;
    const document = { $id: ROOT, $anchor: 'value', [keyword]: literal };
    const resolver = new SchemaResolver([{ document }]);
    assert.strictEqual(resolver.resolve(ROOT, ROOT).schema, document);
    assert.equal(resolver.resolve(CHILD, ROOT), undefined);
  });
}

test('boolean document roots remain independently addressable', () => {
  const resolver = new SchemaResolver([{ path: 'yes.json', document: true }, { path: 'no.json', document: false }]);
  for (const record of resolver.documents) {
    assert.strictEqual(resolver.resolve(record.base, ROOT).schema, record.document);
    assert.strictEqual(resolver.resolve(`${record.base}#`, ROOT).schema, record.document);
  }
});

test('boolean subschema pointers and ordinary references are preserved', () => {
  const document = { $id: ROOT, $defs: { yes: true, no: false, text: { type: 'string' } } };
  const resolver = new SchemaResolver([{ document }]);
  assert.equal(resolver.resolve('#/$defs/yes', ROOT).schema, true);
  assert.equal(resolver.resolve('#/$defs/no', ROOT).schema, false);
  assert.strictEqual(resolver.resolve('#/$defs/text', ROOT).schema, document.$defs.text);
});
