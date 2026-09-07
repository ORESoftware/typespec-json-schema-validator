# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Added

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

- A requested Contract IR now requires direct declaration inventory, generated-witness comparison, differential validation, zero findings, and unchanged input digests.
- Stopped and failed runs replace prior validator-owned IR with a non-admissible tombstone so stale green artifacts cannot survive beside red receipts.

### Security

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
