# Rule catalog

Rules are grouped by gate. Every emitted rule is an error in v0.1; suppressions require an explicit mapping/ignore contract rather than an inline comment.

## TypeSpec source inventory

- `typespec-source-*`: malformed or unsupported source structure discovered by the lexical inventory.
- `typespec-ambiguous-simple-name`: multiple qualified TypeSpec declarations collapse to the same default schema name.
- `mapping-target-collision`: explicit mappings route multiple TypeSpec declarations to one generated or authored name.

## Mapping integrity

- `mapping-typespec-declaration-missing`: a mapping names a TypeSpec declaration that is absent from the current source inventory.
- `mapping-typespec-simple-name-ambiguous`: a mapping uses an unqualified TypeSpec name shared by multiple namespaces.
- `mapping-typespec-duplicate`: a programmatic mapping repeats one TypeSpec key. Mapping files reject this as configuration before comparison.
- `mapping-declaration-invalid`: a programmatic mapping declaration does not provide a usable TypeSpec name.
- `mapping-ignore-typespec-stale`: a TypeSpec ignore entry no longer resolves.
- `mapping-ignore-typespec-ambiguous`: an unqualified TypeSpec ignore entry resolves to multiple declarations.
- `mapping-ignore-generated-stale` / `mapping-ignore-authored-stale`: a lane-specific ignore entry names no declaration in that lane.
- `mapping-ignore-duplicate`: a programmatic ignore array repeats one name. Mapping files reject duplicates before comparison.
- `mapping-ignore-invalid-name`: a programmatic ignore contains an empty or invalid name.
- `mapping-typespec-ignore-conflict`: one TypeSpec declaration is both mapped and ignored.
- `mapping-generated-ignore-conflict` / `mapping-authored-ignore-conflict`: a mapped lane target is also ignored.

These rules make mappings and ignores auditable configuration, not a way to hide a rename or declaration-set mismatch. See [mapping integrity](mapping-integrity.md).

## Declaration inventory

- `generated-declaration-missing` / `authored-declaration-missing`: a TypeSpec declaration has no peer in that lane.
- `generated-declaration-extra` / `authored-declaration-extra`: a JSON Schema declaration has no independently authored TypeSpec peer.
- `*-declaration-kind-mismatch`: model/enum/union/scalar-like families disagree.
- `generated-authored-declaration-set-mismatch`: the two JSON Schema lanes expose different declaration sets.
- `generated-authored-kind-mismatch`: generated and authored schemas infer different kind families.

## Draft 2020-12 structure

- `json-schema-dialect`: the explicit dialect is absent or not Draft 2020-12.
- `json-schema-unresolved-local-ref`: a local JSON Pointer does not resolve within the nearest schema resource. Anchor references are resolved by the resource graph rather than misread as pointers.
- `json-schema-invalid-id`, `json-schema-invalid-schema-uri`, and `json-schema-invalid-ref`: an identifier, dialect URI, or reference is not a valid URI form for its keyword.
- `json-schema-invalid-anchor`: `$anchor` or `$dynamicAnchor` violates the Draft 2020-12 anchor grammar.
- `json-schema-invalid-vocabulary*`: `$vocabulary` is not an object mapping absolute vocabulary URIs to booleans.
- `json-schema-invalid-regex`: `pattern` or a `patternProperties` key is not a valid ECMA-262 Unicode regular expression.
- `json-schema-empty-array`, `json-schema-invalid-array`, `json-schema-invalid-array-item`, and `json-schema-duplicate-array-item`: an array-valued keyword violates its Draft 2020-12 shape or uniqueness rule.
- `json-schema-invalid-schema-map` and `json-schema-invalid-child-schema`: a schema-bearing keyword has the wrong immediate shape.
- `json-schema-invalid-type`, `json-schema-duplicate-type`, and `json-schema-empty-type`: `type` is outside the seven JSON Schema primitive names or has invalid array semantics.
- `json-schema-invalid-number`, `json-schema-invalid-cardinality`, and `json-schema-invalid-multiple-of`: a numeric validation keyword has an invalid value.
- `json-schema-invalid-string`, `json-schema-invalid-boolean`, and `json-schema-invalid-json-value`: a metadata or validation keyword has the wrong JSON type.
- `json-schema-openapi-nullable-keyword`: OpenAPI `nullable` appears in the JSON Schema authority.
- `json-schema-impossible-range`: a lower bound exceeds its upper bound.
- `json-schema-invalid-*`: another recognized keyword has a value of the wrong shape.

`required` is not required to repeat names from `properties`. Draft 2020-12 permits a schema to require a property while leaving its value unconstrained, including when no `properties` keyword is present.

## Differential instance validation

- `instance-verdict-divergence`: the two authorities return different verdicts for one instance.
  The finding carries `witness.instance` — the value that proves the disagreement — plus both
  lanes' verdicts and their first few validation errors.
- `differential-validation-refused`: a keyword the validator refuses to approximate
  (`$dynamicRef`, `$dynamicAnchor`, `$recursiveRef`, `$vocabulary`) or an unresolvable `$ref`
  made the comparison unsound. This is reported rather than counted as agreement.
- `declared-example-rejected`: a declaration carries an `examples` entry or `default` value that
  neither authority accepts. The two lanes agree, and they agree the schema's own sample is wrong.
- `corpus-instance-rejected` / `corpus-instance-accepted`: an instance under
  `<Declaration>/valid/` was rejected, or one under `<Declaration>/invalid/` was accepted, by
  both authorities. The corpus is a third statement of intent and is held to it.
- `corpus-declaration-unknown`: the corpus targets a declaration absent from one or both
  authorities, so its instances could never have been checked.

## Semantic parity

- `generated-authored-semantic-mismatch`: normalized declaration bodies differ at the reported JSON Pointer.

The report includes both values. The tool never selects one as the winner.

## Reading structural and differential findings together

`differential.declarations[].behaviorallyIndistinguishable` says whether a declaration survived
the whole probe corpus with matching verdicts. A `generated-authored-semantic-mismatch` on a
declaration that is behaviourally indistinguishable is a spelling difference between two
equivalent encodings; the same rule on a declaration that also carries an
`instance-verdict-divergence` is a real contract difference with a witness attached. Both stop
evaluation. The flag tells a reviewer which conversation to have, not which authority to change.
