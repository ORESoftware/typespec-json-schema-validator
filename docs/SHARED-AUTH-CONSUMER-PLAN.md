# Shared Auth config external consumer admission

Tracking: DEN-3959, DEN-606, DEN-3830.

This repository provides an independent execution lane for the Shared Auth `.shared-auth.toml` contract while the `shared-auth` GitHub organization is affected by the zero-step Actions admission blocker tracked in DEN-2906.

The lane does **not** create a third contract authority and it does not replace the producer repository's required CI. It exists to execute an immutable producer snapshot on healthy infrastructure and catch real compiler/runtime defects instead of confusing them with runner admission failures.

## Authority invariant

The only peer authorities for this consumer contract are the independently authored files from `shared-auth/shared-auth-interfaces`:

- `contracts/shared-auth-config/main.tsp` — TypeSpec;
- `schema/shared-auth-config.schema.json` — JSON Schema Draft 2020-12.

The TypeSpec-emitted Schema B, parity receipt, Contract IR, Rust/TypeScript/Go adapters, runtime evidence envelopes, and language-boundary verification receipt are evidence only.

## Pinned producer snapshot under evaluation

- source repository: `shared-auth/shared-auth-interfaces`
- exact source revision: `7c4f6ec1ceb81e12c7bcb31263a7e1d6020120a9`
- producer PR: `shared-auth/shared-auth-interfaces#53`
- snapshot manifest: `test/fixtures/external/shared-auth-config/source-manifest.json`
- snapshot root: `test/fixtures/external/shared-auth-config/consumer/`

The source repository is private and the TJSV repository-scoped Actions token intentionally does not have cross-organization access. This lane therefore does **not** use a PAT, broaden a token, or persist another credential. Instead, the reviewed producer inputs required for conformance are vendored as a test fixture.

`source-manifest.json` records the immutable producer revision and every original Git blob id. `scripts/verify-external-shared-auth-snapshot.mjs` recomputes Git blob identities for the vendored bytes, requires the file set to match exactly, and checks the expected corpus cardinality (5 valid / 18 invalid) before any compiler or runtime gate runs. Changing the snapshot requires deliberately updating the reviewed source identities; a copied file cannot silently drift while retaining the old producer claim.

Update this snapshot only to a reviewed immutable producer revision. Never point the gate at a floating branch and never use a chat-provided operator credential to bypass repository access boundaries.

## Required sequence

1. Check out this TJSV repository at the exact workflow head.
2. Verify the vendored Shared Auth snapshot against its immutable producer revision and per-file Git blob identities.
3. Install this repository's pinned TJSV dependency closure plus the pinned TypeScript evidence compiler.
4. Run `tjsv check` over the snapshotted independent TypeSpec and authored Draft 2020-12 Schema A with the complete differential corpus; emit Schema B, parity receipt, and parity-approved Contract IR.
5. Run the snapshotted locked Rust 1.88 adapter over every valid/invalid corpus instance.
6. Run the TypeScript/Node 22.16 adapter under explicit ESM semantics over the same complete corpus.
7. Run the Go 1.23.2 adapter over the same complete corpus.
8. Invoke the snapshotted producer `verifyLanguageBoundariesAgainstCurrentInputs()` orchestration against this exact TJSV checkout.
9. Require the final receipt to be `passed` with zero unexplained findings, require all expected evidence files to exist, and retain them as workflow artifacts.

A green external lane is useful immutable-producer evidence, but it must not be represented as a successful `shared-auth` producer workflow while DEN-2906 still prevents producer jobs from executing.
