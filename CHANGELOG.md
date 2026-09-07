# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Added

- First-class `verify-ir` CLI admission that recomputes canonical Contract IR verification from the exact retained parity receipt, current TypeSpec/generated/authored input closure, and complete expected declaration scope.
- A distinct, self-digesting `consumer-verification-receipt/v1` artifact, closed Draft 2020-12 schema, and atomic safe writer for durable downstream admission evidence.
- The existing scope-aware `actions/verify-contract-ir` consumer action now publishes the same deterministic receipt instead of returning only transient console output.
- Dedicated `ores.typespec-json-schema-validator.runtime-conformance-report/v1` decision protocol, distinct from the runtime evidence envelope, with a published Draft 2020-12 schema and verified parity-receipt digest binding.
- Safe low-level and preferred current-input helpers that derive the minimal immutable runtime-adapter receipt binding `{ contractIrId, inputDigest }` without distributing the full Contract IR or parity receipt to adapter jobs.
- Preferred `verifyRuntimeEvidenceAgainstCurrentInputs()` admission API that recomputes Contract IR verification from the current checked-out TypeSpec, generated Schema B, authored Schema A, and retained parity receipt before comparing runtime adapter evidence.
- Digest-bound downstream projection admission for parity-approved Contract IR, operation inventories, projection metadata/field locks, emitter configuration, pinned toolchains, exact output files, reviewed representation deltas, and executable runtime-validator coverage.
- Exact-input, deterministic cross-runtime validator evidence admission for Zod, Serde-backed Rust validators, Dart/Freezed, and future adapters, with a strict Draft 2020-12 receipt schema, bounded non-symbolic-link loading, fail-closed adapter/corpus/digest checks, and cross-adapter divergence findings.
- Deterministic SARIF 2.1.0 presentation output through `--sarif`, the composite action, and the public JavaScript API.
- Stable `TSJSV.<source-rule-id>` descriptors, existing SHA-256 finding fingerprints, bounded source/JSON Pointer locations, and failed-run results.
- Safe SARIF persistence that replaces only validator-owned output and refuses unrelated files, symbolic links, and multiply linked targets.
- GitHub code-scanning guidance and redaction tests that keep schema values, witnesses, remote URIs, hostnames, and timestamps out of SARIF.
- Digest-bound `ores.typespec-json-schema-validator.contract-ir/v1` export through `--contract-ir` / `--emit-ir` and the public JavaScript API.
- Exact receipt, source-lane, declaration, source-pointer, toolchain, coverage, and per-schema digest provenance for downstream generators.
- Contract IR verification APIs and a published Draft 2020-12 artifact schema.
- Opt-in `contract_ir` support in the reusable GitHub Action.

### Changed

- Consumer verification now binds the complete sorted declaration inventory into durable evidence and uses a schema identifier distinct from the canonical in-memory Contract IR verification result.
- Contract IR and parity receipts are immutable inputs to `verify-ir`; usage, parse, stale-input, or evidence failures write only the separate consumer receipt and never reinterpret `--contract-ir` as an output tombstone.
- Runtime admission decisions now use their own report schema identifier and include the retained parity receipt digest only when Contract IR verification succeeded.
- Runtime adapter evidence now names the exact Contract IR self-digest, exact parity receipt run id, and corpus digest; admission requires a fresh Contract IR verification against current checked-out inputs and rejects cases targeting declarations outside the admitted IR.
- A requested Contract IR now requires direct declaration inventory, generated-witness comparison, differential validation, zero findings, and unchanged input digests.
- Stopped and failed runs replace prior validator-owned IR with a non-admissible tombstone so stale green artifacts cannot survive beside red receipts.

### Security

- Consumer receipt persistence replaces only validator-owned, self-consistent output and refuses unrelated files, symbolic links, non-regular files, multiply linked targets, and destination races; failed receipts contain only a bounded failure code.
- The consumer action requires singly linked, non-symbolic-link Contract IR and report files, keeps all resolved inputs and output parents inside the checked-out workspace, and emits failed evidence before returning nonzero.
- The preferred adapter-binding API verifies the current TypeSpec, generated Schema B, authored Schema A, and parity receipt before returning receipt fields; invalid bindings expose only stable rule identifiers rather than arbitrary verifier errors or source content.
- The preferred runtime admission path computes current-input Contract IR verification inside the same call, preventing stale verification-object reuse while reporting only bounded verification status metadata rather than arbitrary paths or internal errors.
- Projection admission refuses copied green status strings, stale source/receipt/IR bindings, unreviewed losses, unexecuted runtime-validator claims, unmanifested outputs, traversal, symbolic links, hard links, and oversized evidence files.
- Runtime conformance findings expose only bounded status metadata and digests from Contract IR verification, never arbitrary verification errors or Contract IR payload content.
- Contract IR publication is atomic, self-digest checked, and refuses unrelated files, symbolic links, non-regular files, and multiply linked destinations.

## 0.1.0 — 2026-09-05

### Added

- Fail-closed TypeSpec and JSON Schema top-level declaration parity.
- Official TypeSpec JSON Schema emission as non-authoritative comparison evidence.
- Strict duplicate-key and prototype-safe JSON parsing.
- Draft 2020-12 closed-document validation profile.
- Qualified declaration identity using TypeSpec namespaces and `x-typespec-name`.
- Conservative semantic normalization with lossless `oneOf` handling.
- Deterministic findings, SHA-256 fingerprints, input digests, emitter-option digests, and run receipts.
- `check`, `generate`, `compare`, and `inventory` CLI commands through the canonical `flags-2-env` contract.
- Unit tests, real-emitter integration tests, exact-head GitHub Actions admission, documentation, and examples.

### Fail-closed boundaries

- TypeSpec interfaces and operations require a future TypeSpec/OpenAPI parity gate.
- External references, nested `$id` resource scopes, anchors, and dynamic references require a future complete Draft 2020-12 resource resolver.
