# Receipt identity

`ores.typespec-json-schema-validator.report/v1` retains diagnostics needed to explain how and where a comparison ran, but `runId` is a semantic identity rather than a host/invocation identity.

The canonical run identity binds the contract semantics and evidence that can change an admission result, including:

- TypeSpec, generated JSON Schema, and authored JSON Schema digests;
- normalized declaration mapping policy, including declaration pairings and ignore sets;
- semantic emitter options;
- validator and TypeSpec compiler versions;
- differential-validation configuration and semantic instance-corpus digest;
- coverage, findings, and comparison results used by the receipt identity material.

The identity deliberately does **not** bind diagnostic-only location/mechanism details such as absolute checkout paths, generated-witness output directories, instance-corpus materialization directories, compiler executable paths, or equivalent execution mechanisms.

This distinction has two required invariants:

1. moving identical evidence between Linux/macOS checkout or temporary directories must not change `runId`;
2. changing the semantic mapping document must change `runId` even when the same schemas still happen to converge.

The report may continue to retain the excluded diagnostic fields. Consumers must use `runId` for semantic receipt identity rather than hashing arbitrary diagnostic paths themselves.
