# Durable downstream projection verification

`verify-projection` turns the existing current-files projection admission API into a durable, self-digesting receipt suitable for CI promotion gates. It verifies evidence; it does not generate Protobuf, gRPC, Connect, tRPC, OpenAPI, SQL, ORM models, or clients.

The authority model remains unchanged:

```text
independently authored TypeSpec ---------.
                                         +-- parity receipt -- Contract IR
independently authored JSON Schema A ----'                        |
                                                                  v
trusted operation/projection policy + current generated files -> projection receipt
```

TypeSpec-generated JSON Schema B is comparison evidence only. Contract IR, projection manifests, policies, generated outputs, and verification receipts are downstream artifacts, never editable authorities.

## Command

All paths after `--root` are normalized relative POSIX paths inside one trusted, quiescent checkout:

```sh
tsjsv verify-projection \
  --root=. \
  --projection-manifest=generated/projection-manifest.json \
  --contract-ir=generated/contract-ir.json \
  --parity-receipt=generated/parity-report.json \
  --typespec=idl/typespec/main.tsp \
  --generated-schema=generated/typespec-json-schema \
  --schema=json-schema \
  --policy=projection/verification-policy.json \
  --verification=generated/projection-verification.json
```

The trusted policy supplies the complete consumer declaration inventory, exact operation-inventory/projection-metadata/emitter-config paths, required toolchains and targets, output paths, reviewed representation-loss evidence, and expected runtime-validator evidence. The manifest is not allowed to choose its own acceptance policy.

## Admission behavior

The command reuses `verifyProjectionManifestWithCurrentFiles()` and therefore:

1. verifies the Contract IR against the retained parity receipt and explicit current TypeSpec, generated Schema B, and authored Schema A paths;
2. checks the complete expected declaration inventory;
3. safely observes operation metadata, projection metadata or field locks, emitter configuration, and generated outputs from the current checkout;
4. re-verifies source evidence after file observation;
5. validates manifest, toolchain, target, output, representation-delta, and runtime-validator bindings; and
6. emits a compact `ores.typespec-json-schema-validator.projection-verification-receipt/v1` artifact.

A passing receipt binds the manifest id, Contract IR id, parity run id, source-lane digests, projection evidence digest, and summary counts. Stopped and failed receipts expose stable rule identifiers and bounded failure codes, not source values, arbitrary exception text, credentials, or generated payloads.

## Replacement safety

Receipt persistence replaces only an existing self-consistent receipt of the same schema. It refuses symbolic links, non-regular files, multiply linked files, unrelated JSON, malformed receipts, and destination changes observed during replacement. A failed run never overwrites TypeSpec, authored JSON Schema, generated Schema B, parity receipts, Contract IR, projection manifests, policies, or generated outputs.

## Reusable action

```yaml
- uses: ORESoftware/typespec-json-schema-validator/actions/verify-projection@<immutable-commit>
  with:
    root: .
    projection_manifest: generated/projection-manifest.json
    contract_ir: generated/contract-ir.json
    parity_receipt: generated/parity-report.json
    typespec: idl/typespec/main.tsp
    generated_schema: generated/typespec-json-schema
    authored_schema: json-schema
    policy: projection/verification-policy.json
```

Pin the action to an immutable reviewed commit. The action maps inputs through environment variables and invokes the canonical flags-2-env CLI; shell bodies never interpolate action inputs directly.

## Boundary

This receipt proves only the evidence evaluated by the manifest and trusted policy. It does not prove universal schema equivalence, execute emitters, establish Proto compatibility against an earlier release, or certify every language runtime. Those remain explicit downstream CI stages and sibling-test obligations under issue #20.
