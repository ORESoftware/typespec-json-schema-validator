# Runtime evidence envelope safety

Tracking: DEN-3828; upstream issue #20.

The runtime-conformance API is part of TJSV's cross-language admission boundary.
The independently authored TypeSpec and JSON Schema sources remain peer
engineering authorities. Adapter evidence is never another authority, even when
it claims every runtime case passed.

## Closed wire objects

`schema/runtime-evidence.schema.json` already declares `additionalProperties:
false` for the evidence document, each adapter, and each result. The executable
normalizer now enforces those closed shapes rather than silently admitting an
object after discarding its undeclared fields.

The required fields must be own, enumerable data properties. Inherited values,
non-enumerable fields, and accessor getters are not JSON wire data and cannot
satisfy the contract through the direct JavaScript API. Validation inspects
property descriptors and creates a data-only snapshot before reading values.
The adapter result collection is taken from that snapshot too.

Findings use `runtime-evidence-fields-invalid`,
`runtime-adapter-fields-invalid`, or `runtime-result-fields-invalid`. They are
unexplained errors and therefore stop the runtime conformance decision even
when the supplied case verdicts match the trusted corpus. Normalized evidence
still omits undeclared fields for compatibility and redaction; its existence
alone does not mean admission passed.

Diagnostics retain field names, never unknown field values. Unexpected names
are sorted and capped at sixteen per envelope, with a total count. Neither
known accessor getters nor unknown values are executed or serialized. Exact
null-prototype objects remain supported.

## Digests must be primitive strings

`contractIrId`, `inputDigest`, and `corpusDigest` must be lowercase SHA-256
strings. A one-element array, nested array, boxed string, or object with a
coercion method must not pass a regular expression through JavaScript string
coercion. Non-string digest diagnostics contain only the value's type, not the
object, so diagnostic fingerprinting does not invoke its `toJSON` method.

## Regression coverage

`test/unit/runtime-evidence-envelope.test.mjs` runs 103 dependency-free checks
against the real normalizer. At base commit
`4473504c4c9d2831d825919f70c03994d8ce01d2`, 87 of those checks failed; all 103
pass with the fix. The local source snapshot was verified against GitHub blob
hashes for all nine transitive source files; no module stubs were used.

`test/unit/runtime-evidence-envelope-admission.test.mjs` additionally checks
that an exact synthetic fixture passes and that extra fields at all three
levels stop the complete conformance decision without leaking their values.
These are unit fixtures, not evidence of executing Rust, Dart, Go, or other
native runtime validators. The existing full repository CI separately runs
syntax, canonical CLI-contract, unit, compiler-backed integration, and package
checks on Linux and macOS; its outcome must be checked on the exact PR head.
