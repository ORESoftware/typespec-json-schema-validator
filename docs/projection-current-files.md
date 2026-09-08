# Admit projections from current files

Related: issue #20, DEN-3828. `verifyProjectionManifestWithCurrentFiles()` is the preferred filesystem-backed API exported by `@oresoftware/typespec-json-schema-validator/projection-admission`.

The synchronous `verifyProjectionManifest()` remains a lower-level API for trusted callers that already own independently collected observations. The new API owns those observations: a copied `passed` status, self-consistent old manifest, or caller-supplied source/output hash cannot replace a current read.

## Required inputs

Provide a trusted checkout `root`; explicit relative POSIX paths for `typespec`, `generatedSchema` and `authoredSchema`; and an independently maintained, complete nonempty `expectedDeclarations` list. No paths or expected declaration scope are inferred from a receipt or manifest.

`inputPaths` must contain exactly `operationInventory`, `projectionMetadata`, and `emitterConfiguration`. `outputFiles` is an independently supplied nonempty inventory of `{ path, mediaType, projection }` records. These three inputs and the output paths must be distinct. Their hashes and byte sizes are read by the library, not supplied by the manifest. Required toolchains, required projections, reviewed delta evidence and runtime-validator evidence still come from trusted caller policy.

```js
import { verifyProjectionManifestWithCurrentFiles } from
  '@oresoftware/typespec-json-schema-validator/projection-admission';

// This caller owns the inventories and policy. Do not populate them by copying
// the untrusted manifest's declarations, targets, toolchains or approvals.
export async function admitBuild({ root, manifest, contractIr, parityReceipt, policy }) {
  const report = await verifyProjectionManifestWithCurrentFiles({
    root, manifest, contractIr, parityReceipt,
    typespec: 'idl/typespec/main.tsp',
    generatedSchema: 'generated/typespec.generated.schema.json',
    authoredSchema: 'json-schema/contracts.schema.json',
    expectedDeclarations: policy.declarations,
    inputPaths: {
      operationInventory: 'operations/api-ir.json',
      projectionMetadata: 'idl/protobuf.lock.json',
      emitterConfiguration: 'config/protobuf-emitter.json',
    },
    outputFiles: policy.outputFiles,
    requiredToolchains: policy.toolchains,
    requiredProjections: policy.projections,
    approvedDeltas: policy.deltaApprovals,
    expectedRuntimeValidators: policy.runtimeValidators,
    fileLimits: { maxFiles: 1000, maxBytes: 8 * 1024 * 1024,
      maxTotalFileBytes: 256 * 1024 * 1024 },
  });
  if (!report.admissible) throw new Error('projection admission stopped');
  return report;
}
```

These paths illustrate integration with a producer; they do not claim that this validator implements a Protobuf emitter. The producer must generate the outputs first in the protected build snapshot. This API does not create or rewrite any source, receipt, IR, manifest or generated output.

## Evaluation order

The API snapshots caller data before asynchronous work. It reuses `verifyConsumerContract()` with the canonical current-input verifier and no externally supplied verifier seam. This checks complete declaration scope, receipt/IR identity and current source-file evidence, including #33's exact per-file SHA-256 check.

It then reads the operation inventory, projection metadata, emitter configuration and output inventory through the hardened projection I/O functions. File-count and aggregate-byte budgets cover the combined three-input/output set. Sources are reverified after these observations. Only then does the existing projection verifier check the manifest's self-digest, input/output bindings, exact targets, toolchains, representation-loss approvals and runtime-validator evidence.

Unknown top-level options are refused. In particular, `expectedSourceDigests`, `expectedInputs`, `actualOutputs`, copied verification objects and replacement verifier functions are not accepted by this API. For well-formed observations, the existing projection admission report is returned. Pre-admission errors return deterministic `stopped_for_evaluation` reports with no usable binding and fixed rule identifiers; filesystem exception paths or arbitrary malformed evidence are not reflected in those failures.

## Regeneration and trust limits

After editing either source authority, rerun parity and regenerate Contract IR and the projection manifest. Formatting-only JSON edits also invalidate retained exact-byte evidence. After changing projection inputs or output files, regenerate the corresponding projection and manifest; never patch a recorded hash just to make admission pass.

Use an access-controlled, quiescent checkout or immutable build snapshot. The file reader is not a race-proof filesystem sandbox; see [projection evidence I/O](projection-evidence-io.md). The entry paths are constrained lexically to the configured root. Transitive TypeSpec imports and schema-resource coverage retain the canonical validator's existing profile and are not newly sandboxed or extended here. Source-loader resource limits are also unchanged; `fileLimits` covers projection input/output observations only.

The caller must discover the full output inventory independently. An extra output provided by that inventory is rejected when absent from the manifest, but this API does not crawl the filesystem to discover files the caller omitted. It checks supplied toolchain and review identities; it does not prove toolchain execution or authenticate review signatures. A trusted parity producer remains required. Operation semantics, transport emitters, complete resource graphs and the broad cross-language matrix remain separate work.

## Regression coverage

`test/integration/projection-current-files.test.mjs` invokes the pinned TypeSpec compiler, creates real Contract IR and an explicitly labeled test projection artifact, and exercises fresh admission, unchanged aggregate digests with changed source bytes, all three projection input mutations, output changes, missing paths, scope drift, override refusal, tampered receipts/IR/manifests, missing and extra output inventory, symlinked ancestors, invalid limits, bounded failures, request snapshots, relocation, and complete regeneration recovery.
