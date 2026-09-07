# Downstream projection admission

`ores.typespec-json-schema-validator.projection-manifest/v1` is the fail-closed handoff between a parity-approved Contract IR and downstream generators such as `api-docs`. It verifies evidence; it does not generate Protobuf, gRPC, Connect, tRPC, OpenAPI, SQL, ORM models, clients, or business logic.

The authority graph remains unchanged:

```text
independently authored TypeSpec -----------.
                                            +-- parity receipt -- Contract IR
independently authored JSON Schema --------'                         |
                                                                      v
operation inventory + projection metadata + emitter configuration -> emitter
                                                                      |
                                      exact toolchain/output/loss evidence
                                                                      |
                                                                      v
                                                       projection admission
```

The Contract IR is derived compiler data, not an editable third authority. Generated JSON Schema remains comparison evidence only. A projection manifest cannot repair either authored source, replace the parity receipt, or approve its own representation losses.

## What is bound

A passing manifest records and the verifier independently rechecks:

- the Contract IR `irId` and digest of the complete IR;
- the exact parity receipt `runId` and complete receipt digest;
- the current TypeSpec, generated-witness, and independently authored JSON Schema closure digests;
- an operation inventory, projection-metadata or field-lock file, and emitter configuration file;
- every required toolchain identity, version, and immutable artifact digest;
- the exact admitted Contract IR declaration set;
- every generated output path, media type, byte length, SHA-256 digest, and owning projection;
- every reviewed representation delta, bound to the current declaration assertion digest; and
- every required runtime validator, negative-fixture digest, and ingress/egress coverage digest.

A copied `status: "passed"`, `reviewed: true`, stale lock file, generated symbol, old receipt, or old output digest is not admission evidence.

## Create a manifest

A downstream generator can use the package subpath after it has produced its files and independently hashed its input and output closure:

```js
import {
  createProjectionManifest,
  hashProjectionFiles,
} from '@oresoftware/typespec-json-schema-validator/projection-admission';

const inputs = {
  operationInventory: {
    path: 'generated/api-ir.json',
    sha256: '<sha256>',
    size: 1234,
  },
  projectionMetadata: {
    path: 'idl/protobuf.lock.json',
    sha256: '<sha256>',
    size: 456,
  },
  emitterConfiguration: {
    path: 'config/protobuf-emitter.json',
    sha256: '<sha256>',
    size: 78,
  },
};

const outputs = await hashProjectionFiles(process.cwd(), [
  {
    path: 'generated/protobuf/accounts.proto',
    mediaType: 'text/plain',
    projection: 'protobuf',
  },
  {
    path: 'generated/protobuf/descriptors.pb',
    mediaType: 'application/octet-stream',
    projection: 'protobuf',
  },
]);

const manifest = createProjectionManifest({
  contractIr,
  parityReceipt,
  expectedSourceDigests: currentSourceDigests,
  inputs,
  toolchains: [
    { id: 'api-docs', version: '0.8.0', artifactDigest: '<sha256>' },
    { id: 'buf', version: '1.58.0', artifactDigest: '<sha256>' },
    { id: 'protoc', version: '33.0', artifactDigest: '<sha256>' },
  ],
  projections: [
    {
      id: 'protobuf',
      emitter: 'api-docs-protobuf',
      declarationIds: contractIr.declarations.map((item) => item.id),
      outputPaths: outputs.map((item) => item.path),
      representationDeltaIds: [],
      runtimeValidatorIds: [],
    },
  ],
  outputs,
});
```

`createProjectionManifest()` first verifies the Contract IR self-digest, receipt binding, peer-authority roles, source-lane digests, declaration assertion digests, and lane schema digests. It refuses stale or inadmissible contract evidence before constructing a manifest.

The manifest `manifestId` is the SHA-256 digest of the normalized canonical body with `manifestId` omitted. Lists are normalized deterministically; duplicate identities and paths fail closed.

## Verify before promotion

The consumer supplies independently observed evidence. The manifest is never allowed to grade itself:

```js
import {
  loadProjectionManifest,
  verifyProjectionManifest,
} from '@oresoftware/typespec-json-schema-validator/projection-admission';

const manifest = await loadProjectionManifest('generated/projection-manifest.json');
const admission = verifyProjectionManifest({
  manifest,
  contractIr,
  parityReceipt,
  expectedSourceDigests: currentSourceDigests,
  expectedInputs: independentlyHashedInputs,
  requiredToolchains: pinnedToolchains,
  actualOutputs: independentlyHashedOutputs,
  requiredProjections: ['protobuf'],
  approvedDeltas: reviewedDeltaLock,
  expectedRuntimeValidators: executedRuntimeValidatorEvidence,
});

if (admission.status !== 'passed') {
  process.exitCode = 2;
}
```

A pass requires exact set equality for required toolchains, admitted declarations, required projection targets, and generated output files. Extra generated files, partial declaration coverage, an output assigned to an undeclared projection, or a manifest path that differs from the independently hashed path stops evaluation.

## Reviewed representation loss

Some source semantics cannot be represented directly in a target such as Protobuf. Each loss must name the current Contract IR declaration and bind `sourceDigest` to that declaration's exact `assertionDigest`.

```json
{
  "id": "rpc-receipt-protobuf-flattened-state",
  "projection": "protobuf",
  "declaration": "RpcReceipt",
  "sourcePointer": "#/oneOf",
  "reason": "The target wire format cannot encode the conditional state machine directly.",
  "sourceDigest": "<current Contract IR assertionDigest>",
  "review": {
    "reviewer": "oresoftware-contract-review",
    "reviewedAt": "2026-09-07T04:15:00Z",
    "approvalDigest": "<immutable approval record digest>"
  },
  "runtimeValidatorRequired": true,
  "runtimeValidatorId": "rpc-receipt-semantic-validator",
  "negativeFixtureDigest": "<negative fixture corpus digest>"
}
```

The caller must separately supply the reviewed approval lock. The verifier compares the delta id, projection, declaration, current source digest, approval digest, and negative-fixture digest. A literal approval flag in the generated manifest has no authority.

When `runtimeValidatorRequired` is true, the manifest must also bind:

- the exact validator artifact path and digest;
- the executed negative-fixture digest; and
- a digest of evidence showing the validator runs on every applicable ingress and egress boundary.

Generating a validator function or type without executing it at those boundaries does not pass.

## File safety and boundedness

`loadProjectionManifest()` and `hashProjectionFiles()` accept only singly linked regular files. Symbolic links, hard-linked targets, path traversal, absolute paths, backslashes, duplicate paths, oversized files, and aggregate byte-limit violations are rejected. Parse failures use bounded diagnostics and never echo file contents.

Default limits are:

- 8 MiB per manifest, input, or output file;
- 256 MiB across one hashed output set;
- 64 toolchains;
- 100,000 admitted declarations;
- 128 projection targets;
- 10,000 outputs;
- 10,000 reviewed representation deltas; and
- 10,000 runtime-validator evidence records.

## Ownership boundary

This package owns the evidence contract, deterministic normalization, safe file hashing, and admission decision. `api-docs` owns operation/API IR and the actual Protobuf, gRPC, Connect, tRPC, OpenAPI, OpenRPC, AsyncAPI, client, documentation, and fixture emitters.

The next consumer step is to integrate this verifier into `api-docs compile` and `api-docs verify-generated`, then require clean regeneration, field-number compatibility, Buf formatting/lint/build/breaking checks, generated-language compilation, cross-runtime fixtures, and sibling-test evidence before promotion.
