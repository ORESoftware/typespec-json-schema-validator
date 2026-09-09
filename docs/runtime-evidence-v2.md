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

## Trusted case binding

For v2 admission, every trusted `expectedCases` entry must also carry the SHA-256 digest of its canonical input. TJSV compares each adapter result directly with that trusted digest. Agreement between adapters is not sufficient: two adapters that report the same wrong or fabricated digest still fail with `runtime-case-input-digest-mismatch`.

The trusted corpus loader computes these digests from the exact canonical fixtures before invoking the adapters. The loader also computes `expectedCorpusDigest` over the complete recorded corpus. Adapters consume those fixtures and report observations; they do not author their own expectations or trusted input identities.

This binding is required whenever v2 evidence is presented or `requiredEvidenceSchema` explicitly requires v2. Legacy v1 admission continues to accept expectation-only case metadata.

## Cross-adapter decision rules

For v2 evidence TJSV keeps the existing trusted verdict checks and additionally stops evaluation when:

- an adapter's per-case input digest differs from the trusted case digest;
- adapters disagree with one another on the per-case input digest;
- adapters disagree on canonical admitted output digest for an accepted case; or
- adapters disagree on canonicalized stable error evidence for a rejected case.

Therefore a trimming/coercing/default-inserting adapter cannot hide behind the same `accepted` verdict when another adapter preserves a different admitted value, and mutually consistent adapters cannot substitute an untrusted input.

`requiredEvidenceSchema` may be supplied to `compareRuntimeEvidence()` or `verifyRuntimeEvidenceAgainstCurrentInputs()` when an assurance profile requires v2. If it is omitted, both the legacy v1 and semantic v2 envelopes are accepted for backward compatibility. A v1 receipt never acquires v2 semantics by inference.

## Migration

1. Existing consumers may continue emitting `RUNTIME_EVIDENCE_SCHEMA` / v1 unchanged.
2. Stronger consumers explicitly emit `RUNTIME_EVIDENCE_SCHEMA_V2`, populate semantic fields for every result, and supply trusted per-case `inputDigest` values in `expectedCases`.
3. Promotion policies that require semantic evidence pass `requiredEvidenceSchema: RUNTIME_EVIDENCE_SCHEMA_V2`.
4. Test-org canaries mutate the trusted input digest, admitted output, and stable error evidence independently of verdicts and require `stopped_for_evaluation`.
5. Consumers must include a collusion negative control in which all adapters report the same wrong input digest; peer agreement alone must never pass.

Finite runtime cases remain regression evidence, not universal equivalence proof. Unsupported required semantics remain fail-closed.
