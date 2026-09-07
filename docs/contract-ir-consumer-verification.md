# Downstream Contract IR verification

A parity-approved Contract IR is derived evidence, not an editable authority and not a copied boolean gate. A downstream generator must verify the artifact against the exact parity receipt and the current checked-out TypeSpec, TypeSpec-generated comparison witness, and independently authored JSON Schema closure before using it.

## CLI

```sh
tsjsv verify-ir \
  --contract-ir=.typespec-json-schema-validator/contract-ir.json \
  --parity-receipt=.typespec-json-schema-validator/report.json \
  --typespec=contracts/main.tsp \
  --generated-schema=.typespec-json-schema-validator/generated/typespec.generated.schema.json \
  --schema=schema \
  --verification=.typespec-json-schema-validator/contract-ir-verification.json
```

The command recomputes the expected Contract IR through the same inventory and normalization pipeline used at creation time. Admission passes only when:

- the supplied IR self-digest is valid;
- the receipt is a passed `ores.typespec-json-schema-validator.report/v1` receipt;
- the receipt reports zero unexplained findings and all required coverage lanes;
- all three current input digests still match the receipt;
- the recomputed Contract IR is byte-equivalent under canonical JSON serialization; and
- the supplied, computed, and expected IR identifiers agree.

The command returns exit code `0` only for a passed verification. Missing, stale, tampered, unsupported, or malformed evidence returns exit code `3` and writes a deterministic failed verification artifact.

`--contract-ir` and `--parity-receipt` are immutable inputs to this command. A verification failure never replaces either one with a tombstone or repaired copy. The separate `--verification` destination uses atomic, validator-owned replacement rules and refuses unrelated files, symbolic links, non-regular files, multiply linked paths, and destination races.

## Reusable action

Pin the action to an immutable commit:

```yaml
- name: Verify parity-approved Contract IR
  uses: ORESoftware/typespec-json-schema-validator/verify-contract-ir@<commit-sha>
  with:
    contract_ir: .typespec-json-schema-validator/contract-ir.json
    parity_receipt: .typespec-json-schema-validator/report.json
    typespec: contracts/main.tsp
    generated_schema: .typespec-json-schema-validator/generated/typespec.generated.schema.json
    schema: schema
    verification: .typespec-json-schema-validator/contract-ir-verification.json
```

The nested action installs the repository lockfile with `npm ci --omit=dev` and calls the same `verify-ir` command. It does not check out another revision, copy either authority, download a generated artifact from an unbound source, or use `eval`.

## Downstream promotion

A downstream compiler should bind the following to its generation manifest:

- the validator commit or package version;
- parity receipt `runId` and digest;
- Contract IR `irId`;
- verification `verificationId`;
- the operation inventory and its digest;
- projection metadata such as the permanent Protobuf field-number lock;
- emitter configuration and toolchain versions; and
- generated output digests.

The verification artifact proves only the admitted data-contract boundary. It does not provide operation semantics, approve representational losses, or prove that Protobuf, gRPC, Connect, tRPC, SQL, ORM, or client emitters are correct. Those remain separately versioned downstream responsibilities.
