# Projection evidence file I/O

Related: issue #20, DEN-3828. This strengthens evidence loading; it does not add a transport emitter or promote generated files into authorities.

`loadProjectionManifest()` and `hashProjectionFiles()` read only singly linked regular files. Every path component leading to the file must be a real directory rather than a symbolic link, including ancestors of the configured root. Supply a canonical, trusted checkout path on systems where temporary-directory aliases are symlinks. A link to a directory inside the workspace is rejected just like a link outside it.

The reader checks path/file identity before opening, verifies the opened handle, reads no more than the initial size plus a single growth-detection byte, then rechecks the handle and path. File device/inode, mode, link count, size and modification/change timestamps must remain consistent; ancestor directory identities must remain consistent. Descriptors and their metadata are snapshotted before asynchronous work. Observed hashes and sizes always replace caller-provided values.

All I/O resource limits must be non-negative safe integers. `NaN`, infinities, negatives, fractions, strings and null cannot disable limits. Zero is meaningful: a zero-byte budget permits only an empty file. Both per-file and remaining aggregate budgets are checked before allocating a file buffer. Returned file descriptors are sorted and frozen.

Manifest decoding uses fatal UTF-8 decoding before JSON parsing. Invalid encodings cannot silently become replacement characters; a legitimately encoded replacement character remains ordinary data. Leading BOM and invalid JSON remain rejected. Binary projection outputs are hashed as raw bytes and are not required to contain UTF-8.

## Explicit limitations

Use an access-controlled, quiescent checkout or immutable build snapshot. This portable Node implementation is not an `openat`/directory-descriptor sandbox and cannot guarantee isolation from a hostile process continuously swapping ancestor paths or mounting filesystems. `O_NOFOLLOW` protects the leaf where available; before/after ancestor checks detect ordinary changes but do not eliminate all time-of-check/time-of-use races. Files can change after an observation returns. Publication must consume the same protected snapshot rather than reopen mutable paths under an old receipt.

The functions hash the explicit descriptor inventory. They do not discover unlisted outputs, prove toolchain execution, authenticate approvals, or verify the complete transitive source graph. A trusted caller must supply the required inventory and policy evidence; the projection verifier checks their bindings separately. JSON duplicate-key policy and numeric precision are outside this I/O slice.

## Tests

`test/unit/projection-safe-file.test.mjs` exercises real filesystem reads, leaf/parent/root symlinks, outside-root links, hard links, exact/zero/aggregate limits, malformed limits, strict UTF-8, unchanged file bytes, immutable descriptor snapshots, unsafe/duplicate identities and deterministic raw-byte hashes. The existing projection-manifest tests continue to exercise public verification behavior.
