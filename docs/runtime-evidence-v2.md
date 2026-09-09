# Runtime evidence v2: semantic output and stable validation errors

Runtime evidence v1 remains supported for verdict-only consumers. Version 2 is an opt-in stronger evidence envelope for assurance profiles that need to prove more than `accepted` versus `rejected` parity.

Neither runtime evidence version is an authored contract authority. Human-authored TypeSpec and human-authored JSON Schema/OpenAPI remain independent peer authorities. Contract IR, runtime receipts, output digests, and error summaries are downstream evidence only.

## Result envelope

Every v2 case result carries the fixed fields:

- `caseId`, `declaration`, `verdict`;
- `inputDigest`: SHA-256 of the canonical trusted case input used by the adapter;
- `outputDigest`: SHA-256 of canonical admitted JSON for an accepted case, otherwise `null`;
- `errors`: stable validation errors for a rejected case, otherwise empty.

Accepted values never appear in the evidence file itself. Only their canonical digest is retained. Rejected values, raw exception messages, stack traces, stdout/stderr, credentials, and environment values remain forbidden.

A stable validation error contains `{ path, code, params }`. `path` is an RFC 6901 JSON Pointer. `code` and parameter names are bounded lowercase identifiers. Parameter values are restricted to null, booleans, or finite JSON numbers. String-valued params are deliberately forbidden because a raw rejected value can itself look like an identifier. Stable categorical metadata such as type or format identity belongs in the error `code` (for example `type_string` or `format_email`), while numeric rule metadata such as minimum/maximum bounds may live in `params`.

## Cross-adapter decision rules

For v2 evidence TJSV keeps the existing trusted verdict checks and additionally stops evaluation when adapters disagree on:

- the per-case trusted input digest;
- canonical admitted output digest for an accepted case;
- canonicalized stable error evidence for a rejected case.

Therefore a trimming/coercing/default-inserting adapter cannot hide behind the same `accepted` verdict when another adapter preserves a different admitted value.

`requiredEvidenceSchema` may be supplied to `compareRuntimeEvidence()` or `verifyRuntimeEvidenceAgainstCurrentInputs()` when an assurance profile requires v2. If it is omitted, both the legacy v1 and semantic v2 envelopes are accepted for backward compatibility. A v1 receipt never acquires v2 semantics by inference.

## Migration

1. Existing consumers may continue emitting `RUNTIME_EVIDENCE_SCHEMA` / v1 unchanged.
2. Stronger consumers explicitly emit `RUNTIME_EVIDENCE_SCHEMA_V2` and populate semantic fields for every result.
3. Promotion policies that require semantic evidence pass `requiredEvidenceSchema: RUNTIME_EVIDENCE_SCHEMA_V2`.
4. Test-org canaries should mutate admitted output and stable error evidence independently of verdicts and require `stopped_for_evaluation`.

Finite runtime cases remain regression evidence, not universal equivalence proof. Unsupported required semantics remain fail-closed.
