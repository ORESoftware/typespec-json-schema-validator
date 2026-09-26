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
    semantic_function: "get_user",
    semantic_authority: "handlers.rs",
    semantic_source: "src/routes/rest/users/get/handlers.rs",
    kind: "query",
    field: "get_user",
    stream: "unary",
    graphql_source: "src/graphql/users/resolvers.rs",
    ...overrides,
  };
}

function manifest(operations = [operation()]) {
  return {
    schema_version: 1,
    generated_by: "ores-stack",
    endpoint: GRAPHQL_V1_ENDPOINT,
    authority: "resolvers.rs",
    operations,
  };
}

test("admits and canonically orders authored GraphQL projections", () => {
  const value = manifest([
    operation({
      operation_key: "demo.events.watch_stream",
      semantic_function: "watch_stream",
      kind: "subscription",
      field: "watch_events",
      stream: "server_stream",
      semantic_source: "src/routes/rest/events/watch/handlers.rs",
      graphql_source: "src/graphql/events/resolvers.rs",
    }),
    operation({
      operation_key: "demo.users.create_user",
      semantic_function: "create_user",
      kind: "mutation",
      field: "create_user",
      semantic_authority: "funcs.rs",
      semantic_source: "src/rpc/users/funcs.rs",
      graphql_source: "src/graphql/users/resolvers.rs",
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
    operation({ operation_key: "demo.users.other", semantic_function: "other" }),
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

test("semantic source must agree with its authority", () => {
  const verified = verifyGraphqlProjectionManifest(manifest([
    operation({ semantic_authority: "funcs.rs", semantic_source: "src/routes/rest/users/get/handlers.rs" }),
  ]));
  assert.equal(verified.ok, false);
  assert.match(verified.findings.join("\n"), /does not match semantic_authority/);
});

test("legacy direct REST handlers are rejected", () => {
  const verified = verifyGraphqlProjectionManifest(manifest([
    operation({ semantic_source: "src/routes/users/get/handlers.rs" }),
  ]));
  assert.equal(verified.ok, false);
  assert.match(verified.findings.join("\n"), /does not match semantic_authority/);
});

test("GraphQL funcs.rs and singular resolver.rs are rejected in favor of resolvers.rs", () => {
  for (const graphql_source of ["src/graphql/users/funcs.rs", "src/graphql/users/resolver.rs"]) {
    const verified = verifyGraphqlProjectionManifest(manifest([
      operation({ graphql_source }),
    ]));
    assert.equal(verified.ok, false);
    assert.match(verified.findings.join("\n"), /resolvers\.rs/);
  }
});

test("subscriptions are explicitly server-streaming", () => {
  const verified = verifyGraphqlProjectionManifest(manifest([
    operation({ kind: "subscription", stream: "unary", field: "watch_user" }),
  ]));
  assert.equal(verified.ok, false);
  assert.match(verified.findings.join("\n"), /subscription must use server_stream/);
});
