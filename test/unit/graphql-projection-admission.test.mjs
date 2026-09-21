import assert from "node:assert/strict";
import test from "node:test";

import {
  GRAPHQL_V1_ENDPOINT,
  canonicalGraphqlProjectionJson,
  verifyGraphqlProjectionManifest,
} from "../../src/graphql-projection-admission/index.mjs";

function operation(overrides = {}) {
  return {
    operation_key: "demo.users.get_user",
    operation: "get_user",
    kind: "query",
    field: "get_user",
    stream: "unary",
    graphql_source: "src/routes/users/get/graphql.rs",
    handlers_source: "src/routes/users/get/handlers.rs",
    ...overrides,
  };
}

function manifest(operations = [operation()]) {
  return {
    schema_version: 1,
    generated_by: "ores-stack",
    endpoint: GRAPHQL_V1_ENDPOINT,
    authority: "graphql.rs",
    operations,
  };
}

test("admits and canonically orders authored GraphQL projections", () => {
  const value = manifest([
    operation({
      operation_key: "demo.events.watch_stream",
      operation: "watch_stream",
      kind: "subscription",
      field: "watch_events",
      stream: "server_stream",
      graphql_source: "src/routes/events/watch/graphql.rs",
      handlers_source: "src/routes/events/watch/handlers.rs",
    }),
    operation({
      operation_key: "demo.users.create_user",
      operation: "create_user",
      kind: "mutation",
      field: "create_user",
      graphql_source: "src/routes/users/create/graphql.rs",
      handlers_source: "src/routes/users/create/handlers.rs",
    }),
    operation(),
  ]);

  const verified = verifyGraphqlProjectionManifest(value);
  assert.equal(verified.ok, true, verified.findings.join("\n"));
  assert.deepEqual(
    verified.canonical.operations.map(({ kind, field }) => [kind, field]),
    [["query", "get_user"], ["mutation", "create_user"], ["subscription", "watch_events"]],
  );

  const reversed = { ...value, operations: [...value.operations].reverse() };
  assert.equal(canonicalGraphqlProjectionJson(value), canonicalGraphqlProjectionJson(reversed));
});

test("fails closed on endpoint, stream, duplicate field, or unknown metadata", () => {
  const bad = manifest([
    operation({ stream: "server_stream" }),
    operation({ operation_key: "demo.users.other", operation: "other" }),
  ]);
  bad.endpoint = "/graphql";
  bad.generated_at = "not-deterministic";

  const verified = verifyGraphqlProjectionManifest(bad);
  assert.equal(verified.ok, false);
  assert.match(verified.findings.join("\n"), /\/v1\/graphql/);
  assert.match(verified.findings.join("\n"), /query must use unary/);
  assert.match(verified.findings.join("\n"), /declared more than once/);
  assert.match(verified.findings.join("\n"), /unsupported key "generated_at"/);
});

test("subscriptions are explicitly server-streaming", () => {
  const verified = verifyGraphqlProjectionManifest(manifest([
    operation({ kind: "subscription", stream: "unary", field: "watch_user" }),
  ]));
  assert.equal(verified.ok, false);
  assert.match(verified.findings.join("\n"), /subscription must use server_stream/);
});
