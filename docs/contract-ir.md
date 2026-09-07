# Parity-approved Contract IR

`ores.typespec-json-schema-validator.contract-ir/v1` is a deterministic, downstream-only contract intermediate representation. It is emitted only after an exact parity receipt proves that the independently authored TypeSpec and JSON Schema authorities converge for the admitted declaration set.

The Contract IR is **not** a third authority. It cannot be edited to repair either source, it cannot authorize one source to overwrite the other, and generated code must retain the IR and receipt digests that admitted it.

## Emit it

A full compiler-backed check can emit the IR beside its receipt:

```bash
npx tsjsv check \
  --typespec=contracts/main.tsp \
  --schema=contracts/authored.schema.json \
  --report=.typespec-json-schema-validator/report.json \
  --contract-ir=.typespec-json-schema-validator/contract-ir.json
```

`--emit-ir` is an alias for `--contract-ir`. The option is deliberately scoped to `check` and `compare`; `validate` alone has no direct TypeSpec declaration inventory and therefore cannot approve downstream IR.

The reusable action exposes the same capability through its optional `contract_ir` input. It is opt-in so existing fleet consumers do not begin publishing a new downstream artifact until they explicitly adopt and retain it.

## Admission gate

A full Contract IR is admissible only when all of the following are true for the exact current inputs:

- the receipt schema is `ores.typespec-json-schema-validator.report/v1`;
- `status` is `passed`;
- `zeroUnexplainedFindings` is true and the finding list is empty;
- direct TypeSpec declaration inventory ran;
- the official TypeSpec-to-JSON-Schema comparison witness ran;
- differential instance validation ran;
- the current TypeSpec, generated-schema, and authored-schema digests equal the receipt digests;
- the mapped declaration identities and kind families still exist in all lanes; and
- the generated and authored assertion schemas still normalize to the same value.

A structurally clean run with `--probes=false` is not enough for downstream IR. The command fails rather than laundering incomplete evidence into an admissible artifact.

## What the artifact contains

Each admitted declaration records:

- the qualified TypeSpec identity and the generated/authored JSON Schema names;
- source files, TypeSpec line/column, and JSON Pointers;
- a common assertion schema and its SHA-256 digest;
- the complete normalized generated lane and complete normalized authored lane, each with a separate digest and role; and
- the exact receipt, source, toolchain, configuration, and coverage evidence that admitted it.

The common `assertionSchema` contains only semantics already proven equal. Lane-specific annotations remain in their respective normalized lane schemas; the exporter never chooses one lane's description, examples, default, or presentation metadata as the winner.

Declarations intentionally excluded by mapping policy and TypeSpec declarations outside JSON Schema's data-shape scope are listed explicitly. `admission.scope.complete` is false whenever either list is non-empty. Downstream generators may consume only `declarations`; excluded and out-of-scope entries are never implied to be certified.

## Digest chain

The artifact binds four independent hashes:

1. the parity receipt `runId`;
2. the SHA-256 digest of the complete canonical receipt;
3. all three input-collection digests; and
4. `irId`, the SHA-256 digest of the canonical IR body with `irId` omitted.

`verifyContractIr()` reloads the current inputs, rebuilds the expected artifact, checks the self-digest, and returns a deterministic verification result. `verifyContractIrEvidence()` performs the same operation over already loaded inventories and collections.

A downstream package, SQL candidate, ORM model, Protobuf descriptor, OpenAPI artifact, client, or server adapter should record at minimum:

```json
{
  "contractIrSchema": "ores.typespec-json-schema-validator.contract-ir/v1",
  "contractIrId": "<irId>",
  "parityReceiptRunId": "<runId>",
  "generator": {
    "name": "<generator>",
    "version": "<version>",
    "optionsDigest": "<sha256>"
  }
}
```

Any changed source, mapping, emitter option, validator version, or generated witness invalidates that chain and requires a new parity run and new IR.

## Failures and stale-artifact prevention

When parity stops or execution fails, the requested Contract IR path is replaced with a validator-owned, non-admissible tombstone bound to the failed/stopped receipt. It has no declarations and cannot be consumed as a passing artifact. This prevents a previous green IR from surviving beside a new red receipt.

Publication is atomic and conservative. The writer:

- creates private temporary files with exclusive creation;
- refuses symbolic links, non-regular files, and multiply linked targets;
- replaces only a self-consistent validator-owned Contract IR envelope; and
- never truncates an unrelated source, schema, report, or arbitrary JSON file.

The tombstone write is best effort only when the destination itself is unsafe; in that case the command exits failed and reports that it refused the path.

## Consumer rule

A consumer must check all of these before generation or promotion:

```text
contractIr.schema == ores.typespec-json-schema-validator.contract-ir/v1
contractIr.status == passed
contractIr.admissible == true
contractIr.irId == sha256(canonical body without irId)
contractIr.admission.receipt.status == passed
contractIr.admission.receipt.runId == retained receipt.runId
contractIr.admission.receipt.digest == sha256(canonical retained receipt)
current input digests == contractIr.provenance digests
```

A missing artifact, tombstone, digest mismatch, incomplete verification, or unrecognized schema version is `STOPPED_FOR_EVALUATION`; it is never a fallback to one source lane.
