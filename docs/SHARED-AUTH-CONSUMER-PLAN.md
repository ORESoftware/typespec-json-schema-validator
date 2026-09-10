# Shared Auth config external consumer admission

Tracking: DEN-3959, DEN-606, DEN-3830.

This repository provides an independent execution lane for the Shared Auth `.shared-auth.toml` contract while the `shared-auth` GitHub organization is affected by the zero-step Actions admission blocker tracked in DEN-2906.

The lane does **not** create a third contract authority and it does not replace the producer repository's required CI. It exists to execute the exact consumer head on healthy infrastructure and catch real compiler/runtime defects instead of confusing them with runner admission failures.

## Authority invariant

The only peer authorities for this consumer contract are the independently authored files in `shared-auth/shared-auth-interfaces`:

- `contracts/shared-auth-config/main.tsp` — TypeSpec;
- `schema/shared-auth-config.schema.json` — JSON Schema Draft 2020-12.

The TypeSpec-emitted Schema B, parity receipt, Contract IR, Rust/TypeScript/Go adapters, runtime evidence envelopes, and language-boundary verification receipt are evidence only.

## Pinned consumer under evaluation

- repository: `shared-auth/shared-auth-interfaces`
- exact revision: `7c4f6ec1ceb81e12c7bcb31263a7e1d6020120a9`
- producer PR: `shared-auth/shared-auth-interfaces#53`

Update this pin only to a reviewed immutable producer revision. Do not point the gate at a floating branch name.

## Required sequence

1. Check out this TJSV repository at the exact workflow head.
2. Check out the pinned Shared Auth consumer revision without persisted credentials.
3. Run this repository's pinned dependency install and normal TJSV package checks.
4. Run `tjsv check` over the consumer's independent TypeSpec and authored Draft 2020-12 Schema A with its complete differential corpus; emit Schema B, parity receipt, and parity-approved Contract IR.
5. Run the consumer's locked Rust adapter over every valid/invalid corpus instance.
6. Run the TypeScript/Node adapter under explicit ESM semantics over the same complete corpus.
7. Run the Go adapter over the same complete corpus.
8. Link this checked-out TJSV package only as an execution dependency, then invoke the consumer's own `verifyLanguageBoundariesAgainstCurrentInputs()` orchestration.
9. Require the final receipt to be `passed` with zero unexplained findings and retain all evidence artifacts.

A green external lane is useful exact-head evidence, but it must not be represented as a successful `shared-auth` producer workflow while DEN-2906 still prevents producer jobs from executing.
