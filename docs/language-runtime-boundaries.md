# Cross-language and runtime boundary admission

Tracking: DEN-3830, DEN-3828, and architecture issue #20.

`language-boundary-verification` is a higher-level promotion gate for generated language/runtime artifacts. It complements `runtime-conformance`; it does not replace the instance-corpus runtime validator and it does not introduce a third schema authority.

## Authority invariant

TypeSpec and independently authored JSON Schema remain peer engineering authorities. The TypeSpec-generated JSON Schema witness, Contract IR, runtime adapters, generated clients, Protobuf/WIT outputs, and this verification receipt are evidence only. No generated artifact may overwrite either authored source or win a disagreement by fallback.

A boundary verification can pass only when the supplied parity report is passed, the Contract IR is passed and admissible, the Contract IR is bound to that exact report, and differential instance validation remains required. Every required language/runtime target must then provide its own exact evidence envelope.

## Versioned public contracts

The npm package publishes three Draft 2020-12 contracts for non-Node producers and consumers:

- `./schema/language-boundaries` describes the required language/runtime matrix and the peer-authority roles.
- `./schema/language-boundary-evidence` describes one generated artifact receipt.
- `./schema/language-boundary-verification` describes the deterministic TJSV admission decision.

Node consumers may import `@oresoftware/typespec-json-schema-validator/language-boundary-verification`; other runtimes should validate the same JSON envelopes against the published schemas before producing or consuming evidence.

Each required target binds a unique language/runtime identity and canonical relative evidence path. Its evidence must bind an immutable 40-character source revision, lowercase SHA-256 artifact digest, exact parity `runId`, exact Contract IR `irId`, concrete generator/toolchain name and version, and explicit `passed` ingress and egress validation. Required targets cannot disable either validation direction.

Optional target evidence may be absent. If optional evidence is supplied, it is validated with the same strict envelope and identity rules; optional cannot mean unchecked.

## Fail-closed cases

Admission stops for malformed or stale parity/IR evidence, incorrect authority roles, disabled differential validation, noncanonical identities or paths, prototype-inherited evidence, duplicate target identities, evidence reuse across targets, symbolic or abbreviated source revisions, noncanonical artifact digests, missing required evidence, target/evidence runtime mismatches, stale receipt or IR IDs, blank generator/toolchain identities, or non-passed ingress/egress results.

The verifier returns `stopped_for_evaluation` with deterministic rule identifiers. Its `verificationId` is a SHA-256 digest over the canonical decision receipt. The digest is integrity metadata, not a signature or an independent attestation.

## Promotion sequence

1. Run the normal compiler-backed TJSV parity gate over independently authored TypeSpec and JSON Schema.
2. Produce and verify the parity-approved Contract IR against current inputs.
3. Run native runtime/validator conformance jobs for each required language/runtime.
4. Emit one closed language-boundary evidence envelope per generated artifact.
5. Call `verifyLanguageBoundaries()` with the exact retained parity report, Contract IR, manifest, and evidence map.
6. Promote generated artifacts only when the returned status is `passed` and `zeroUnexplainedFindings` is true.

This gate does not claim complete Protobuf/gRPC/Connect/tRPC/WIT/SQL/ORM generation or behavioral equivalence outside the evidence supplied by the caller. Those projections retain their own compatibility and conformance gates.
