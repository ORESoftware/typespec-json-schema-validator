# Lambda runtime contract regression profile

Tracking: DEN-3959.

`test/fixtures/lambda-runtime-contract` is a shared regression profile for `*-lambdas` repositories. It intentionally keeps independently authored TypeSpec and JSON Schema Draft 2020-12 as peer authorities. The TypeSpec-emitted schema is comparison evidence only and has no precedence over the authored JSON Schema.

The fixture covers the provider and operation wire values used by the canonical Lambda repositories plus a bounded command envelope. Differential instances prove that both validators accept a valid health command and reject an unknown operation. A dedicated integration test also removes one provider from the authored JSON Schema and verifies that TJSV stops promotion and does not emit an admissible Contract IR.

The language-boundary unit profile requires simultaneous Rust/native, TypeScript/Node, and Dart/Flutter evidence tied to the exact parity receipt and Contract IR. Missing or stale runtime evidence fails closed. This is the intended pattern for generated clients/adapters across language and runtime boundaries: runtime artifacts are evidence, never a third schema authority.
