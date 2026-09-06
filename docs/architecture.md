# Architecture

## Peer-authority invariant

The validator has no “primary schema” setting. TypeSpec and authored JSON Schema are separate top-level authorities. The only generated artifact is the TypeSpec JSON Schema witness, whose role is fixed to `comparison-evidence-only` in every receipt.

```text
independently authored TypeSpec ──┬── source declaration inventory
                                 └── official JSON Schema emitter ── generated witness

independently authored JSON Schema ── Draft 2020-12 validation

source inventory + generated witness + authored schema
                         │
                         ├── structural parity comparison
                         ├── differential instance validation (each lane validates the other's instances)
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

This gate verifies the declaration substrate needed for parity and fails closed on malformed comparison inputs. Instance-level semantics are covered separately by the differential gate below.

## Differential instance gate

Structural comparison answers *do the two documents say the same thing?* That question is
strictly harsher than the one a contract actually needs answered, because two spellings can be
byte-different and behaviourally identical (`additionalProperties: false` versus
`unevaluatedProperties: false` on a composition-free model, `minimum: 0` versus
`exclusiveMinimum: -1` on an integer). The differential gate answers the decidable question
instead: *is there a JSON value the two authorities disagree about?*

```text
authored JSON Schema (A) ──┐                  ┌── verdict A
                           ├── probe corpus ──┤
generated witness    (B) ──┘                  └── verdict B

verdict A ≠ verdict B  ⇒  finding + the witness instance that proves it
```

The probe corpus for each declaration is assembled deterministically from both lanes:

- `examples` and `default` values declared in either authority;
- a synthesized `full` instance (every declared property) and `minimal` instance (required
  properties only), built from each lane's own schema;
- every member of every closed value domain (`enum`, `const`) reachable from the declaration,
  including through `$ref` — a one-member enum difference is invisible to a single
  representative instance and is exactly the drift this catches; and
- a bounded, ordering-stable family of mutants: property deletion, unexpected-property
  injection, and typed scalar substitution at every instance pointer.

A probe does not have to be *valid* to be informative. Disagreement is the signal, and
disagreement is meaningful whether the probe is accepted or rejected, so synthesis quality
affects coverage but never soundness.

Both directions run: A validates instances derived from B, and B validates instances derived
from A. Neither lane is the winner — a divergence reports both verdicts and stops evaluation.

The validator backing this gate (`src/instance-validator.mjs`) is dependency-free and covers
the Draft 2020-12 core, applicator, and validation vocabularies including annotation-driven
`unevaluatedProperties` / `unevaluatedItems`. It is fail-closed by construction: the dynamic
reference family (`$dynamicRef`, `$dynamicAnchor`, `$recursiveRef`, `$vocabulary`) and
unresolvable references raise rather than evaluate, because silently skipping a keyword would
make two genuinely different schemas look identical. Refusals are reported as
`differential-validation-refused`, never as agreement.

An explicit instance corpus can be supplied with `--instances`, using directory layout as the
contract:

```text
instances/<Declaration>/valid/*.json     both authorities must accept
instances/<Declaration>/invalid/*.json   both authorities must reject
instances/<Declaration>/*.json           no stated expectation; only disagreement is reported
```

Per-declaration results carry `behaviorallyIndistinguishable`. That flag is the triage signal
for the structural gate: a structural finding on a declaration that is behaviourally
indistinguishable over the probe corpus is a spelling difference to reconcile, while one that
also carries witnesses is a contract difference. Both still stop evaluation; only the reviewer's
next step differs.

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
