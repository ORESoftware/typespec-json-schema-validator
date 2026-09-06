# Report-file safety

The CLI and exported `writeReport` API use the same guarded persistence path.
An existing output file is replaced only when it contains the recognized
validator receipt envelope: the current report `schema`, a hexadecimal SHA-256
`runId`, a supported status, boolean `zeroUnexplainedFindings`, and a `findings`
array. This ownership check does not replace full report-schema validation.

Existing unrelated JSON, authored TypeSpec/schema files, empty files, malformed
receipts, unknown-version receipts, directories, symbolic links (including
dangling links), and multiply linked files are rejected without truncation.
Use a dedicated output path such as
`.typespec-json-schema-validator/report.json`; do not pre-create an empty file.
A damaged or unrelated existing destination must be preserved or moved by its
owner, or a different report path selected. The validator never deletes it to
make the next run pass.

Report serialization happens before filesystem mutation. Complete bytes are
written and synced to an exclusively created sibling file with mode `0600`.
First publication uses a no-clobber hard link; replacement of a recognized
receipt uses a rename after rechecking its identity and metadata. Temporary
files are removed during normal error/success cleanup. Replaced receipts also
receive mode `0600`. Filesystems that do not support the required operations
fail rather than falling back to a truncating write.

If the requested error-receipt destination is unsafe, the CLI retains its
nonzero exit code and reports the write refusal on stderr. It does not silently
select another file or overwrite the source. Normal error receipts at safe
paths remain supported and can be updated on subsequent runs.

## Boundaries

This is protection against accidental clobbering of existing non-receipt
files, not proof that an output directory is separate from all input roots.
An intentionally supplied receipt-shaped input cannot be distinguished from
an old output by its envelope alone. Continue to keep report/evidence paths
separate from authored authorities, mappings, and instance corpora.

Atomic visibility is not a power-loss durability guarantee. A killed process
can leave a private sibling temporary file. The metadata recheck detects
ordinary drift, but this writer is not a sandbox against a hostile process
that concurrently changes parent directories or races replacement. Coordinate
concurrent writers and use a trusted, dedicated output directory.

Regression coverage lives in `test/unit/report-file.test.mjs` and
`test/integration/report-safety.test.mjs` and is included in `npm run test:all`.
