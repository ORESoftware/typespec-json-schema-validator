import assert from 'node:assert/strict';
import test from 'node:test';
import { crossValidate } from '../../src/differential.mjs';

const authority = { type: 'string', enum: ['typespec', 'json-schema'] };
function collection(path, schema) {
  return {
    documents: [{ path, relativePath: path, document: { $defs: { Value: schema } } }],
    declarations: [{ name: 'Value', source: path, pointer: '#/$defs/Value', schema }],
  };
}
function check(corpus, schema = authority) {
  return crossValidate({
    authoredCollection: collection('authored.schema.json', structuredClone(schema)),
    generatedCollection: collection('generated.schema.json', structuredClone(schema)),
    declarationMap: [{ typespec: 'Fixture.Value', authored: 'Value', generated: 'Value' }],
    corpus, maxProbes: 64, maxFindings: 100,
  });
}
function fixture(instance, expectation, name) {
  return { declaration: 'Value', expectation, instance, path: `Value/${name}.json`, relativePath: `Value/${name}.json` };
}

for (const value of ['typespec', 'json-schema']) {
  test(`recorded invalid ${value} is checked even when synthesis already accepted it`, () => {
    const result = check([fixture(value, 'rejected', 'invalid/mislabeled')]);
    assert.equal(result.summary.divergences, 0, 'the authorities agree; the independent expectation does not');
    assert.ok(result.findings.some(item => item.ruleId === 'corpus-instance-accepted'));
  });
}

for (const reverse of [false, true]) {
  test(`contradictory corpus expectations cannot be hidden by file order (reverse=${reverse})`, () => {
    const corpus = [
      fixture('typespec', 'accepted', 'valid/first'),
      fixture('typespec', 'rejected', 'invalid/second'),
    ];
    if (reverse) corpus.reverse();
    const result = check(corpus);
    const failures = result.findings.filter(item => item.ruleId === 'corpus-instance-accepted');
    assert.equal(failures.length, 1);
    assert.match(failures[0].message, /Value\/invalid\/second\.json/);
  });
}

test('both duplicate recorded valid files are evaluated rather than merely counted as loaded', () => {
  const baseline = check([]);
  const result = check([
    fixture('typespec', 'accepted', 'valid/one'),
    fixture('typespec', 'accepted', 'valid/two'),
  ]);
  assert.equal(result.findings.length, 0);
  assert.equal(result.summary.corpusInstances, 2);
  assert.equal(result.summary.probesEvaluated, baseline.summary.probesEvaluated + 2);
  assert.equal(result.summary.agreements, baseline.summary.agreements + 2);
});

test('each mislabeled duplicate retains its own failure provenance', () => {
  const result = check([
    fixture('protobuf', 'accepted', 'valid/one'),
    fixture('protobuf', 'accepted', 'valid/two'),
  ]);
  const failures = result.findings.filter(item => item.ruleId === 'corpus-instance-rejected');
  assert.equal(failures.length, 2);
  assert.ok(failures.some(item => item.message.includes('Value/valid/one.json')));
  assert.ok(failures.some(item => item.message.includes('Value/valid/two.json')));
});

test('canonical object key reordering cannot hide a contradictory expectation', () => {
  const schema = { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'], additionalProperties: false };
  const result = check([
    fixture({ a: 1, b: 2 }, 'accepted', 'valid/ordered'),
    fixture({ b: 2, a: 1 }, 'rejected', 'invalid/reordered'),
  ], schema);
  assert.equal(result.findings.filter(item => item.ruleId === 'corpus-instance-accepted').length, 1);
});

test('unknown corpus declarations still fail rather than being ignored', () => {
  const result = check([{ ...fixture('typespec', 'accepted', 'valid/unknown'), declaration: 'Missing' }]);
  assert.ok(result.findings.some(item => item.ruleId === 'corpus-declaration-unknown'));
});
