# PR #77 semantic salvage boundary

Tracking: DEN-3830 / DEN-3828 / DEN-3959.

Historical PR #77 predates substantial language-boundary hardening now present on `main`. Its older verifier implementation, package/schema naming, and documentation must not replace current `main` behavior.

Current `main` already owns the stronger implementation, including current-input verification against independently authored TypeSpec and JSON Schema plus the generated Schema B comparison witness, split verification-core logic, independent Draft 2020-12 schema/runtime lockstep, Unicode code-point/control handling, source-revision coherence, semantic runtime-evidence v2, and fail-closed resource-reference normalization.

The useful unique artifact retained from PR #77 is its concrete five-language manifest example. This successor branch salvages only that example and focused current-main regression coverage.

The tests intentionally verify admission-envelope behavior; they do not claim native Rust, TypeScript/Node.js, Dart/Flutter, Go, or Gleam/BEAM execution inside this repository. Those runtimes must produce their own exact evidence before promotion.

TypeSpec and independently authored JSON Schema Draft 2020-12 remain peer authorities. Generated Schema B, Contract IR, clients, manifests, runtime artifacts, evidence, and receipts remain downstream evidence only. Trusted promotion should use `verifyLanguageBoundariesAgainstCurrentInputs()` before evaluating the exact runtime evidence set.
