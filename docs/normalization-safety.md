# Context-aware normalization and Contract IR admission

Follow-up to [issue #20](https://github.com/ORESoftware/typespec-json-schema-validator/issues/20)
and Linear DEN-3828. Independently authored TypeSpec and JSON Schema remain peer
authorities. This change repairs comparison and digest handling; it does not
implement transport emitters or establish universal schema equivalence.

## Three distinct contexts

1. **Generic JSON**: `canonicalizeJson` / `canonicalStringify` sort object keys
   deterministically. Every array retains its order and multiplicity, regardless
   of the name of its containing property. These functions do not interpret JSON
   Schema keywords. Own keys such as `__proto__` remain data, not prototype writes.
2. **Schema nodes**: the schema normalizers recognize supported keyword
   locations. Only actual schema metadata is removed for comparison. Executable
   normalization retains metadata. Actual unordered schema arrays are sorted;
   duplicates are not discarded, so invalid evidence and exclusive-union
   multiplicity remain visible. Tuple positions remain ordered.
3. **Schema maps and literal data**: keys of `properties`, `patternProperties`,
   `$defs`, and `dependentSchemas` are names, not keywords. Only their values are
   schemas. `const`, members of `enum`, examples, defaults, and opaque extension
   values are JSON data; keyword-looking keys inside them are never normalized
   as schemas. Annotation removal still applies to the enclosing schema keyword.

For calls on a keyword value rather than a complete schema, pass its context:

```js
normalizeSchemaNode(definitions, '$defs');
normalizeSchemaNodeForComparison(properties, 'properties');
```

Do not use generic JSON serialization as a schema-equivalence normalizer. First
normalize an actual schema with the correct context, then serialize it.

## Failure cases covered

A property named `title` must retain its type and length constraints. The literal
values `{"enum":[2,1]}` and `{"enum":[1,2]}` must have different digests. Two
identical `oneOf` alternatives must not become one alternative: a matching value
would satisfy two branches rather than exactly one. Similarly, integers match
both `number` and `integer`, so that `oneOf` cannot collapse into an inclusive
type array. Only supported, distinct, non-overlapping simple types may collapse.

Conflicting `$defs` and legacy `definitions` are rejected at every schema node,
not silently overwritten. JSON Pointer evaluation decodes the URI fragment
before token splitting, rejects malformed percent/tilde encodings, and accesses
only own JSON members. Array indexes cannot name `length`, inherited members,
or noncanonical indexes. Nested or encoded declaration-reference layouts are
not guessed to be equivalent to a top-level declaration reference.

The focused normalization tests cover these cases, immutability, idempotence,
and retained legitimate normalization. Contract IR regressions also exercise
constraint-drift rejection, exact receipt binding, and rejection of a tampered
artifact even after an attacker recomputes its envelope digest.

## Receipt and IR regeneration

The corrected canonicalization can change report, finding, schema, and IR
hashes where older serialization reordered or dropped data. Regenerate parity
receipts and Contract IR with the corrected validator and current inputs before
downstream promotion. Do not add a fallback accepting the old lossy hashes or
edit an authored source to recover an old hash. Consumers must still verify the
actual receipt, current input closure, and exported IR binding; a copied passed
status or a self-consistent envelope digest is insufficient.

This is not a claim of RFC 8785/JCS compliance, complete Draft 2020-12 resource
graph support, execution of all downstream runtime adapters, or a completed
Protobuf/gRPC/Connect/tRPC compiler. Those admission and projection requirements
remain separately tracked in issue #20 and its linked work.
