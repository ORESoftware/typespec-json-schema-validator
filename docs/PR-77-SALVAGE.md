# PR #77 semantic salvage boundary

Tracking: DEN-3830 / DEN-3828.

The historical `feat/DEN-3830-language-boundary-verification-v3` branch in PR #77 predates substantial language-boundary hardening now present on `main`. Its verifier implementation, public schema shape, package exports, and documentation must not replace newer current-input verification, split verification-core logic, schema/runtime lockstep, Unicode/control handling, source-revision coherence, or multi-file schema-reference fixes.

The useful unique artifact retained from PR #77 is its concrete five-language manifest example for Rust/native, TypeScript/Node.js, Dart/Flutter, Go/native, and Gleam/BEAM. This branch salvages that example and tests it against the **current** TJSV public Draft 2020-12 manifest contract and current `verifyLanguageBoundaries()` implementation.

The tests intentionally prove only admission-envelope behavior. They do not claim that five native toolchains executed in this repository. Real runtime evidence must still be produced by those runtimes, bound to the exact parity receipt, Contract IR, immutable source revision, artifact digest, generator/toolchain identity, and ingress/egress results. TypeSpec and independently authored JSON Schema remain peer authorities; generated Schema B, Contract IR, clients, manifests, runtime evidence, and receipts remain downstream evidence only.
