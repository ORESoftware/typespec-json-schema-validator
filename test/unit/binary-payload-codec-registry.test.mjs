import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BINARY_PAYLOAD_CODEC_REGISTRY,
  BINARY_PAYLOAD_CODEC_REGISTRY_SCHEMA,
  canonicalBinaryPayloadCodecRegistry,
  verifyBinaryPayloadCodecRegistry,
} from '../../src/runtime-conformance/codec-registry.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('canonical binary codec registry is admitted', () => {
  const registry = canonicalBinaryPayloadCodecRegistry();
  const receipt = verifyBinaryPayloadCodecRegistry(registry);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.admissible, true);
  assert.equal(receipt.findings.length, 0);
  assert.match(receipt.registryDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    registry.codecs.map(({ name, wireId }) => [name, wireId]),
    [
      ['json', 1],
      ['messagepack', 2],
      ['cbor', 3],
      ['protobuf', 4],
      ['raw', 5],
    ],
  );
});

test('wire id drift fails closed', () => {
  const registry = clone(canonicalBinaryPayloadCodecRegistry());
  registry.codecs.find((codec) => codec.name === 'cbor').wireId = 4;
  const receipt = verifyBinaryPayloadCodecRegistry(registry);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.admissible, false);
  assert.ok(receipt.findings.length > 0);
});

test('media type and alias drift fail closed', () => {
  const registry = clone(canonicalBinaryPayloadCodecRegistry());
  const protobuf = registry.codecs.find((codec) => codec.name === 'protobuf');
  protobuf.mediaType = 'application/protobuf';
  protobuf.mediaTypeAliases = ['application/x-protobuf'];
  const receipt = verifyBinaryPayloadCodecRegistry(registry);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.admissible, false);
  assert.ok(receipt.findings.some((finding) => finding.ruleId === 'binary-codec-definition-drift'));
});

test('missing codec fails closed', () => {
  const registry = clone(canonicalBinaryPayloadCodecRegistry());
  registry.codecs = registry.codecs.filter((codec) => codec.name !== 'raw');
  const receipt = verifyBinaryPayloadCodecRegistry(registry);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.admissible, false);
  assert.ok(receipt.findings.some((finding) => finding.ruleId === 'binary-codec-missing'));
});

test('unknown names and duplicate ids are invalid evidence', () => {
  for (const mutate of [
    (registry) => {
      registry.codecs[0].name = 'msgpack';
    },
    (registry) => {
      registry.codecs[1].wireId = registry.codecs[0].wireId;
    },
  ]) {
    const registry = clone({
      schema: BINARY_PAYLOAD_CODEC_REGISTRY_SCHEMA,
      codecs: BINARY_PAYLOAD_CODEC_REGISTRY,
    });
    mutate(registry);
    const receipt = verifyBinaryPayloadCodecRegistry(registry);
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.admissible, false);
  }
});
