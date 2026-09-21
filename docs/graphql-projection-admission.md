# GraphQL projection admission

`typespec-json-schema-validator` treats an ORE GraphQL surface as an authored projection, not as a schema inferred from REST paths. The projection manifest is admitted only when its identity is explicit and deterministic.

The v1 invariants are:

- endpoint is exactly `/v1/graphql`;
- authority is exactly `graphql.rs`;
- generator is exactly `ores-stack`;
- every field is a valid non-introspection GraphQL Name;
- `query` and `mutation` projections are unary;
- `subscription` projections are `server_stream`;
- a `(kind, field)` may appear only once;
- an operation key may be projected only once in v1;
- arbitrary metadata such as timestamps is refused rather than incorporated into the canonical digest/input;
- canonical operation order is query, mutation, subscription, then field name, then stable operation key.

Consumers may call `verifyGraphqlProjectionManifest`, `assertGraphqlProjectionManifest`, or `canonicalGraphqlProjectionJson` from `@oresoftware/typespec-json-schema-validator/graphql-projection-admission`. The canonical JSON renderer guarantees byte-stable output for manifests with the same semantic operation set regardless of input ordering.
