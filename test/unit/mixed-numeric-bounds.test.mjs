import assert from 'node:assert/strict';
import test from 'node:test';
import { validateJsonSchemaDocument } from '../../src/json-schema.mjs';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const cases = [
  { name: 'equal inclusive bounds admit the endpoint', bounds: { minimum: 5, maximum: 5 }, rejected: false },
  { name: 'reversed inclusive bounds are impossible', bounds: { minimum: 6, maximum: 5 }, rejected: true },
  { name: 'equal exclusive lower and inclusive upper are impossible', bounds: { exclusiveMinimum: 5, maximum: 5 }, rejected: true },
  { name: 'equal inclusive lower and exclusive upper are impossible', bounds: { minimum: 5, exclusiveMaximum: 5 }, rejected: true },
  { name: 'equal exclusive endpoints are impossible', bounds: { exclusiveMinimum: 5, exclusiveMaximum: 5 }, rejected: true },
  { name: 'exclusive lower bound can be stricter than inclusive lower', bounds: { minimum: 1, exclusiveMinimum: 5, maximum: 6 }, rejected: false },
  { name: 'exclusive upper bound can be stricter than inclusive upper', bounds: { minimum: 1, maximum: 9, exclusiveMaximum: 3 }, rejected: false },
  { name: 'mixed bounds that cross are impossible', bounds: { minimum: 8, exclusiveMaximum: 3 }, rejected: true },
  { name: 'weaker inclusive limit cannot mask an impossible exclusive limit', bounds: { minimum: 0, exclusiveMinimum: 6, maximum: 5, exclusiveMaximum: 10 }, rejected: true },
  { name: 'duplicate contradictory pairs produce one finding', bounds: { minimum: 8, exclusiveMinimum: 9, maximum: 3, exclusiveMaximum: 2 }, rejected: true },
  { name: 'decimal interval with real values is allowed', bounds: { exclusiveMinimum: 0, exclusiveMaximum: 1 }, rejected: false },
];

for (const { name, bounds, rejected } of cases) {
  test(`mixed numeric bounds: ${name}`, () => {
    const document = { $schema: dialect, $defs: { Interval: { type: 'number', ...bounds } } };
    const findings = validateJsonSchemaDocument(document, 'interval.schema.json');
    const intervals = findings.filter(({ ruleId }) => ruleId === 'json-schema-impossible-range');
    assert.equal(intervals.length, rejected ? 1 : 0, JSON.stringify(findings));
    if (rejected) {
      assert.equal(intervals[0].pointer, '#/$defs/Interval');
      assert.equal(intervals[0].source, 'interval.schema.json');
    } else {
      assert.deepEqual(findings, []);
    }
  });
}

test('invalid numeric keyword syntax is diagnosed without pretending to compare it', () => {
  const findings = validateJsonSchemaDocument({
    $schema: dialect,
    minimum: '5',
    exclusiveMaximum: 4,
  });
  assert.ok(findings.some(({ ruleId }) => ruleId === 'json-schema-invalid-number'));
  assert.ok(!findings.some(({ ruleId }) => ruleId === 'json-schema-impossible-range'));
});

test('cardinality bounds retain their existing behavior', () => {
  const findings = validateJsonSchemaDocument({ $schema: dialect, minItems: 4, maxItems: 3 });
  assert.deepEqual(
    findings.filter(({ ruleId }) => ruleId === 'json-schema-impossible-range').map(({ pointer }) => pointer),
    ['#'],
  );
});
