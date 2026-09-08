# Consumer receipt envelope safety

Tracking: DEN-3830; [architecture issue #20](https://github.com/ORESoftware/typespec-json-schema-validator/issues/20).

## Recognition is narrower than a self-digest

The safe file writer recognizes only the closed, ten-field consumer-verification
receipt envelope. A correct recomputed `verificationId` does not authorize extra
fields: otherwise a receipt-shaped document containing unrelated authored data
could be classified as replaceable validator output. Both incoming receipts and
existing destination files must satisfy the same recognition rules.

Declaration identities must be nonempty, trimmed, strictly sorted and unique, and
must not exceed the published schema's 512-character limit. JSON Schema counts
Unicode characters rather than JavaScript UTF-16 code units. The writer stops
counting once the bound is exceeded and does not allocate a code-point array.

This does not relax the receipt producer's separate, stricter 512-byte limit in
`consumer-verification-receipt.mjs`. Nor is the envelope check cryptographic
attestation: digests are unkeyed integrity identifiers. Downstream admission must
still verify the actual Contract IR, parity receipt, complete declaration scope,
and current peer-authority input closure. TypeSpec and independently authored
JSON Schema retain their separate authority.

## Regression evidence

Run:

```sh
node --test test/unit/consumer-receipt-envelope.test.mjs
```

The suite exercises unknown and prototype-sensitive own properties, overlong
ASCII and supplementary Unicode identities, passed and failed envelopes,
missing required fields, refusal to replace valid evidence with invalid input,
valid boundary values, passed/failed transitions, and symbolic/hard-link safety.
Rejected existing documents remain byte-for-byte intact. Synthetic diagnostic
fixtures stay in the repository's ignored `tmp/` directory; no cleanup of user
files or Git state is performed.

At baseline commit `630044e846c8091e6df74fb158f7e46aaf9bebc5`, these 19 new tests
produced 13 failures and 6 passes on Node 22.16.0/Linux. After the writer fix,
all 19 passed with zero skips. The locally extracted writer, canonical helper,
and finding-limit helper were verified byte-for-byte against their Git blob
identities before the baseline run. This is focused source evidence, not a
claim that a partial local extraction executed the full compiler or fleet.

The repository's existing Linux/macOS CI must independently run its complete
checks on the PR head. No consumer dependency is promoted merely because the
focused test passes. No mobile, production database, or sibling-org end-to-end
certification follows from this change.
