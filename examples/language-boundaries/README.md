# Five-runtime boundary manifest

This example declares five required language/runtime boundaries: Rust/native, TypeScript/Node.js, Dart/Flutter, Go/native, and Gleam/BEAM.

It is a manifest example, not proof that those runtimes executed. Real promotion evidence must be freshly produced by each runtime and bound to the exact immutable source revision, artifact digest, generator/toolchain identity, parity receipt `runId`, Contract IR `irId`, and passed ingress/egress validation.

Trusted promotion orchestration should use `verifyLanguageBoundariesAgainstCurrentInputs()` so TJSV first re-verifies the retained Contract IR against the current independently authored TypeSpec and JSON Schema inputs plus the generated Schema B comparison witness before evaluating the runtime evidence map.

TypeSpec and independently authored JSON Schema Draft 2020-12 remain peer authorities. Generated Schema B, Contract IR, clients, this manifest, runtime artifacts, evidence, and verification receipts are downstream evidence only.
