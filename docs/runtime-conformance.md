# Cross-runtime validator evidence

This module admits evidence produced by runtime validators such as Zod in TypeScript, Serde-backed validation in Rust, and generated Dart/Freezed validation. It does **not** treat those libraries as new contract authorities and it does not execute arbitrary adapter commands.

The authority graph remains:

```text
independently authored TypeSpec ----.
                                     +-- exact input closure digest
independently authored JSON Schema -'              |
                                                    v
trusted recorded instance corpus --------> runtime adapter jobs
                                                    |
                       whitelisted verdict evidence only
                                                    |
                                                    v
                                      compareRuntimeEvidence()
```

The adapter evidence is a downstream execution receipt. A pass requires all of the following:

- the evidence is bound to the exact authority/configuration closure by `inputDigest`;
- the evidence is bound to the exact recorded corpus by `corpusDigest`;
- every required adapter is present with the expected language and validator identity;
- every adapter reports `status: "passed"`;
- every expected case is present exactly once;
- no unknown case is reported;
- declaration identities match;
- each verdict matches the trusted corpus expectation; and
- independently executed adapters do not disagree.

Missing, stale, malformed, skipped, unsupported, errored, duplicated, or divergent evidence returns `stopped_for_evaluation`. A validator process crash is **not** equivalent to a schema rejection.

## Evidence format

The JSON format is defined by `schema/runtime-evidence.schema.json` and deliberately excludes raw payloads, stdout, stderr, environment values, stack traces, and credentials.

```json
{
  "schema": "ores.typespec-json-schema-validator.runtime-evidence/v1",
  "inputDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "corpusDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "adapters": [
    {
      "id": "typescript-zod",
      "language": "typescript",
      "runtime": "node@22.16.0",
      "validator": "zod@4.5.4",
      "toolchain": "typescript@7.0.2",
      "status": "passed",
      "results": [
        {
          "caseId": "user.valid.basic",
          "declaration": "Accounts.User",
          "verdict": "accepted"
        },
        {
          "caseId": "user.invalid.missing-id",
          "declaration": "Accounts.User",
          "verdict": "rejected"
        }
      ]
    }
  ]
}
```

The trusted caller supplies expectations separately. Adapter-authored `expected` fields are intentionally not accepted because an adapter must not grade its own output.

```js
import {
  compareRuntimeEvidence,
  loadRuntimeEvidence,
} from '@oresoftware/typespec-json-schema-validator/runtime-conformance';

const evidence = await loadRuntimeEvidence('./artifacts/runtime-evidence.json');
const report = compareRuntimeEvidence({
  evidence,
  expectedInputDigest,
  expectedCorpusDigest,
  expectedCases: [
    {
      id: 'user.valid.basic',
      declaration: 'Accounts.User',
      expectation: 'accepted',
    },
  ],
  requiredAdapters: [
    { id: 'typescript-zod', language: 'typescript', validator: 'zod@4.5.4' },
    { id: 'rust-serde', language: 'rust', validator: 'serde@1' },
    { id: 'dart-freezed', language: 'dart', validator: 'freezed@3' },
  ],
});

if (report.status !== 'passed') {
  process.exitCode = 2;
}
```

## Safety and boundedness

`loadRuntimeEvidence()` accepts only regular, non-symbolic-link files and applies an 8 MiB default limit. The normalizer processes at most 64 adapters and 100,000 results per adapter by default. Unknown object properties are discarded by the JavaScript API and rejected by the JSON Schema, so untrusted adapter logs cannot leak into deterministic reports.

These functions validate and compare evidence only. Separate, sandboxed language-specific runners still need to compile generated validators, run the corpus, and emit the minimal receipt. Their commands, filesystem permissions, network policy, and resource limits remain explicit CI responsibilities.
