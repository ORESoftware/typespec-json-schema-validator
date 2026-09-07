# Mapping integrity

A declaration mapping is an explicit bridge between independently authored
TypeSpec and JSON Schema names. It is not a suppression mechanism and it cannot
be allowed to turn stale configuration into a clean parity receipt.

## Closed executable shape

`loadMapping()` now enforces the same closed-world structure published in
`schema/mapping.schema.json` before comparison begins:

- the document and `ignore` value must be objects;
- root, declaration, and ignore objects reject unknown properties;
- every declaration supplies one non-empty TypeSpec name;
- generated and authored targets are non-empty when present;
- TypeSpec mapping keys are unique across the file;
- ignore arrays contain unique, non-empty names; and
- names may not contain leading or trailing whitespace.

These are configuration errors and exit through the normal failed-run path.
Programmatic callers can still construct mapping objects directly, so parity
comparison independently audits semantic references and emits deterministic
findings rather than trusting that the file loader ran.

## Semantic reference audit

The mapping-integrity gate resolves every TypeSpec mapping and ignore reference
against the current source inventory, and every generated/authored ignore
reference against the current declaration collection. Evaluation stops when:

- a mapping names a TypeSpec declaration that no longer exists;
- a simple TypeSpec name matches multiple namespaces and is not qualified;
- an ignore entry is stale or ambiguous;
- one TypeSpec declaration is both mapped and ignored;
- a generated or authored mapping target is also ignored;
- a programmatic mapping repeats a TypeSpec key or ignore value; or
- a programmatic ignore contains an invalid empty name.

A qualified TypeSpec mapping remains the supported way to bridge declarations
that share a simple name. Intentional exclusions remain supported, but they must
name a declaration that exists and must not contradict a mapping in the same
configuration.

## Why this is fail-closed

Without this gate, a rename can leave a mapping or ignore entry behind. A stale
mapping might be silently unused; a broad simple-name ignore might hide more
than one namespace; and a mapping target listed in an ignore lane can erase the
very declaration the mapping claims to compare. All three situations make a
passing receipt ambiguous.

Mapping-integrity findings are ordinary error findings with stable
fingerprints, deterministic ordering, SARIF projection, and max-findings
truncation. They do not select either authority as the winner. The operator must
repair or deliberately revise the mapping and rerun the exact revision.
