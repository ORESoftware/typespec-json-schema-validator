# Reference identity during peer-schema comparison

Tracking: DEN-3830; architecture issue #20. This addendum narrows the filename shortcut in `normalizeComparisonRef`; it does not replace either authored contract authority or change runtime reference resolution.

The comparator may equate a simple local `User.json` or `./User.json` reference with the mapped declaration `#/$defs/User` (or the legacy `#/definitions/User`). It must not treat URI schemes, paths, percent-encoded names, whitespace, or control characters as evidence that a reference identifies a local declaration. Those spellings remain unchanged. Conservative mismatches require evaluation rather than an invented mapping.

RFC 3986 section 4.2 distinguishes scheme-bearing references from relative paths: a colon cannot appear in the first segment of a path-noscheme reference. RFC 6901 section 3 gives literal tilde and slash the pointer spellings `~0` and `~1`. Accordingly, a local file named `A~1B.json` corresponds to the declaration named `A~1B`, whose pointer is `#/$defs/A~01B`; it must not compare equal to `#/$defs/A~1B`, which names `A/B`.

The full-match check is intentional. JavaScript's `$` assertion can match before a final line terminator; accepting a prefix of an untrusted reference would silently discard part of its identity.

## Verification

Run `node --test test/unit/reference-identity.test.mjs`. The regression suite covers preserved resource/path spellings, exact local names, tilde escaping, remaining mismatch findings, normalization idempotence, non-string inputs, input immutability, opaque literal JSON, and the separation from executable schema normalization.

On the pre-fix canonical module blob `07a1e8a97c10bcc70f675cad5ac6889e6b535f41`, 28 of the 49 new cases fail. With the fix, all 49 pass under Node 22.16.0. These focused results are not a substitute for the repository's complete `npm run test:all` gates on the exact candidate revision.

This is a syntactic comparison safeguard, not a proof of arbitrary JSON Schema equivalence or URI-resource equivalence. Existing declaration mapping, source closure, structural validation, differential conformance, and receipt/projection admission checks remain required. No compiler version, generated artifact, SQL/ORM projection, credential, or consumer dependency lock is changed.

References: https://www.rfc-editor.org/rfc/rfc3986#section-4.2 and https://www.rfc-editor.org/rfc/rfc6901#section-3.
