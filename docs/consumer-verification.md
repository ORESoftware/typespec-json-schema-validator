# Downstream consumer evidence verification

Tracking: DEN-3828, DEN-3830, and issue #20.

A parity-approved Contract IR is derived evidence, not an editable authority and not a copied boolean gate. Every downstream consumer must recompute canonical verification against the exact retained parity receipt and current checked-out TypeSpec, TypeSpec-generated comparison witness, and independently authored JSON Schema closure. It must also name the complete declaration scope it expects.

TypeSpec and authored JSON Schema remain independent peer authorities. The generated JSON Schema witness, Contract IR, consumer verification receipt, runtime receipts, and projection manifests remain derived evidence.

## Reusable GitHub Action

Use `actions/verify-contract-ir` immediately before consuming a retained Contract IR. Pin both the producer action and this verifier to the same reviewed immutable commit. The producer must have run successfully in the trusted workflow for the current revision.

```yaml
- name: Verify before downstream generation
  id: verify_contract
  uses: ORESoftware/typespec-json-schema-validator/actions/verify-contract-ir@<reviewed-40-character-commit>
  with:
    contract_ir: .typespec-json-schema-validator/contract-ir.json
    report: .typespec-json-schema-validator/report.json
    typespec: schema-authority-canary/main.tsp
    schema: schema-authority-canary/authored.schema.json
    generated_schema: .typespec-json-schema-validator/generated/typespec.generated.schema.json
    expected_declarations: '["OreSchemaAuthority.AuthorityKind","OreSchemaAuthority.PeerAuthorityRegistration"]'
    verification: .typespec-json-schema-validator/consumer-verification.json
```

The action installs the pinned verifier toolchain and invokes the canonical `verifyContractIr()` implementation through the scope-aware `verifyConsumerContract()` policy. It rebuilds the expected IR from explicit checked-out paths, verifies the IR self-digest, complete receipt binding, current input closure, and exact declaration inventory, then publishes a self-digesting `consumer-verification-receipt/v1` artifact.

Input paths are never selected by the receipt. Contract IR and parity receipt paths must resolve to singly linked regular, non-symbolic-link files inside the workspace. Source lanes must be regular files or directories inside the workspace. The output parent is resolved inside the workspace and the safe writer refuses unrelated files, symbolic links, non-regular files, multiply linked targets, and destination races.

On any missing, stale, malformed, tampered, partial, unsupported, or unsafe input, the action exits nonzero and replaces only a prior validator-owned verification receipt with deterministic failed evidence. It never repairs or overwrites the Contract IR, parity receipt, TypeSpec, authored JSON Schema, or generated witness.

## CLI

The same admission is available through the flags-2-env command boundary:

```sh
tsjsv verify-ir \
  --contract-ir=.typespec-json-schema-validator/contract-ir.json \
  --parity-receipt=.typespec-json-schema-validator/report.json \
  --typespec=contracts/main.tsp \
  --generated-schema=.typespec-json-schema-validator/generated/typespec.generated.schema.json \
  --schema=schema \
  --expected-declarations='["SharedAuth.CapabilityStatus","SharedAuth.IamCapability"]' \
  --verification=.typespec-json-schema-validator/consumer-verification.json
```

Exit code `0` means the receipt is admissible. Missing, stale, tampered, unsupported, malformed, or partial evidence returns exit code `3` and writes a failed receipt. CLI usage failures preserve a separately requested verification path and never reinterpret `--contract-ir` as an output tombstone.

## Receipt semantics

`ores.typespec-json-schema-validator.consumer-verification-receipt/v1` is intentionally distinct from the canonical in-memory `contract-ir-verification/v1` result. The durable receipt adds:

- `verificationId`, the SHA-256 digest of the canonical receipt body;
- the exact supplied, computed, and expected Contract IR identifiers;
- the exact parity receipt `runId`;
- the complete sorted declaration inventory admitted for this consumer; and
- a bounded failure code that never embeds arbitrary source content, filesystem paths, schema values, or exception text.

A passed receipt requires every Contract IR identifier to agree, a nonempty complete declaration scope, a passed canonical verifier result, and the exact retained parity receipt. A failed receipt is never admissible.

## Scope and downstream promotion

Consumer scope must be an explicit nonempty JSON array of qualified TypeSpec declaration IDs. The complete admitted set must match it exactly. Duplicate identities, omitted declarations, count mismatches, excluded declarations, out-of-scope operations, and incomplete scopes stop admission. Keep independent contracts in separately admitted bundles; do not disable completeness to combine supported data declarations with unsupported operations.

This verification does not turn the receipt into a signature or prove its producer's identity. Workflow trust still requires immutable code, exact revision checkout, controlled artifact provenance, and a successful fresh producer. It also does not authorize emitter options or operation metadata absent from the data IR.

Before downstream promotion, bind the consumer receipt to the existing projection-admission manifest together with operation inventory, permanent field-number or projection metadata, emitter configuration, pinned toolchains, exact output digests, independently reviewed representation deltas, and required runtime-validator evidence.
