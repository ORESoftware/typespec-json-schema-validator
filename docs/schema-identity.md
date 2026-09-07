# Fail-closed schema resource identity

`SchemaResolver` rejects multiple schema locations that claim one resource URI
or anchor. A later input may not silently replace an earlier validator. URI
resolution retains the existing URL normalization; empty-fragment IDs use the
canonical fragment-free resource key.

JSON Schema Draft 2020-12 Core section 9.1.2 recommends an error for conflicting
resource identities. Section 8.2.2 leaves repeated anchor names within a resource
undefined and permits rejection. This implementation deliberately rejects both:
https://json-schema.org/draft/2020-12/json-schema-core#section-9.1.2
https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.2

The error is `SchemaIdentityError`, with the URI, both source paths, and both
schema pointers. It contains no schema or instance payload. Two equal JSON
bodies in different files are still different locations; even reusing one
JavaScript object at two pointers does not establish a unique identity. Internal
re-registration of the exact same document location and multiple non-conflicting
aliases for that location remain valid. The same anchor name in distinct resources
also remains valid.

Each `addDocument` stages its entire URI map before committing. On a collision,
previous resources, anchors, document records and synthetic numbering remain
unchanged; no prefix of the rejected document leaks into the resolver. The staged
map covers only the incoming document, not a copy of all previously loaded data.

Schema-looking JSON inside `const`, `enum`, `default`, `examples`, and unknown
extension values stays literal data and does not register identities.

## Verification and boundaries

The 26 cases in `test/unit/schema-identity.test.mjs` cover duplicate roots and
embedded IDs, URI normalization, repeated anchors, input order, aliases, literal
data, booleans, and rollback including validation against the retained definition.
They were run on Node 22.16.0: 17 failed / 9 passed against the unchanged upstream
validator, then all 26 passed with this patch. The local baseline validator matched
Git blob `8715be88f9f6dccb276cc4a7a075a13da73e1bcd`; the local harness included only
the three exact canonical helper functions the validator imports. Full repository
CI, not that focused harness, remains the integration and package verification gate.

This change does not claim to fix nested relative-$id evaluation, add dynamic
reference support, or establish complete Draft 2020-12 conformance. Independently
authored TypeSpec and JSON Schema remain separate authorities.
