# Consumer admission filesystem boundaries

Tracking: DEN-3828; issue #20; PR #56. These are additional protections for the internal `actions/test-consumer-admission` entrypoint. They do not change the public CLI parser or the versioned verification receipt format.

## Failure evidence must not become a source write

All five nominated input paths are snapshotted before output side effects. Output must be independent of each input: it cannot equal an input, be beneath a directory input, or contain an input. Read-only preflight checks both normalized lexical paths and paths resolved through their existing ancestors, before creating any output parent. Explicit input roles outrank file contents: even a valid validator receipt cannot be replaced when that same file is nominated as an input.

Only after preflight establishes an independent destination may a failed invocation replace old validator-owned verification evidence with a failed receipt. This includes unexpected arguments, malformed or missing evidence, invalid scope, and failed admission. Unsafe path configuration instead fails without writing through those paths. An old file left untouched because writing there is unsafe is never current success: callers must require this invocation's successful exit and fresh evidence, not inspect an old `passed` flag. The canonical safe writer still refuses foreign bytes, symlinks, directories, multiply-linked outputs, and changed target identity.

## Tests

The process-level integration suite compiles a real TypeSpec authority, then exercises corruption and recovery against the canonical verifier. It checks both passed and failed receipt digests, exact output/exit behavior, source preservation, input/output aliases, directory containment, symlink/hard-link destinations, caller-owned files, and safe nested output. Restoring the exact original inputs must reproduce the exact original successful receipt. All scratch state is unique test-owned storage under `tmp/`; cleanup never touches a checkout or user file.

Dependency-free unit tests cover POSIX and Windows path-component behavior plus real link/ancestor preflight. Windows path tests do not claim a Windows-hosted compiler run. Filesystem preflight and inode rechecks do not establish atomic directory custody against concurrent hostile filesystem mutation; isolated CI workspaces remain required. These tests do not certify unrelated runtime implementations, SQL/ORM behavior, or universal schema equivalence.
