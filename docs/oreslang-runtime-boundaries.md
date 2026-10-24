# Oreslang language-boundary runtime profile

The TJSV language-boundary schema is language-neutral; adding Oreslang does
not require changing the authored TypeSpec/JSON Schema pair or treating generated
Oreslang declarations as an authority.

## Target identities

| Language | Runtime | Admission |
| --- | --- | --- |
| `oreslang` | `graalvm-jvm` | Required **only once real native adapter CI exists** |
| `oreslang` | `javascript-browser` | Optional future backend |
| `oreslang` | `wasm-browser` | Optional future backend |

During bootstrap, all target declarations may remain optional until a real
native runtime is ready; **optional does not count as proven implementation**.
When JVM becomes required, this library correctly refuses an absent, schema
invalid, stale, or incorrectly bound evidence envelope.

Promotion must call `verifyLanguageBoundariesAgainstCurrentInputs` against
independently authored TypeSpec and JSON Schema Draft 2020-12 and its exact
Contract IR/receipt identities, then run the approved positive and negative
fixtures through an Oreslang compiler/runtime adapter. Both ingress and egress
must pass for every required Oreslang runtime target. Browser backends require
their own distinct toolchain/evidence identities, sandbox limits and
differential tests; no Java host interop is assumed.

The included native boundary tests demonstrate **fail-closed evidence policy**,
not Oreslang compiler/serializer correctness.
