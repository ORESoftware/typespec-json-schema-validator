import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeEvidence } from '../../src/runtime-conformance/normalize.mjs';
import { RUNTIME_EVIDENCE_SCHEMA } from '../../src/runtime-conformance/constants.mjs';

function evidence() {
  return {
    schema: RUNTIME_EVIDENCE_SCHEMA,
    contractIrId: 'a'.repeat(64),
    inputDigest: 'b'.repeat(64),
    corpusDigest: 'c'.repeat(64),
    adapters: [{
      id: 'rust-serde', language: 'rust', runtime: 'rust', validator: 'serde',
      toolchain: 'rustc', status: 'passed',
      results: [{ caseId: 'user.valid', declaration: 'Example.User', verdict: 'accepted' }],
    }],
  };
}

const envelopes = [
  { name: 'evidence', select: value => value,
    replace: (_value, replacement) => replacement,
    fields: ['schema', 'contractIrId', 'inputDigest', 'corpusDigest', 'adapters'] },
  { name: 'adapter', select: value => value.adapters[0],
    replace: (value, replacement) => { value.adapters[0] = replacement; return value; },
    fields: ['id', 'language', 'runtime', 'validator', 'toolchain', 'status', 'results'] },
  { name: 'result', select: value => value.adapters[0].results[0],
    replace: (value, replacement) => { value.adapters[0].results[0] = replacement; return value; },
    fields: ['caseId', 'declaration', 'verdict'] },
];

function shapeFinding(value, name) {
  const { findings } = validateRuntimeEvidence(value);
  const finding = findings.find(item => item.ruleId === `runtime-${name}-fields-invalid`);
  assert.ok(finding, `${name} shape drift must produce a blocking finding`);
  assert.equal(finding.severity, 'error');
  assert.equal(finding.resolutionState, 'unexplained');
  return finding;
}

test('accepts an exact runtime evidence envelope without mutating it', () => {
  const value = evidence();
  const before = structuredClone(value);
  const result = validateRuntimeEvidence(value);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(value, before);
  assert.ok(Object.isFrozen(result.normalized));
});

for (const field of ['contractIrId', 'inputDigest', 'corpusDigest']) {
  for (const [label, make] of [
    ['array', digest => [digest]],
    ['nested-array', digest => [[digest]]],
    ['boxed-string', digest => new String(digest)],
    ['number', () => 1],
    ['null', () => null],
    ['trailing-newline', digest => `${digest}\n`],
    ['uppercase', digest => digest.toUpperCase()],
  ]) {
    test(`${field} rejects ${label} instead of coercing it`, () => {
      const value = evidence();
      value[field] = make(value[field]);
      const result = validateRuntimeEvidence(value);
      assert.ok(result.findings.some(item => item.ruleId === 'runtime-evidence-invalid-digest'
        && item.pointer === `#/${field}`));
      assert.equal(result.normalized[field], null);
    });
  }
  test(`${field} does not execute coercion or serialize an invalid digest object`, () => {
    const value = evidence();
    let calls = 0;
    value[field] = {
      toString() { calls += 1; throw new Error('unexpected coercion'); },
      toJSON() { calls += 1; throw new Error('unexpected serialization'); },
    };
    const result = validateRuntimeEvidence(value);
    assert.equal(calls, 0);
    assert.ok(result.findings.some(item => item.ruleId === 'runtime-evidence-invalid-digest'));
  });
}

for (const envelope of envelopes) {
  const { name, select, replace, fields } = envelope;
  for (const field of fields) {
    for (const kind of ['missing', 'inherited', 'non-enumerable', 'accessor']) {
      test(`${name}.${field} rejects ${kind} required fields`, () => {
        let value = evidence();
        const object = select(value);
        const original = object[field];
        let calls = 0;
        if (kind === 'missing' || kind === 'inherited') delete object[field];
        if (kind === 'inherited') Object.setPrototypeOf(object, { [field]: original });
        if (kind === 'non-enumerable') {
          Object.defineProperty(object, field, { value: original, enumerable: false });
        }
        if (kind === 'accessor') {
          Object.defineProperty(object, field, {
            get() { calls += 1; throw new Error('unexpected getter'); }, enumerable: true,
          });
        }
        value = replace(value, object);
        shapeFinding(value, name);
        assert.equal(calls, 0);
      });
    }
  }
  for (const key of ['extra', '__proto__', 'payload/~raw']) {
    test(`${name} rejects unknown ${key} without reporting the value`, () => {
      const value = evidence();
      Object.defineProperty(select(value), key, {
        value: 'do-not-copy-untrusted-payload', enumerable: true,
      });
      const finding = shapeFinding(value, name);
      assert.ok(!JSON.stringify(finding).includes('do-not-copy-untrusted-payload'));
    });
  }
  test(`${name} does not invoke getters for unknown fields`, () => {
    const value = evidence();
    Object.defineProperty(select(value), 'extra', {
      enumerable: true, get() { throw new Error('unexpected unknown getter'); },
    });
    shapeFinding(value, name);
  });
  test(`${name} accepts an exact null-prototype envelope`, () => {
    let value = evidence();
    value = replace(value, Object.assign(Object.create(null), select(value)));
    assert.deepEqual(validateRuntimeEvidence(value).findings, []);
  });
  test(`${name} field diagnostics are deterministic and bounded`, () => {
    const first = evidence();
    const second = evidence();
    const keys = Array.from({ length: 100 }, (_, index) => `extra-${index}`);
    for (const key of keys) select(first)[key] = 1;
    for (const key of [...keys].reverse()) select(second)[key] = 2;
    const finding = shapeFinding(first, name);
    assert.deepEqual(finding, shapeFinding(second, name));
    assert.equal(finding.left.unexpectedCount, 100);
    assert.equal(finding.left.unexpected.length, 16);
  });
}
