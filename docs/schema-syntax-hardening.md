# Draft 2020-12 schema-node syntax guard

The parity runner has two independently authored authorities: TypeSpec and JSON
Schema Draft 2020-12. The JSON Schema emitted by TypeSpec is comparison evidence,
not a source that may overwrite the authored JSON Schema.

Before a schema node is admitted to the resolver's URI index, the shared syntax
guard now checks the parts of the Draft 2020-12 core, applicator, validation,
unevaluated, format, content, and metadata vocabularies that can be decided from
that node alone. The guard is deliberately local: child schemas are checked when
the resolver visits their own locations.

## Fail-closed checks

The resolver rejects a node before mutating either its staged or committed URI
map when any of these conditions is present:

- `$id`, `$ref`, `$dynamicRef`, or `$schema` has the wrong type or invalid URI
  syntax;
- `$id` carries a non-empty fragment;
- `$anchor` or `$dynamicAnchor` is outside the Draft 2020-12 ASCII NCName
  profile;
- `$vocabulary` does not map absolute vocabulary URIs to booleans;
- a schema map, schema array, or single-schema keyword has the wrong immediate
  shape;
- a validation keyword has the wrong scalar, array, or cardinality type;
- `enum`, `required`, `type`, `dependentRequired`, or legacy string-array
  `dependencies` contains forbidden duplicates or invalid members;
- `pattern` or a `patternProperties` key is not a valid ECMA-262 Unicode regular
  expression; or
- an in-memory caller supplies a non-JSON value in `const`, `default`,
  `examples`, or `enum`.

Schema arrays are never deduplicated. Repeated `oneOf` branches can change the
verdict, and repeated examples remain valid annotation data.

## Resolver transaction boundary

`registerSchemaUri()` validates first and mutates second. If syntax validation
or identity conflict detection fails, the pending map remains unchanged. The
outer `SchemaResolver` already commits a complete document only after every
reachable schema node has registered successfully, so a rejected document
cannot leave a partial resource or anchor graph behind.

## Regular-expression policy

Draft 2020-12 expects ECMA-262 regular expressions with Unicode behavior. The
syntax guard compiles with JavaScript's `u` flag and does not retry without it.
A legacy fallback can accept different syntax and produce different matches,
which would make differential evidence unsound.

This check establishes syntax compatibility only. Runtime evaluation remains
bounded by the caller's probe and input limits, and complete protection against
adversarial regular-expression complexity remains part of the broader
resource-graph and execution-budget work.

## Scope boundary

This slice does not claim complete `$dynamicRef` execution, network retrieval,
or complete official meta-schema evaluation. Dynamic references continue to be
refused rather than approximated. External resources still require an explicit,
pinned local catalog before they can be admitted. Those requirements remain
tracked by issue #8 and the downstream architecture in issue #20.
