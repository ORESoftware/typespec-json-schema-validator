# Exact source-file closure at Contract IR admission

Related: [architecture issue #20](https://github.com/ORESoftware/typespec-json-schema-validator/issues/20), DEN-3828.

TypeSpec and independently authored JSON Schema remain peer authorities. A generated schema is comparison evidence; Contract IR is a derived artifact, never an editable authority.

## Two different bindings

The existing aggregate lane digests remain required. JSON Schema aggregate digests describe normalized documents, so formatting changes can preserve those digests. That is useful for semantic comparison, but it is not sufficient to claim that a receipt describes the exact checked-out input bytes.

Before creating admissible Contract IR, the validator now also compares every receipt `inputs.<lane>.files` entry with the freshly loaded lane's per-file SHA-256 evidence. The same gate runs in `createContractIr`, `buildContractIr`, `verifyContractIrEvidence`, and `verifyContractIr`.

Each of the TypeSpec, generated JSON Schema, and authored JSON Schema closures must independently satisfy:

- Both recorded and current evidence are nonempty arrays with valid own file identities and lowercase 64-character SHA-256 values.
- Each file identity appears exactly once, even if duplicate entries claim the same hash.
- Recorded and current file sets match exactly, including names and hashes. Missing, additional, renamed, and byte-modified files fail closed.

Ordering of file evidence does not matter. An entry's `relativePath` takes precedence over `path`; a malformed present `relativePath` is rejected, not silently replaced. Absolute checkout locations are not compared when relative identities are available. File identities are treated as opaque strings rather than filesystem instructions: no path resolution, case folding, dot-segment cleanup, or I/O is performed by this assertion. Relative TypeSpec imports such as `../shared/types.tsp` remain supported.

## Recovery after source edits

A whitespace-only change to an authored schema or generated witness can leave normalized semantics unchanged while invalidating the old receipt's file hashes. Rerun the complete parity check and regenerate the receipt and Contract IR together. Do not edit recorded hashes, copy a `passed` status, rewrite either authored authority to resemble its peer, or reuse an earlier IR as evidence for a changed checkout.

The existing failed-run tombstone and safe-write rules remain in force. This change does not alter the public CLI flags or the versioned IR envelope: it strengthens enforcement of source evidence already recorded in receipts. Exact, previously valid artifacts with matching file evidence remain verifiable.

## Delivery and trust boundaries

This gate validates the loaded source-file closure, not every conceivable resource or toolchain dependency. Full Draft 2020-12 resource-graph/catalog handling remains tracked in #8. This change does not implement operation parity, downstream emitters, sibling test suites, package attestations, signatures, or transitive dependency closure.

`createContractIr` and `verifyContractIrEvidence` accept in-memory inventories for trusted callers; they cannot independently authenticate fabricated inventories or receipts. Downstream filesystem consumers should use explicit current input paths with `buildContractIr` / `verifyContractIr`, and retain a trusted parity execution/provenance boundary. Hash consistency is not proof that an untrusted producer really ran the claimed checks. Neither this gate nor a finite differential corpus proves universal schema equivalence.

## Regression evidence

`test/unit/contract-ir-inputs.test.mjs` covers raw-byte drift, missing and duplicate evidence, lane separation, malformed and inherited fields, prototype-like filenames, immutable inputs, ordering, and checkout relocation.

`test/integration/contract-ir-input-closure.test.mjs` runs the pinned TypeSpec compiler, exercises all four public IR admission APIs, reproduces formatting-only drift with unchanged aggregate digests, rejects altered receipt closures, and verifies recovery after rerunning parity without rewriting the authored schema.
