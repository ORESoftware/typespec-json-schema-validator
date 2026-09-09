# Lambda runtime contract regression profile

Tracking: DEN-3959.

`test/fixtures/lambda-runtime-contract` is a shared regression profile for `*-lambdas` repositories. It intentionally keeps independently authored TypeSpec and JSON Schema Draft 2020-12 as peer authorities. The TypeSpec-emitted schema is comparison evidence only and has no precedence over the authored JSON Schema.

The fixture covers the provider and operation wire values used by the canonical Lambda repositories plus a bounded command envelope. The differential corpus now contains eight independent instances: valid AWS, Cloudflare Workers, and Vercel commands plus invalid unknown-operation, unknown-provider, missing-required-field, wrong-schema-version, and extra-property cases. Both authority lanes must agree on every instance. A dedicated integration test also removes one provider from the authored JSON Schema and verifies that TJSV stops promotion and emits only a non-admissible Contract IR tombstone.

The language-boundary unit profile requires simultaneous Rust/native, TypeScript/Node, and Dart/Flutter evidence tied to the exact parity receipt and Contract IR. Adversarial tests additionally mutate evidence schema identity, status, runtime identity, source revision, artifact digest, toolchain/generator identity, ingress/egress results, parity receipt binding, and Contract IR binding. Each mutation must stop promotion and the invalid runtime envelope must not be counted as admitted evidence.

This is the intended pattern for generated clients/adapters across language and runtime boundaries: runtime artifacts are evidence, never a third schema authority. The profile still does not prove that the claimed artifact digest matches bytes on disk or independently recompute the supplied Contract IR self-digest; those stronger current-input integrity bindings remain separate follow-up work.
