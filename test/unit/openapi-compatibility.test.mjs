import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENAPI_COMPATIBILITY_RECEIPT_SCHEMA,
  OPENAPI_PROJECTION_SCHEMA,
  OpenApiProjectionError,
  compareOpenApiCompatibility,
  createOpenApiCompatibilityReceipt,
  normalizeOpenApiProjection,
} from '../../src/openapi-compatibility.mjs';

function behavior() {
  return {
    kind: 'predicate',
    language: 'cel',
    executable: true,
    inputs: [{ name: 'tenant_id', type: 'string', required: true }],
    output: { type: 'boolean', nullable: false },
    requires: ['tenant_id != ""'],
    ensures: [],
    invariants: [],
    expression: 'tenant_id != ""',
    algorithm: null,
    effects: [],
    errors: [],
    deterministic: true,
    idempotent: true,
    pure: true,
  };
}

function projection(overrides = {}) {
  return {
    schema: OPENAPI_PROJECTION_SCHEMA,
    openapi: '3.1.1',
    operations: [
      {
        operationId: 'get_widget',
        method: 'GET',
        path: '/widgets/{widget_id}',
        parameters: [
          { name: 'widget_id', in: 'path', required: true, schemaRef: 'WidgetId' },
          { name: 'trace_id', in: 'header', required: false, schemaRef: 'TraceId' },
        ],
        requestBody: null,
        responses: [
          { status: '200', schemaRef: 'Widget' },
          { status: '404', schemaRef: 'NotFoundError' },
        ],
        behavior: behavior(),
      },
    ],
    ...overrides,
  };
}

test('normalizes OpenAPI operations and accepts unchanged projections', () => {
  const normalized = normalizeOpenApiProjection(projection());
  assert.equal(normalized.operations[0].method, 'GET');
  const result = compareOpenApiCompatibility(normalized, normalized);
  assert.equal(result.status, 'passed');
  assert.equal(result.admissible, true);
  assert.equal(result.breakingChangeCount, 0);
  assert.equal(result.reviewRequiredCount, 0);
});

test('adding an optional query parameter and a response is backward compatible', () => {
  const baseline = projection();
  const current = projection({
    operations: [{
      ...baseline.operations[0],
      parameters: [
        ...baseline.operations[0].parameters,
        { name: 'expand', in: 'query', required: false, schemaRef: 'Expand' },
      ],
      responses: [
        ...baseline.operations[0].responses,
        { status: '304', schemaRef: null },
      ],
    }],
  });
  assert.equal(compareOpenApiCompatibility(baseline, current).admissible, true);
});

test('adding a required parameter is breaking', () => {
  const baseline = projection();
  const current = projection({
    operations: [{
      ...baseline.operations[0],
      parameters: [
        ...baseline.operations[0].parameters,
        { name: 'realm_id', in: 'query', required: true, schemaRef: 'RealmId' },
      ],
    }],
  });
  const result = compareOpenApiCompatibility(baseline, current);
  assert.equal(result.admissible, false);
  assert.ok(result.findings.some((item) => item.ruleId === 'openapi-required-parameter-added'));
});

test('route, request, response and schema changes fail closed', () => {
  const baseline = projection();
  const current = projection({
    operations: [{
      ...baseline.operations[0],
      method: 'POST',
      path: '/v2/widgets/{widget_id}',
      requestBody: { required: true, schemaRef: 'WidgetQuery' },
      responses: [{ status: '200', schemaRef: 'WidgetV2' }],
    }],
  });
  const rules = new Set(compareOpenApiCompatibility(baseline, current).findings.map((item) => item.ruleId));
  assert.ok(rules.has('openapi-route-changed'));
  assert.ok(rules.has('openapi-required-request-body-added'));
  assert.ok(rules.has('openapi-response-schema-changed'));
  assert.ok(rules.has('openapi-response-removed'));
});

test('behavior changes require semantic review instead of guessed equivalence', () => {
  const baseline = projection();
  const current = projection({
    operations: [{
      ...baseline.operations[0],
      behavior: { ...behavior(), expression: 'tenant_id.startsWith("org_")' },
    }],
  });
  const result = compareOpenApiCompatibility(baseline, current);
  assert.equal(result.breakingChangeCount, 0);
  assert.equal(result.reviewRequiredCount, 1);
  assert.equal(result.findings[0].severity, 'review_required');
  assert.equal(result.admissible, false);
});

test('compatibility receipts bind exact normalized projection digests', () => {
  const receipt = createOpenApiCompatibilityReceipt({ baseline: projection(), current: projection() });
  assert.equal(receipt.schema, OPENAPI_COMPATIBILITY_RECEIPT_SCHEMA);
  assert.equal(receipt.status, 'passed');
  assert.match(receipt.baselineDigest, /^[a-f0-9]{64}$/u);
  assert.match(receipt.verificationId, /^[a-f0-9]{64}$/u);
});

test('path parameters must remain required', () => {
  const invalid = projection();
  invalid.operations[0].parameters[0] = {
    name: 'widget_id', in: 'path', required: false, schemaRef: 'WidgetId',
  };
  assert.throws(() => normalizeOpenApiProjection(invalid), OpenApiProjectionError);
});
