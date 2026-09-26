const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "generated_by",
  "endpoint",
  "authority",
  "operations",
]);

const OPERATION_KEYS = Object.freeze([
  "operation_key",
  "semantic_function",
  "semantic_authority",
  "semantic_source",
  "kind",
  "field",
  "stream",
  "graphql_source",
]);

const KIND_ORDER = Object.freeze({ query: 0, mutation: 1, subscription: 2 });

export const GRAPHQL_PROJECTION_SCHEMA_VERSION = 1;
export const GRAPHQL_V1_ENDPOINT = "/v1/graphql";
export const GRAPHQL_PROJECTION_AUTHORITY = "resolvers.rs";
export const GRAPHQL_PROJECTION_GENERATOR = "ores-stack";

const operationKeyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/u;
const rustIdentPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const graphqlNamePattern = /^[_A-Za-z][_0-9A-Za-z]*$/u;
const graphqlSourcePattern = /^src\/graphql\/(?:.+\/)?resolvers\.rs$/u;
const semanticHandlersPattern = /^src\/routes\/rest\/.+\/handlers\.rs$/u;
const semanticFuncsPattern = /^src\/rpc\/.+\/funcs\.rs$/u;

function ownKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

function exactKeys(value, expected, path, findings) {
  const actual = ownKeys(value);
  const expectedSet = new Set(expected);
  for (const key of actual) if (!expectedSet.has(key)) findings.push(`${path} contains unsupported key ${JSON.stringify(key)}`);
  for (const key of expected) if (!Object.prototype.hasOwnProperty.call(value, key)) findings.push(`${path} is missing required key ${JSON.stringify(key)}`);
}

function validateOperation(operation, index, findings) {
  const path = `operations[${index}]`;
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    findings.push(`${path} must be an object`);
    return;
  }
  exactKeys(operation, OPERATION_KEYS, path, findings);
  if (typeof operation.operation_key !== "string" || !operationKeyPattern.test(operation.operation_key)) findings.push(`${path}.operation_key must be a stable lowercase dotted/object key`);
  if (typeof operation.semantic_function !== "string" || !rustIdentPattern.test(operation.semantic_function)) findings.push(`${path}.semantic_function must be a Rust identifier`);
  if (!new Set(["handlers.rs", "funcs.rs"]).has(operation.semantic_authority)) findings.push(`${path}.semantic_authority must be handlers.rs or funcs.rs`);
  const sourceMatchesAuthority = operation.semantic_authority === "handlers.rs"
    ? typeof operation.semantic_source === "string" && semanticHandlersPattern.test(operation.semantic_source)
    : operation.semantic_authority === "funcs.rs"
      ? typeof operation.semantic_source === "string" && semanticFuncsPattern.test(operation.semantic_source)
      : false;
  if (!sourceMatchesAuthority) findings.push(`${path}.semantic_source does not match semantic_authority`);
  if (!Object.prototype.hasOwnProperty.call(KIND_ORDER, operation.kind)) findings.push(`${path}.kind must be query, mutation, or subscription`);
  if (typeof operation.field !== "string" || !graphqlNamePattern.test(operation.field) || operation.field.startsWith("__")) findings.push(`${path}.field must be a non-introspection GraphQL Name`);
  if (!new Set(["unary", "server_stream"]).has(operation.stream)) findings.push(`${path}.stream must be unary or server_stream`);
  else if (operation.kind === "subscription" && operation.stream !== "server_stream") findings.push(`${path} subscription must use server_stream`);
  else if ((operation.kind === "query" || operation.kind === "mutation") && operation.stream !== "unary") findings.push(`${path} ${operation.kind} must use unary`);
  if (typeof operation.graphql_source !== "string" || !graphqlSourcePattern.test(operation.graphql_source)) findings.push(`${path}.graphql_source must be src/graphql/**/resolvers.rs`);
}

function compareOperations(left, right) {
  return (KIND_ORDER[left.kind] ?? Number.MAX_SAFE_INTEGER) - (KIND_ORDER[right.kind] ?? Number.MAX_SAFE_INTEGER)
    || String(left.field).localeCompare(String(right.field), "en")
    || String(left.operation_key).localeCompare(String(right.operation_key), "en");
}

function normalizedOperation(operation) {
  return {
    operation_key: operation.operation_key,
    semantic_function: operation.semantic_function,
    semantic_authority: operation.semantic_authority,
    semantic_source: operation.semantic_source,
    kind: operation.kind,
    field: operation.field,
    stream: operation.stream,
    graphql_source: operation.graphql_source,
  };
}

export function verifyGraphqlProjectionManifest(value) {
  const findings = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, findings: ["manifest must be an object"], canonical: null };
  exactKeys(value, TOP_LEVEL_KEYS, "manifest", findings);
  if (value.schema_version !== GRAPHQL_PROJECTION_SCHEMA_VERSION) findings.push(`manifest.schema_version must be ${GRAPHQL_PROJECTION_SCHEMA_VERSION}`);
  if (value.generated_by !== GRAPHQL_PROJECTION_GENERATOR) findings.push(`manifest.generated_by must be ${JSON.stringify(GRAPHQL_PROJECTION_GENERATOR)}`);
  if (value.endpoint !== GRAPHQL_V1_ENDPOINT) findings.push(`manifest.endpoint must be ${JSON.stringify(GRAPHQL_V1_ENDPOINT)}`);
  if (value.authority !== GRAPHQL_PROJECTION_AUTHORITY) findings.push(`manifest.authority must be ${JSON.stringify(GRAPHQL_PROJECTION_AUTHORITY)}`);
  if (!Array.isArray(value.operations)) findings.push("manifest.operations must be an array");
  else {
    value.operations.forEach((operation, index) => validateOperation(operation, index, findings));
    const fields = new Set();
    const operationKeys = new Set();
    for (const operation of value.operations) {
      if (!operation || typeof operation !== "object") continue;
      const fieldIdentity = `${operation.kind}:${operation.field}`;
      if (fields.has(fieldIdentity)) findings.push(`GraphQL field ${fieldIdentity} is declared more than once`);
      fields.add(fieldIdentity);
      if (operationKeys.has(operation.operation_key)) findings.push(`operation_key ${JSON.stringify(operation.operation_key)} is projected more than once`);
      operationKeys.add(operation.operation_key);
    }
  }
  const canonical = findings.length === 0 ? {
    schema_version: GRAPHQL_PROJECTION_SCHEMA_VERSION,
    generated_by: GRAPHQL_PROJECTION_GENERATOR,
    endpoint: GRAPHQL_V1_ENDPOINT,
    authority: GRAPHQL_PROJECTION_AUTHORITY,
    operations: value.operations.map(normalizedOperation).sort(compareOperations),
  } : null;
  return { ok: findings.length === 0, findings, canonical };
}

export function assertGraphqlProjectionManifest(value) {
  const result = verifyGraphqlProjectionManifest(value);
  if (!result.ok) throw new Error(`GraphQL projection admission failed:\n- ${result.findings.join("\n- ")}`);
  return result.canonical;
}

export function canonicalGraphqlProjectionJson(value) {
  return `${JSON.stringify(assertGraphqlProjectionManifest(value), null, 2)}\n`;
}
