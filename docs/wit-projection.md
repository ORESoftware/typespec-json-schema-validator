# WIT projection interface

WIT is an additive downstream projection in this repository. The shared tooling implementation lives in [`ORESoftware/ores-wit`](https://github.com/ORESoftware/ores-wit).

This document defines the interface between the two repositories so that WIT can be used broadly for cross-language code contracts without weakening the independent TypeSpec + authored JSON Schema authority model.

## Responsibilities

`typespec-json-schema-validator` owns semantic admission:

- independently authored TypeSpec and JSON Schema remain peer authorities;
- parity findings must be resolved before a downstream projection is trusted;
- Contract IR identifies the reviewed operation/type surface;
- projection manifests bind artifacts to source digests, toolchain identity, emitter configuration and the exact reviewed revision;
- projection verification decides whether WIT evidence is admissible for release/merge gates.

`ores-wit` owns WIT-specific mechanics:

- parse/validate/canonicalize WIT packages with the Component Model toolchain;
- compute deterministic WIT source-tree digests;
- bind a validated WIT tree to exact Contract IR bytes in a WIT syntax/toolchain verification receipt;
- emit the normalized semantic WIT projection consumed by TJSV compatibility checks;
- orchestrate pinned binding generators where supported;
- define adapter/conformance policy for SDK languages outside a built-in WIT generator.

## Handoff

The intended flow is:

```text
TypeSpec + authored JSON Schema
        |
        v
parity receipt + Contract IR
        |
        +-----------------------> ores-wit
        |                           |
        |                           +--> validated WIT tree
        |                           +--> WIT digest
        |                           +--> WIT verification receipt
        |                           +--> language binding evidence
        |                           |
        +<--------------------------+
        |
        v
projection admission / verification
```

A WIT syntax/toolchain verification receipt is necessary evidence but is not, by itself, semantic admission or compatibility admission. A receipt proves that a specific WIT tree was syntactically validated and bound to specific Contract IR bytes. This repository remains responsible for proving that the WIT projection is semantically consistent with the admitted contract inventory and current projection policy.

## Required invariants

1. Generated WIT must never overwrite or silently rewrite authored TypeSpec or authored JSON Schema.
2. The WIT projection must carry `projection = "wit"` and remain in the additive projection set.
3. A production gate must bind the WIT digest to the same Contract IR/parity revision used for the other generated projections.
4. Generated SDKs derived from WIT remain downstream artifacts; successful code generation is not proof of semantic parity.
5. Streaming, resource lifetime, cancellation, transport and error semantics that cannot yet be represented faithfully in the selected WIT feature set remain explicit in Contract IR/conformance metadata rather than being weakened.
6. A consumer may establish an independently reviewed WIT authority lane only through an explicit policy change; it must never happen implicitly because a `.wit` file exists.

## Consumer gate

A `*-clients` repository should converge on a gate equivalent to:

```sh
# Existing authority/parity gate produces or verifies Contract IR.
tjsv ...

# WIT-specific validation and digest binding.
ores-wit check wit
ores-wit verify wit \
  --contract-ir generated/contract-ir.json \
  --receipt generated/wit-toolchain-verification.json

# TJSV owns the released-baseline compatibility decision.
tjsv verify-wit \
  --baseline contracts/wit/baseline.projection.json \
  --current generated/wit.projection.json \
  --mode strict \
  --verification generated/wit-compatibility.json

# This repository's projection admission/verification consumes the WIT evidence
# alongside the current projection manifest and parity receipt.
```

`ORESoftware/ores-wit` owns the WIT syntax/toolchain verification receipt. TJSV owns the normalized WIT projection schema and WIT compatibility receipt/baseline decision. The projection manifest/admission schema also remains owned here.

## Fleet policy

ORESoftware client repositories expose SDKs in many languages. WIT is therefore standardized as a shared contract/ABI vocabulary, not as a claim that one `wit-bindgen` executable directly generates every SDK language. Unsupported or separately tooled languages consume the same WIT/Contract-IR semantics through adapters and must pass cross-language conformance tests.
