# Resource-aware parity and evaluation refusals

Tracking: DEN-3828, resource-graph issue #8.

Human-authored TypeSpec and Draft 2020-12 JSON Schema remain independent peer
authorities. The official emitter's schema is comparison evidence. None of the
changes below rewrite either authority or turn generated output into a source.

## Static reference comparison

For loaded collections, parity binds each `$ref` to its actual source-document
location before removing `$id` metadata. The comparison identity contains the
paired declaration and its exact relative subschema pointer. A nested `Value`
definition cannot silently become the top-level `Value` declaration just because
their simple names agree. Different resource URIs can still compare equally when
they identify the same paired schema locations.

Unresolved references, targets outside the compared declarations, unsupported
resource dialects, and dynamic-reference/vocabulary semantics stop static admission. This also applies
to optional properties and when instance probes are disabled. The graph is local;
the comparator performs no network retrieval. Reference-looking JSON within
`const`, `enum`, examples, defaults and extensions remains literal data.

The low-level declaration-only comparator remains a structural convenience for
callers without source documents; it supplies no resource-graph proof. The public
runner loads complete collections for admission. This is conservative structural
parity with reference identity, not a decision procedure for arbitrary schema
equivalence or pure helper-reference inlining.

## Executable resource scope

Resolver entries retain both the inherited URI base and the base after applying
the target's own `$id`. Evaluation applies relative identifiers exactly once.
Document-relative pointers, embedded-resource pointers, percent-encoded pointers,
anchors and boolean schemas recover the registered target's scope and source
location. Identifiers that cannot resolve against their inherited base are
refused without partially registering a document. A directory-bearing identifier cannot redirect a reference into a
similarly named decoy resource through double application.

## Refusal is distinct from rejection

`SchemaEvaluationError` reports `reference-cycle` or `maximum-depth`. It is an
exception, not a `valid: false` result: `not`, `oneOf`, or an `if` branch must never
convert unfinished evaluation into a positive verdict. Probe contexts share the
active reference stack while retaining isolated assertion errors. Finite recursive
descent through instance properties remains supported.

Differential validation and legal-manifest validation record these exceptions as
refusals. Two unfinished lanes cannot produce behavioral agreement or admission.
Diagnostics contain schema locations and reasons, without instance payloads.

## Verification

Focused regressions live in `test/unit/scoped-parity.test.mjs`,
`test/unit/reference-scope.test.mjs`, and `test/unit/evaluation-refusal.test.mjs`.
They cover symmetric authority drift, immutable inputs, independent resource names,
literal JSON, dangling and dynamic references, exact target scope, directory
decoys, finite recursion, branch isolation, evaluation limits, and refused-lane
receipts. Run these with the existing reference-identity and validator tests, then
run `npm run test:all` and `npm run release:preflight` on the exact candidate head.
`test/integration/reference-admission.test.mjs` also verifies actual CLI refusal
receipts, immutable source files, and non-admissible Contract IR tombstones.

Draft 2020-12 specifies [reference resolution against the current URI base](https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.1)
and [guards against infinite recursion](https://json-schema.org/draft/2020-12/json-schema-core#section-9.4.1).
This implementation deliberately refuses undefined cyclic evaluation. Full
dynamic-reference execution, complete meta-schema validation, and a pinned
external catalog remain tracked by issue #8.
