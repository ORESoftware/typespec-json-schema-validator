import assert from 'node:assert/strict';
import test from 'node:test';
import { crossValidate } from '../../src/differential.mjs';

function collection(lane, schema) {
  const path = `${lane}.schema.json`;
  const document = { $id: `https://example.test/${path}`, $defs: { Value: schema } };
  return {
    documents: [{ path, relativePath: path, document }],
    declarations: [{ name: 'Value', kind: 'scalar-like', source: path, pointer: '#/$defs/Value', schema }],
  };
}
function check(schema, fixtures) {
  return crossValidate({
    authoredCollection: collection('authored', schema),
    generatedCollection: collection('generated', schema),
    declarationMap: [{ typespec: 'Demo.Value', authored: 'Value', generated: 'Value' }],
    corpus: fixtures.map((fixture, index) => ({
      declaration: 'Value', path: `Value/case-${index}.json`, relativePath: `Value/case-${index}.json`, ...fixture,
    })),
    maxProbes: 64,
  });
}

for (const reverse of [false, true]) {
  test(`duplicate accepted value cannot erase an explicit rejection expectation (reverse=${reverse})`, () => {
    const entries = [
      { instance: 'same', expectation: 'accepted' },
      { instance: 'same', expectation: 'rejected' },
    ];
    if (reverse) entries.reverse();
    const result = check({ type: 'string', enum: ['same'] }, entries);
    assert.equal(result.findings.filter(item => item.ruleId === 'corpus-instance-accepted').length, 1);
    assert.equal(result.summary.corpusInstances, 2);
  });
  test(`duplicate rejected value cannot erase an explicit acceptance expectation (reverse=${reverse})`, () => {
    const entries = [
      { instance: null, expectation: 'rejected' },
      { instance: null, expectation: 'accepted' },
    ];
    if (reverse) entries.reverse();
    const result = check({ type: 'integer' }, entries);
    assert.equal(result.findings.filter(item => item.ruleId === 'corpus-instance-rejected').length, 1);
  });
}

for (const [schema, instance, expectation, ruleId] of [
  [{ type: 'string', enum: ['same'] }, 'same', 'rejected', 'corpus-instance-accepted'],
  [{ type: 'integer' }, null, 'accepted', 'corpus-instance-rejected'],
]) {
  test(`each duplicate fixture retains its own ${expectation} expectation and source diagnostic`, () => {
    const result = check(schema, [{ instance, expectation }, { instance, expectation }]);
    const findings = result.findings.filter(item => item.ruleId === ruleId);
    assert.equal(findings.length, 2);
    assert.ok(findings.some(item => item.message.includes('case-0.json')));
    assert.ok(findings.some(item => item.message.includes('case-1.json')));
  });
}

test('matching expectations may share values with synthesized probes without creating findings', () => {
  const result = check({ type: 'string', enum: ['same'] }, [
    { instance: 'same', expectation: 'accepted' },
    { instance: 'same', expectation: 'accepted' },
    { instance: null, expectation: 'rejected' },
    { instance: null, expectation: 'rejected' },
  ]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.corpusInstances, 4);
});

test('unknown corpus declaration still fails rather than being treated as consumed', () => {
  const result = check({ type: 'integer' }, [{ declaration: 'Missing', instance: 1, expectation: 'accepted' }]);
  assert.ok(result.findings.some(item => item.ruleId === 'corpus-declaration-unknown'));
});

for (const annotation of [{ default: null }, { examples: [null] }]) {
  test(`both lanes retain their own invalid ${Object.keys(annotation)[0]} diagnostic`, () => {
    const result = check({ type: 'integer', ...annotation }, []);
    const findings = result.findings.filter(item => item.ruleId === 'declared-example-rejected');
    assert.equal(findings.length, 2);
    assert.ok(findings.some(item => item.message.startsWith('authored declaration')));
    assert.ok(findings.some(item => item.message.startsWith('generated declaration')));
  });
}
