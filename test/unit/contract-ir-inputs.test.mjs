import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertExactSourceFiles } from '../../src/contract-ir-inputs.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const lanes = [
  ['TypeSpec', 'typespec', 'typespecInventory', 'files', 'path'],
  ['generated JSON Schema', 'generatedJsonSchema', 'generatedCollection', 'documents', 'relativePath'],
  ['authored JSON Schema', 'authoredJsonSchema', 'authoredCollection', 'documents', 'relativePath'],
];

function fixture() {
  const value = { report: { inputs: {} } };
  for (const [label, input, collection, list, key] of lanes) {
    const files = [
      { [key]: 'main.json', sha256: hash(`${label}:main`) },
      { [key]: '../shared/types.json', sha256: hash(`${label}:shared`) },
    ];
    value.report.inputs[input] = { files: structuredClone(files) };
    value[collection] = { [list]: structuredClone(files) };
  }
  return value;
}

function readOnly(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) readOnly(child);
    Object.freeze(value);
  }
  return value;
}

test('exact source-file closures pass without mutating frozen inputs', () => {
  const value = readOnly(fixture());
  const before = JSON.stringify(value);
  assert.doesNotThrow(() => assertExactSourceFiles(value));
  assert.equal(JSON.stringify(value), before);
});

test('receipt and current file order are not semantic', () => {
  const value = fixture();
  for (const [, input] of lanes) value.report.inputs[input].files.reverse();
  assert.doesNotThrow(() => assertExactSourceFiles(value));
});

test('absolute checkout locations do not replace relative schema identities', () => {
  const value = fixture();
  for (const [, input, collection, list, key] of lanes.slice(1)) {
    for (const item of value.report.inputs[input].files) item.path = `/producer/${item[key]}`;
    for (const item of value[collection][list]) item.path = `/consumer/${item[key]}`;
  }
  assert.doesNotThrow(() => assertExactSourceFiles(value));
});

test('different source bytes may have identical parsed JSON and must still fail', () => {
  const compact = '{"type":"string"}';
  const pretty = '{\n  "type": "string"\n}\n';
  assert.deepEqual(JSON.parse(compact), JSON.parse(pretty));
  const value = fixture();
  value.report.inputs.authoredJsonSchema.files[0].sha256 = hash(compact);
  value.authoredCollection.documents[0].sha256 = hash(pretty);
  assert.throws(() => assertExactSourceFiles(value), /authored JSON Schema source-file SHA-256 no longer matches/);
});

for (const [label, input, collection, list, key] of lanes) {
  for (const [name, mutate, expected] of [
    ['changed bytes', (files) => { files[0].sha256 = hash('changed'); }, /source-file SHA-256 no longer matches/],
    ['missing file', (files) => { files.pop(); }, /receipt file is absent from current inputs/],
    ['additional file', (files) => { files.push({ [key]: 'new.json', sha256: hash('new') }); }, /current file is absent from receipt/],
    ['renamed file', (files) => { files[0][key] = 'renamed.json'; }, /absent from/],
    ['duplicate path', (files) => { files.push({ ...files[0] }); }, /repeats path/],
    ['case-changed identity', (files) => { files[0][key] = 'MAIN.json'; }, /absent from/],
    ['dot-segment identity', (files) => { files[0][key] = './main.json'; }, /absent from/],
  ]) {
    test(`${label}: rejects ${name}`, () => {
      const value = fixture();
      mutate(value[collection][list]);
      assert.throws(() => assertExactSourceFiles(value), expected);
    });
  }

  for (const side of ['receipt', 'current']) {
    function filesOf(value) {
      return side === 'receipt' ? value.report.inputs[input].files : value[collection][list];
    }
    for (const [name, edit, expected] of [
      ['duplicate identity', (files) => files.push({ ...files[0] }), /repeats path/],
      ['non-object record', (files) => { files[0] = null; }, /must be an object/],
      ['array record', (files) => { files[0] = []; }, /must be an object/],
      ['missing identity', (files) => { delete files[0][key]; }, /path is missing/],
      ['empty identity', (files) => { files[0][key] = ''; }, /path is invalid/],
      ['NUL identity', (files) => { files[0][key] = 'a\0b'; }, /path is invalid/],
      ['numeric identity', (files) => { files[0][key] = 7; }, /path is invalid/],
      ['missing digest', (files) => { delete files[0].sha256; }, /SHA-256 is invalid/],
      ['numeric digest', (files) => { files[0].sha256 = 42; }, /SHA-256 is invalid/],
      ['short digest', (files) => { files[0].sha256 = 'a'.repeat(63); }, /SHA-256 is invalid/],
      ['uppercase digest', (files) => { files[0].sha256 = 'A'.repeat(64); }, /SHA-256 is invalid/],
      ['nonhex digest', (files) => { files[0].sha256 = 'z'.repeat(64); }, /SHA-256 is invalid/],
      ['inherited identity', (files) => { files[0] = Object.assign(Object.create({ [key]: files[0][key] }), { sha256: files[0].sha256 }); }, /path is missing/],
      ['inherited digest', (files) => { files[0] = Object.assign(Object.create({ sha256: files[0].sha256 }), { [key]: files[0][key] }); }, /SHA-256 is invalid/],
    ]) {
      test(`${label} ${side}: rejects ${name}`, () => {
        const value = fixture();
        edit(filesOf(value));
        assert.throws(() => assertExactSourceFiles(value), expected);
      });
    }
    for (const invalid of [undefined, null, {}, []]) {
      test(`${label} ${side}: rejects invalid closure ${JSON.stringify(invalid)}`, () => {
        const value = fixture();
        if (side === 'receipt') value.report.inputs[input].files = invalid;
        else value[collection][list] = invalid;
        assert.throws(() => assertExactSourceFiles(value), /file evidence must be a nonempty array/);
      });
    }
  }
}

test('prototype-like filenames are distinct ordinary Map keys', () => {
  const value = fixture();
  const files = ['__proto__', 'constructor', 'toString'].map((path) => ({ path, sha256: hash(path) }));
  value.report.inputs.typespec.files = structuredClone(files);
  value.typespecInventory.files = structuredClone(files);
  assert.doesNotThrow(() => assertExactSourceFiles(value));
  value.typespecInventory.files[0].sha256 = hash('changed');
  assert.throws(() => assertExactSourceFiles(value), /source-file SHA-256 no longer matches/);
});

test('malformed relativePath cannot silently fall back to an absolute path', () => {
  const value = fixture();
  Object.assign(value.authoredCollection.documents[0], { relativePath: null, path: 'main.json' });
  assert.throws(() => assertExactSourceFiles(value), /path is invalid/);
});

test('generated and authored lane closures cannot be swapped', () => {
  const value = fixture();
  [value.generatedCollection.documents, value.authoredCollection.documents] =
    [value.authoredCollection.documents, value.generatedCollection.documents];
  assert.throws(() => assertExactSourceFiles(value), /generated JSON Schema source-file SHA-256 no longer matches/);
});

test('diagnostics choose the same first mismatched identity regardless of file order', () => {
  const value = fixture();
  for (const file of value.typespecInventory.files) file.sha256 = hash('changed');
  const message = () => {
    try { assertExactSourceFiles(value); assert.fail('mismatch must reject'); }
    catch (error) { return error.message; }
  };
  const first = message();
  value.typespecInventory.files.reverse();
  value.report.inputs.typespec.files.reverse();
  assert.equal(message(), first);
});
