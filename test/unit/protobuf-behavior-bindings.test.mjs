import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROTOBUF_BEHAVIOR_BINDINGS_RECEIPT_SCHEMA,
  PROTOBUF_BEHAVIOR_BINDINGS_SCHEMA,
  createProtobufBehaviorBindingsReceipt,
  normalizeProtobufBehaviorBindings,
  verifyProtobufBehaviorBindings,
} from '../../src/protobuf-behavior-bindings.mjs';
import { PROTOBUF_PROJECTION_SCHEMA } from '../../src/protobuf-compatibility.mjs';
import { BEHAVIOR_AUTHORITY, BEHAVIOR_CONTRACT_SCHEMA } from '../../src/behavior-contract.mjs';

function projection(overrides = {}) {
  return {
    schema: PROTOBUF_PROJECTION_SCHEMA,
    syntax: 'proto3',
    package: 'ores.example.v1',
    messages: [],
    enums: [],
    services: [{
      name: 'WidgetService',
      methods: [{
        name: 'GetWidget',
        inputType: '.ores.example.v1.GetWidgetRequest',
        outputType: '.ores.example.v1.Widget',
        clientStreaming: false,
        serverStreaming: false,
        errorModel: null,
      }],
    }],
    ...overrides,
  };
}

function bindings(overrides = {}) {
  return {
    schema: PROTOBUF_BEHAVIOR_BINDINGS_SCHEMA,
    package: 'ores.example.v1',
    bindings: [{
      service: 'WidgetService',
      method: 'GetWidget',
      operationId: 'get_widget',
    }],
    ...overrides,
  };
}

function behaviorContract() {
  return {
    schema: BEHAVIOR_CONTRACT_SCHEMA,
    authority: BEHAVIOR_AUTHORITY,
    operations: [{
      operationId: 'get_widget',
      kind: 'external',
      language: 'none',
      executable: false,
      inputs: [],
      output: null,
      requires: [],
      ensures: [],
      invariants: [],
      expression: null,
      algorithm: null,
      effects: [{ kind: 'read', resource: 'widget-store' }],
      errors: [],
      deterministic: false,
      idempotent: true,
      pure: false,
    }],
  };
}

test('valid RPC behavior binding resolves both normalized projection and behavior authority', () => {
  const result = verifyProtobufBehaviorBindings({
    projection: projection(),
    bindings: bindings(),
    behaviorContract: behaviorContract(),
    requireAllMethods: true,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.admissible, true);
  assert.deepEqual(result.findings, []);
  assert.match(result.projectionDigest, /^[a-f0-9]{64}$/u);
  assert.match(result.behaviorContractDigest, /^[a-f0-9]{64}$/u);
});

test('missing RPC method fails closed', () => {
  const result = verifyProtobufBehaviorBindings({
    projection: projection(),
    bindings: bindings({ bindings: [{ service: 'WidgetService', method: 'DeleteWidget', operationId: 'get_widget' }] }),
    behaviorContract: behaviorContract(),
  });
  assert.equal(result.admissible, false);
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-behavior-rpc-missing'));
});

test('missing behavioral operation ID fails closed', () => {
  const badBindings = bindings();
  badBindings.bindings[0].operationId = 'missing_behavior';
  const result = verifyProtobufBehaviorBindings({
    projection: projection(),
    bindings: badBindings,
    behaviorContract: behaviorContract(),
  });
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-behavior-operation-missing'));
});

test('package mismatch fails closed', () => {
  const result = verifyProtobufBehaviorBindings({
    projection: projection(),
    bindings: bindings({ package: 'ores.other.v1' }),
  });
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-behavior-package-mismatch'));
});

test('requireAllMethods reports unbound RPCs', () => {
  const result = verifyProtobufBehaviorBindings({
    projection: projection(),
    bindings: bindings({ bindings: [] }),
    requireAllMethods: true,
  });
  assert.ok(result.findings.some((item) => item.ruleId === 'protobuf-behavior-rpc-unbound'));
});

test('duplicate service/method bindings are rejected before verification', () => {
  const duplicate = bindings();
  duplicate.bindings.push({ ...duplicate.bindings[0], operationId: 'another' });
  assert.throws(
    () => normalizeProtobufBehaviorBindings(duplicate),
    /duplicate service\/method pairs/u,
  );
});

test('receipt deterministically binds projection, mapping and behavior authority digests', () => {
  const left = createProtobufBehaviorBindingsReceipt({
    projection: projection(),
    bindings: bindings(),
    behaviorContract: behaviorContract(),
  });
  const right = createProtobufBehaviorBindingsReceipt({
    projection: projection(),
    bindings: bindings(),
    behaviorContract: behaviorContract(),
  });
  assert.equal(left.schema, PROTOBUF_BEHAVIOR_BINDINGS_RECEIPT_SCHEMA);
  assert.equal(left.status, 'passed');
  assert.equal(left.verificationId, right.verificationId);
});
