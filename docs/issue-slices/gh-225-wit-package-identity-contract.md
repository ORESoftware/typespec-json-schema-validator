# normalized WIT package identity

Driver: `ORESoftware/typespec-json-schema-validator#225`

This document captures one bounded review contract for an independently mergeable slice of the driver issue; it does not claim full implementation.

## Invariants

- Normalize package identity to the real WIT `namespace:name` grammar rather than a permissive display string.
- Reject empty segments, separators outside grammar, control characters, and ambiguous normalization.
- Compatibility/projection evidence must bind the normalized identity plus exact source/tool revisions.
- Normalization may canonicalize representation but must not merge two semantically distinct package identities.

## Verification

- Verify the exact PR head with the repository's normal contract/test gates.
- Include fail-closed negative cases for malformed or unsupported input.
- Bind generated evidence to immutable producer/tool/source identity.
- Treat missing, skipped, or zero-step CI as missing evidence.

## Non-goals

This slice does not add credentials, bypass review, or change authored contract authority without the driver issue's explicit implementation work.
