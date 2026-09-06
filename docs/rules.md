# Rule catalog

Rules are grouped by gate. Every emitted rule is an error in v0.1; suppressions require an explicit mapping/ignore contract rather than an inline comment.

## TypeSpec source inventory

- `typespec-source-*`: malformed or unsupported source structure discovered by the lexical inventory.
- `typespec-ambiguous-simple-name`: multiple qualified TypeSpec declarations collapse to the same default schema name.
- `mapping-target-collision`: explicit mappings route multiple TypeSpec declarations to one generated or authored name.

## Declaration inventory

- `generated-declaration-missing` / `authored-declaration-missing`: a TypeSpec declaration has no peer in that lane.
- `generated-declaration-extra` / `authored-declaration-extra`: a JSON Schema declaration has no independently authored TypeSpec peer.
- `*-declaration-kind-mismatch`: model/enum/union/scalar-like families disagree.
- `generated-authored-declaration-set-mismatch`: the two JSON Schema lanes expose different declaration sets.
- `generated-authored-kind-mismatch`: generated and authored schemas infer different kind families.

## Draft 2020-12 structure

- `json-schema-dialect`: the explicit dialect is absent or not Draft 2020-12.
- `json-schema-unresolved-local-ref`: a local JSON Pointer does not resolve.
- `json-schema-required-property-missing`: `required` names a property not present in `properties`.
- `json-schema-duplicate-array-item`: a set-like keyword contains a duplicate.
- `json-schema-openapi-nullable-keyword`: OpenAPI `nullable` appears in the JSON Schema authority.
- `json-schema-impossible-range`: a lower bound exceeds its upper bound.
- `json-schema-invalid-*`: a keyword has a value of the wrong shape.

## Semantic parity

- `generated-authored-semantic-mismatch`: normalized declaration bodies differ at the reported JSON Pointer.

The report includes both values. The tool never selects one as the winner.
