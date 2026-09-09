# Five-runtime boundary salvage test scope

`test/unit/language-boundary-five-runtime-example.test.mjs` is a current-main regression suite derived from the useful unique example intent in historical PR #77.

It verifies:

- the five-language manifest against TJSV's published Draft 2020-12 manifest schema;
- all five required language/runtime identities admitted with exact peer-authority parity and Contract IR bindings;
- fail-closed source-revision drift across runtime receipts;
- fail-closed missing required runtime evidence;
- rejection of symbolic source revisions.

This suite does not emulate or claim execution of Rust, TypeScript/Node.js, Dart/Flutter, Go, or Gleam/BEAM toolchains. Native runtime execution remains an external evidence requirement.
