# Architecture

## Peer-authority invariant

The validator has no “primary schema” setting. TypeSpec and authored JSON Schema are separate top-level authorities. The only generated artifact is the TypeSpec JSON Schema witness, whose role is fixed to `comparison-evidence-only` in every receipt.

```text
independently authored TypeSpec ──┬── source declaration inventory
                                 └── official JSON Schema emitter ── generated witness

independently authored JSON Schema ── Draft 2020-12 validation

source inventory + generated witness + authored schema
                         │
                         └── deterministic parity report
```

A mismatch does not trigger regeneration of either authority. It changes the outcome to `STOPPED_FOR_EVALUATION`.

## Source declaration gate

The TypeSpec scanner is lexical and brace-aware. It preserves source locations, ignores comments and strings, follows relative imports, distinguishes namespace bodies from model bodies, and reports unbalanced input. It inventories model, enum, union, scalar, and alias declarations. Simple-name collisions across namespaces are unsafe and therefore require an explicit mapping.

This gate catches missing/extra top-level declarations independently of emitter shape normalization.

## Translation evidence gate

The generator invokes `tsp compile` and the official `@typespec/json-schema` emitter with pinned settings:

- JSON output;
- a single `$defs` bundle;
- all user models and references emitted;
- string encoding for 64-bit integers by default;
- sealed object schemas by default; and
- `oneOf` for polymorphic models by default.

The CLI resolves the emitter from the validator's pinned dependency rather than requiring the
contract repository to install a second copy. If the external `tsp` subprocess cannot resolve the
contract's TypeSpec packages, the validator retries with its pinned compiler and a read-only
`node_modules` overlay. Missing domain-specific TypeSpec libraries and compiler diagnostics remain
hard failures; the fallback does not turn an invalid contract into a pass.

The emitter runs in a dedicated output directory. The validator hashes both authored inputs before and after emission and fails if either changes.

## JSON Schema structural gate

Both JSON Schema documents must explicitly declare Draft 2020-12. The structural pass checks schema-node types, local references, required-property membership, enum/type uniqueness, child-schema containers, numeric/cardinality bounds, and unsupported `nullable` usage.

This is intentionally not a replacement for a full instance validator. It verifies the declaration substrate needed for parity and fails closed on malformed comparison inputs.

## Normalization

Normalization is deliberately narrow and semantics-preserving:

- object keys are sorted;
- `definitions` and `#/definitions/...` are normalized to `$defs` spellings;
- set-like arrays (`required`, `enum`, `type`, `allOf`, `anyOf`, `oneOf`) are sorted and deduplicated;
- `{ "not": {} }` is normalized to the boolean false schema; and
- a simple disjoint primitive `anyOf`/`oneOf` is normalized to an equivalent type array.

The validator does not equate `additionalProperties` with `unevaluatedProperties`, remove descriptions/defaults, or ignore vendor extensions. Those can affect contract behavior or generated clients and remain comparison inputs.

## Result model

- `passed`: zero unexplained findings.
- `stopped_for_evaluation`: the tools ran, but authorities or evidence disagree.
- `failed`: the comparison could not be executed reliably.

Findings use stable SHA-256 fingerprints derived from rule, declaration, pointer, message, and values. Reports omit timestamps so identical runs remain byte-stable.
