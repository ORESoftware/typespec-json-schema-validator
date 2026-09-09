import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  PROTOBUF_COMPATIBILITY_RECEIPT_SCHEMA,
  PROTOBUF_PROJECTION_SCHEMA,
  compareProtobufCompatibility,
  createProtobufCompatibilityReceipt,
  normalizeProtobufProjection,
  writeProtobufCompatibilityReceipt,
} from '../../src/protobuf-compatibility.mjs';

function projection(overrides = {}) {
  return {
    schema: PROTOBUF_PROJECTION_SCHEMA,
    syntax: 'proto3',
    package: 'ores.example.v1',
    messages: [{
      name: 'Widget',
      fields: [
        { name: 'id', number: 1, type: 'string', cardinality: 'singular', presence: 'implicit', oneof: null, jsonName: 'id' },
        { name: 'status', number: 2, type: '.ores.example.v1.Status', cardinality: 'optional', presence: 'explicit', oneof: null, jsonName: 'status' },
      ],
      reservedNumbers: [9],
      reservedNames: ['legacy'],
    }],
    enums: [{
      name: 'Status',
      values: [{ name: 'STATUS_UNSPECIFIED', number: 0 }, { name: 'ACTIVE', number: 1 }],
      reservedNumbers: [3],
      reservedNames: ['DELETED'],
    }],
    services: [{
      name: 'WidgetService',
      methods: [{
        name: 'GetWidget',
        inputType: '.ores.example.v1.GetWidgetRequest',
        outputType: '.ores.example.v1.Widget',
        clientStreaming: false,
        serverStreaming: false,
        errorModel: '.google.rpc.Status',
      }],
    }],
    ...overrides,
  };
}

test('additive messages, fields, enum values, and methods remain compatible', () => {
  const current = projection();
  current.messages[0].fields.push({ name: 'display_name', number: 3, type: 'string', cardinality: 'optional', presence: 'explicit', oneof: null, jsonName: 'displayName' });
  current.enums[0].values.push({ name: 'PAUSED', number: 2 });
  current.services[0].methods.push({ name: 'ListWidgets', inputType: '.ores.example.v1.ListWidgetsRequest', outputType: '.ores.example.v1.ListWidgetsResponse', clientStreaming: false, serverStreaming: false, errorModel: '.google.rpc.Status' });
  const result = compareProtobufCompatibility(projection(), current);
  assert.equal(result.status, 'passed');
  assert.equal(result.findings.length, 0);
});

test('field removal requires both name and number reservation', () => {
  const current = projection();
  current.messages[0].fields = current.messages[0].fields.filter((field) => field.name !== 'status');
  let result = compareProtobufCompatibility(projection(), current);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-field-removal-not-reserved'));
  current.messages[0].reservedNumbers.push(2);
  current.messages[0].reservedNames.push('status');
  result = compareProtobufCompatibility(projection(), current);
  assert.equal(result.status, 'passed');
});

test('wire number, type, presence, json name, and oneof changes stop promotion', () => {
  const current = projection();
  Object.assign(current.messages[0].fields[0], {
    number: 5,
    type: 'bytes',
    presence: 'explicit',
    oneof: 'choice',
    jsonName: 'identifier',
  });
  const result = compareProtobufCompatibility(projection(), current);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-field-number-changed'));
});

test('reserved field and enum identities cannot be reused', () => {
  const current = projection();
  current.messages[0].fields.push({ name: 'legacy', number: 9, type: 'string', cardinality: 'singular', presence: 'implicit', oneof: null, jsonName: 'legacy' });
  current.messages[0].reservedNumbers = [];
  current.messages[0].reservedNames = [];
  current.enums[0].values.push({ name: 'DELETED', number: 3 });
  current.enums[0].reservedNumbers = [];
  current.enums[0].reservedNames = [];
  const result = compareProtobufCompatibility(projection(), current);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-reserved-field-number-reused'));
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-reserved-enum-number-reused'));
});

test('streaming and error-model changes are breaking', () => {
  const current = projection();
  current.services[0].methods[0].serverStreaming = true;
  current.services[0].methods[0].errorModel = null;
  const result = compareProtobufCompatibility(projection(), current);
  assert.equal(result.status, 'stopped_for_evaluation');
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-method-serverStreaming-changed'));
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-method-errorModel-changed'));
});

test('malformed projections fail closed before comparison', () => {
  const bad = projection();
  bad.messages[0].fields.push({ ...bad.messages[0].fields[0] });
  assert.throws(() => normalizeProtobufProjection(bad), /duplicate names/u);
});

test('receipt is deterministic and self-digesting', () => {
  const left = createProtobufCompatibilityReceipt({ baseline: projection(), current: projection() });
  const right = createProtobufCompatibilityReceipt({ baseline: projection(), current: projection() });
  assert.equal(left.schema, PROTOBUF_COMPATIBILITY_RECEIPT_SCHEMA);
  assert.equal(left.status, 'passed');
  assert.equal(left.verificationId, right.verificationId);
});

test('safe receipt writer replaces only recognized receipt files', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'tjsv-protobuf-'));
  const target = resolve(root, 'receipt.json');
  const receipt = createProtobufCompatibilityReceipt({ baseline: projection(), current: projection() });
  await writeProtobufCompatibilityReceipt(target, receipt);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).verificationId, receipt.verificationId);
  const victim = resolve(root, 'victim.json');
  await writeFile(victim, '{}\n');
  const link = resolve(root, 'link.json');
  await symlink(victim, link);
  await assert.rejects(() => writeProtobufCompatibilityReceipt(link, receipt), /singly linked regular file/u);
});

test('enum zero, negative values, and reservations are normalized deterministically', () => {
  const current = projection();
  current.enums[0].values.push({ name: 'LEGACY_NEGATIVE', number: -1 });
  current.enums[0].reservedNumbers.push(-2, 0);
  current.enums[0].values = current.enums[0].values.filter((item) => item.number !== 0);
  current.enums[0].reservedNames.push('STATUS_UNSPECIFIED');
  const normalized = normalizeProtobufProjection(current);
  assert.deepEqual(normalized.enums[0].reservedNumbers, [-2, 0, 3]);
});

test('protobuf field-number forbidden range is rejected', () => {
  const bad = projection();
  bad.messages[0].fields[0].number = 19_000;
  assert.throws(() => normalizeProtobufProjection(bad), /valid protobuf field number/u);
});

test('truncation is reported only when more findings exist than the configured limit', () => {
  const one = projection({ package: 'ores.changed.v1' });
  const exactlyOne = compareProtobufCompatibility(projection(), one, { maxFindings: 1 });
  assert.equal(exactlyOne.findings.length, 1);
  assert.equal(exactlyOne.truncated, false);

  const many = projection({ package: 'ores.changed.v1' });
  many.services[0].methods[0].serverStreaming = true;
  const truncated = compareProtobufCompatibility(projection(), many, { maxFindings: 1 });
  assert.equal(truncated.findings.length, 1);
  assert.equal(truncated.truncated, true);
});
