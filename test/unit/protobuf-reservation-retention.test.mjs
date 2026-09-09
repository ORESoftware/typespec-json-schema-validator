import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROTOBUF_PROJECTION_SCHEMA,
  compareProtobufCompatibility,
} from '../../src/protobuf-compatibility.mjs';

function projection() {
  return {
    schema: PROTOBUF_PROJECTION_SCHEMA,
    syntax: 'proto3',
    package: 'ores.reservations.v1',
    messages: [{
      name: 'Record',
      fields: [],
      reservedNumbers: [9],
      reservedNames: ['legacy_field'],
    }],
    enums: [{
      name: 'State',
      values: [{ name: 'STATE_UNSPECIFIED', number: 0 }],
      reservedNumbers: [3],
      reservedNames: ['STATE_DELETED'],
    }],
    services: [],
  };
}

test('baseline protobuf reservations remain permanent even without immediate reuse', () => {
  const baseline = projection();
  const current = structuredClone(baseline);
  current.messages[0].reservedNumbers = [];
  current.messages[0].reservedNames = [];
  current.enums[0].reservedNumbers = [];
  current.enums[0].reservedNames = [];

  const result = compareProtobufCompatibility(baseline, current);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.equal(result.admissible, false);
  assert.deepEqual(
    new Set(result.findings.map((finding) => finding.ruleId)),
    new Set([
      'protobuf-reserved-field-number-unreserved',
      'protobuf-reserved-field-name-unreserved',
      'protobuf-reserved-enum-number-unreserved',
      'protobuf-reserved-enum-name-unreserved',
    ]),
  );
  assert.ok(result.findings.every((finding) => finding.current === null));
});
