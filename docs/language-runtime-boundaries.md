# Language and runtime boundary admission

`verifyLanguageBoundaries` admits generated clients and runtime adapters only after the source contract has already passed TJSV peer-authority validation.

The source boundary remains:

- independently authored TypeSpec is a peer authority;
- independently authored JSON Schema Draft 2020-12 is a peer authority;
- TypeSpec-generated JSON Schema is comparison evidence only;
- Contract IR is a digest-bound downstream artifact, never an editable authority.

A boundary manifest names every required language/runtime pair and whether ingress and egress behavior must be demonstrated. Required targets count toward `minimumDistinctLanguages`; optional targets do not, but supplied optional evidence is still validated.

Each evidence document is bound to:

- an immutable source revision;
- an exact generated artifact SHA-256 digest;
- a concrete language and runtime;
- generator and toolchain identities;
- passed ingress and egress validation;
- the exact TJSV parity receipt run ID;
- the exact admissible Contract IR ID.

Missing evidence, stale binding, symbolic source labels, uppercase or malformed digests, duplicate target identities, path reuse, sparse arrays, inherited object properties, disabled required directions, and non-passing validation all stop evaluation. Findings contain stable rule IDs and target indexes, not source payloads or exception text.

The verifier is intentionally admission logic rather than a generator. Rust, TypeScript/Node.js, Dart/Flutter, Go, Gleam/BEAM, and additional adapters remain responsible for producing native evidence from their own test suites. The returned receipt is deterministic and self-digesting, so downstream release automation can bind the exact decision without promoting generated files into source authority.
