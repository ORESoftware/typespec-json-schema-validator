import { canonicalStringify, isPlainObject, sha256 } from './canonical.mjs';
import { normalizeEmbeddedBehavior } from './behavior-contract.mjs';

export const OPENAPI_PROJECTION_SCHEMA =
  'ores.typespec-json-schema-validator.openapi-projection/v1';
export const OPENAPI_COMPATIBILITY_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.openapi-compatibility-receipt/v1';

const METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE']);
const PARAMETER_LOCATIONS = new Set(['cookie', 'header', 'path', 'query']);
const STATUS = /^(?:[1-5](?:[0-9]{2}|XX)|default)$/u;

export class OpenApiProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OpenApiProjectionError';
  }
}

function fail(message) {
  throw new OpenApiProjectionError(message);
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    fail(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be a non-empty control-free string`);
  }
  return value;
}

function bool(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
  return value;
}

function schemaRef(value, label) {
  return value === null ? null : nonEmptyString(value, label);
}

function normalizeParameter(value, label) {
  exactKeys(value, ['name', 'in', 'required', 'schemaRef'], label);
  const location = nonEmptyString(value.in, `${label}.in`);
  if (!PARAMETER_LOCATIONS.has(location)) fail(`${label}.in is unsupported`);
  const required = bool(value.required, `${label}.required`);
  if (location === 'path' && !required) fail(`${label}.required must be true for path parameters`);
  return Object.freeze({
    name: nonEmptyString(value.name, `${label}.name`),
    in: location,
    required,
    schemaRef: nonEmptyString(value.schemaRef, `${label}.schemaRef`),
  });
}

function normalizeRequestBody(value, label) {
  if (value === null) return null;
  exactKeys(value, ['required', 'schemaRef'], label);
  return Object.freeze({
    required: bool(value.required, `${label}.required`),
    schemaRef: nonEmptyString(value.schemaRef, `${label}.schemaRef`),
  });
}

function normalizeResponse(value, label) {
  exactKeys(value, ['status', 'schemaRef'], label);
  const rawStatus = nonEmptyString(value.status, `${label}.status`);
  const status = rawStatus.toLowerCase() === 'default' ? 'default' : rawStatus.toUpperCase();
  if (!STATUS.test(status)) fail(`${label}.status is unsupported`);
  return Object.freeze({
    status,
    schemaRef: schemaRef(value.schemaRef, `${label}.schemaRef`),
  });
}

function normalizeOperation(value, label) {
  exactKeys(value, [
    'operationId', 'method', 'path', 'parameters', 'requestBody', 'responses', 'behavior',
  ], label);
  const method = nonEmptyString(value.method, `${label}.method`).toUpperCase();
  if (!METHODS.has(method)) fail(`${label}.method is unsupported`);
  const path = nonEmptyString(value.path, `${label}.path`);
  if (!path.startsWith('/')) fail(`${label}.path must start with /`);
  if (!Array.isArray(value.parameters)) fail(`${label}.parameters must be an array`);
  const parameters = value.parameters
    .map((item, index) => normalizeParameter(item, `${label}.parameters[${index}]`))
    .sort((left, right) => left.in.localeCompare(right.in) || left.name.localeCompare(right.name));
  const parameterKeys = parameters.map((item) => `${item.in}\u0000${item.name.toLowerCase()}`);
  if (new Set(parameterKeys).size !== parameterKeys.length) {
    fail(`${label}.parameters contains duplicate location/name pairs`);
  }
  if (!Array.isArray(value.responses) || value.responses.length === 0) {
    fail(`${label}.responses must be a non-empty array`);
  }
  const responses = value.responses
    .map((item, index) => normalizeResponse(item, `${label}.responses[${index}]`))
    .sort((left, right) => left.status.localeCompare(right.status));
  const statuses = responses.map((item) => item.status);
  if (new Set(statuses).size !== statuses.length) fail(`${label}.responses contains duplicate statuses`);
  return Object.freeze({
    operationId: nonEmptyString(value.operationId, `${label}.operationId`),
    method,
    path,
    parameters: Object.freeze(parameters),
    requestBody: normalizeRequestBody(value.requestBody, `${label}.requestBody`),
    responses: Object.freeze(responses),
    behavior: value.behavior === null ? null : normalizeEmbeddedBehavior(value.behavior),
  });
}

export function normalizeOpenApiProjection(value) {
  exactKeys(value, ['schema', 'openapi', 'operations'], 'projection');
  if (value.schema !== OPENAPI_PROJECTION_SCHEMA) fail('projection.schema is unsupported');
  if (value.openapi !== '3.1.0' && value.openapi !== '3.1.1') {
    fail('projection.openapi must be 3.1.0 or 3.1.1');
  }
  if (!Array.isArray(value.operations)) fail('projection.operations must be an array');
  const operations = value.operations
    .map((item, index) => normalizeOperation(item, `projection.operations[${index}]`))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  const operationIds = operations.map((item) => item.operationId);
  if (new Set(operationIds).size !== operationIds.length) {
    fail('projection.operations contains duplicate operationId values');
  }
  const routes = operations.map((item) => `${item.method}\u0000${item.path}`);
  if (new Set(routes).size !== routes.length) {
    fail('projection.operations contains duplicate method/path routes');
  }
  return Object.freeze({
    schema: OPENAPI_PROJECTION_SCHEMA,
    openapi: value.openapi,
    operations: Object.freeze(operations),
  });
}

function projectionDigest(value) {
  return sha256(canonicalStringify(value));
}

function finding(ruleId, subject, message, baseline, current, severity = 'breaking') {
  const body = { ruleId, severity, subject, message, baseline, current };
  return Object.freeze({ ...body, fingerprint: sha256(canonicalStringify(body)) });
}

function parameterMap(operation) {
  return new Map(operation.parameters.map((parameter) => [
    `${parameter.in}\u0000${parameter.name.toLowerCase()}`,
    parameter,
  ]));
}

function responseMap(operation) {
  return new Map(operation.responses.map((response) => [response.status, response]));
}

function compareOperation(baseline, current, findings) {
  const subject = baseline.operationId;
  if (baseline.method !== current.method || baseline.path !== current.path) {
    findings.push(finding(
      'openapi-route-changed',
      subject,
      'An existing operation changed HTTP method or path.',
      { method: baseline.method, path: baseline.path },
      { method: current.method, path: current.path },
    ));
  }

  const baselineParameters = parameterMap(baseline);
  const currentParameters = parameterMap(current);
  for (const [key, parameter] of baselineParameters) {
    const next = currentParameters.get(key);
    if (!next) {
      findings.push(finding(
        'openapi-parameter-removed', subject,
        `Existing ${parameter.in} parameter ${parameter.name} was removed.`,
        parameter, null,
      ));
      continue;
    }
    if (parameter.schemaRef !== next.schemaRef) {
      findings.push(finding(
        'openapi-parameter-schema-changed', subject,
        `Parameter ${parameter.name} changed schema reference.`,
        parameter.schemaRef, next.schemaRef,
      ));
    }
    if (!parameter.required && next.required) {
      findings.push(finding(
        'openapi-parameter-became-required', subject,
        `Parameter ${parameter.name} became required.`, false, true,
      ));
    }
  }
  for (const [key, parameter] of currentParameters) {
    if (!baselineParameters.has(key) && parameter.required) {
      findings.push(finding(
        'openapi-required-parameter-added', subject,
        `New required ${parameter.in} parameter ${parameter.name} was added.`,
        null, parameter,
      ));
    }
  }

  if (baseline.requestBody === null && current.requestBody?.required) {
    findings.push(finding(
      'openapi-required-request-body-added', subject,
      'An operation that accepted no request body now requires one.',
      null, current.requestBody,
    ));
  } else if (baseline.requestBody !== null && current.requestBody === null) {
    findings.push(finding(
      'openapi-request-body-removed', subject,
      'An existing request body contract was removed.',
      baseline.requestBody, null,
    ));
  } else if (baseline.requestBody !== null && current.requestBody !== null) {
    if (baseline.requestBody.schemaRef !== current.requestBody.schemaRef) {
      findings.push(finding(
        'openapi-request-body-schema-changed', subject,
        'The request body schema reference changed.',
        baseline.requestBody.schemaRef, current.requestBody.schemaRef,
      ));
    }
    if (!baseline.requestBody.required && current.requestBody.required) {
      findings.push(finding(
        'openapi-request-body-became-required', subject,
        'The request body became required.', false, true,
      ));
    }
  }

  const baselineResponses = responseMap(baseline);
  const currentResponses = responseMap(current);
  for (const [status, response] of baselineResponses) {
    const next = currentResponses.get(status);
    if (!next) {
      findings.push(finding(
        'openapi-response-removed', subject,
        `Existing response ${status} was removed.`, response, null,
      ));
      continue;
    }
    if (response.schemaRef !== next.schemaRef) {
      findings.push(finding(
        'openapi-response-schema-changed', subject,
        `Response ${status} changed schema reference.`, response.schemaRef, next.schemaRef,
      ));
    }
  }

  if (canonicalStringify(baseline.behavior) !== canonicalStringify(current.behavior)) {
    findings.push(finding(
      'openapi-behavior-changed', subject,
      'Behavior metadata changed and requires semantic review or executable behavior evidence.',
      baseline.behavior, current.behavior, 'review_required',
    ));
  }
}

export function compareOpenApiCompatibility(baselineValue, currentValue, options = {}) {
  const maxFindings = options.maxFindings ?? 1000;
  if (!Number.isSafeInteger(maxFindings) || maxFindings < 1 || maxFindings > 100000) {
    fail('options.maxFindings must be an integer between 1 and 100000');
  }
  const baseline = normalizeOpenApiProjection(baselineValue);
  const current = normalizeOpenApiProjection(currentValue);
  const findings = [];
  const baselineOperations = new Map(baseline.operations.map((operation) => [operation.operationId, operation]));
  const currentOperations = new Map(current.operations.map((operation) => [operation.operationId, operation]));

  for (const [operationId, operation] of baselineOperations) {
    const next = currentOperations.get(operationId);
    if (!next) {
      findings.push(finding(
        'openapi-operation-removed', operationId,
        'An existing OpenAPI operation was removed.', operation, null,
      ));
      continue;
    }
    compareOperation(operation, next, findings);
  }

  findings.sort((left, right) => left.subject.localeCompare(right.subject)
    || left.ruleId.localeCompare(right.ruleId)
    || left.fingerprint.localeCompare(right.fingerprint));
  const truncated = findings.length > maxFindings;
  const visible = Object.freeze(findings.slice(0, maxFindings));
  const breakingChangeCount = findings.filter((item) => item.severity === 'breaking').length;
  const reviewRequiredCount = findings.filter((item) => item.severity === 'review_required').length;
  const admissible = findings.length === 0;
  return Object.freeze({
    baseline,
    current,
    baselineDigest: projectionDigest(baseline),
    currentDigest: projectionDigest(current),
    status: admissible ? 'passed' : 'stopped_for_evaluation',
    admissible,
    breakingChangeCount,
    reviewRequiredCount,
    findings: visible,
    truncated,
  });
}

export function createOpenApiCompatibilityReceipt(input) {
  if (!isPlainObject(input)) fail('input must be an object');
  const comparison = compareOpenApiCompatibility(input.baseline, input.current, {
    maxFindings: input.maxFindings,
  });
  const body = {
    schema: OPENAPI_COMPATIBILITY_RECEIPT_SCHEMA,
    status: comparison.status,
    admissible: comparison.admissible,
    baselineDigest: comparison.baselineDigest,
    currentDigest: comparison.currentDigest,
    breakingChangeCount: comparison.breakingChangeCount,
    reviewRequiredCount: comparison.reviewRequiredCount,
    truncated: comparison.truncated,
    findings: comparison.findings,
  };
  return Object.freeze({
    ...body,
    verificationId: sha256(canonicalStringify(body)),
  });
}
