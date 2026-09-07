# Downstream projection verification

`typespec-json-schema-validator` does not emit Protobuf, gRPC, Connect, tRPC, SQL, or language SDKs. Those emitters remain downstream—normally in `ORESoftware/api-docs` or a product-owned generator—but their outputs can be admitted only after this repository proves that they consume the same parity-approved contract closure.

## Evidence chain

```text
TypeSpec A ------------------------------┐
                                         ├─ parity receipt ─ Contract IR
independently authored JSON Schema A ----┘                    │
TypeSpec A -> official emitter -> JSON Schema B --------------┘
                                                              │
                                    operation inventory -------┤
                                    projection metadata -------┤
                                    emitter configuration -----┤
                                    pinned toolchains ----------┤
                                    generated output bytes -----┤
                                                              v
                                  projection verification receipt
```

The receipt is evidence, not a schema authority. TypeSpec A and JSON Schema A remain independent peer authorities. JSON Schema B is comparison-only evidence. Contract IR is available only after parity passes and is reconstructed from the exact current inputs during verification.

## Trusted policy

A projection manifest describes what a downstream emitter claims it produced. A separate trusted policy says what the verifier must independently open and hash:

```json
{
  "schema": "ores.typespec-json-schema-validator.projection-verification-policy/v1",
  "inputs": {
    "operationInventory": { "path": "operations/api-ir.json" },
    "projectionMetadata": { "path": "idl/protobuf.lock.json" },
    "emitterConfiguration": { "path": "config/emitter.json" }
  },
  "toolchains": [
    {
      "id": "api-docs-protobuf",
      "version": "0.8.0",
      "artifactDigest": "<sha256>"
    }
  ],
  "requiredProjections": ["protobuf"],
  "outputs": [
    {
      "path": "generated/protobuf/accounts.proto",
      "mediaType": "text/plain",
      "projection": "protobuf"
    }
  ],
  "approvedDeltas": [],
  "runtimeValidators": []
}
```

Policy paths are normalized relative POSIX paths. Traversal, absolute paths, duplicate inputs, duplicate outputs, symbolic links, hard links, non-regular files, and oversized files fail closed.

## CLI

```bash
npx typespec-json-schema-validator verify-projection \
  --projection-manifest=.contract/projection-manifest.json \
  --contract-ir=.contract/contract-ir.json \
  --parity-receipt=.contract/parity-report.json \
  --typespec=typespec/main.tsp \
  --generated-schema=.contract/generated/typespec.generated.schema.json \
  --schema=json-schema \
  --policy=.contract/projection-policy.json \
  --input-root=. \
  --output-root=. \
  --verification=.contract/projection-verification.json
```

The command:

1. verifies the supplied Contract IR against the exact current TypeSpec A, generated JSON Schema B, authored JSON Schema A, and parity receipt;
2. independently opens and hashes operation inventory, projection metadata/field locks, and emitter configuration from the trusted policy;
3. independently opens and hashes every required output from the trusted policy;
4. verifies the projection manifest against current Contract IR identity, current source digests, exact input digests, pinned toolchains, required projections, approved representation deltas, runtime validators, and exact output bytes;
5. writes a self-digesting `projection-verification-receipt/v1` artifact.

Exit status `0` means admitted. Exit status `2` means evaluation stopped because evidence drifted or remained incomplete. Exit status `3` means usage, I/O, parsing, or internal verification failed. Every nonzero path replaces an earlier validator-owned green receipt with red evidence when the destination is safe.

## Reusable action

```yaml
- uses: ORESoftware/typespec-json-schema-validator/actions/verify-projection@<immutable-commit>
  with:
    projection_manifest: .contract/projection-manifest.json
    contract_ir: .contract/contract-ir.json
    parity_receipt: .contract/parity-report.json
    typespec: typespec/main.tsp
    generated_schema: .contract/generated/typespec.generated.schema.json
    authored_schema: json-schema
    policy: .contract/projection-policy.json
    input_root: .
    output_root: .
    verification: .contract/projection-verification.json
```

Pin the action by full commit SHA. The composite action installs only this repository's lockfile-pinned dependencies, routes all caller values through environment boundaries, and does not execute an emitter or runtime adapter named by the manifest or policy.

## Promotion rule

A downstream artifact may be promoted only when the current receipt has:

- `status: "passed"`;
- `admissible: true`;
- a valid self-digesting `verificationId`;
- exact `manifestId`, `contractIrId`, `receiptRunId`, and `evidenceDigest` bindings;
- all three current source digests;
- zero finding rule identifiers and no failure code.

The receipt is deliberately compact. It retains stable identifiers, counts, and digests, but not schema values, source text, generated code, arbitrary verifier errors, credentials, or runtime output.

Refs: issue #20, DEN-3830.
