# Cross-runtime validator evidence

This module admits evidence produced by runtime validators such as Zod in TypeScript, Serde-backed validation in Rust, and generated Dart/Freezed validation. It does **not** treat those libraries as contract authorities, and it does not execute arbitrary adapter commands.

The authority and evidence chain is:

```text
independently authored TypeSpec ----.
                                     +--> parity receipt --> verified Contract IR
independently authored JSON Schema -'                          |
                                                                v
trusted generated-validator closure + recorded corpus --> adapter jobs
                                                                |
                               compact IR/receipt binding + verdicts
                                                                |
                                                                v
                                               compareRuntimeEvidence()
```

The generated TypeSpec JSON Schema remains comparison evidence only. The verified Contract IR is downstream-derived and immutable; it is not a third editable authority.

## Admission requirements

A runtime-conformance report passes only when all of the following hold:

- the caller supplies the actual parity-approved Contract IR;
- the caller supplies a current `verifyContractIr()` result whose supplied, computed, and expected IR IDs all match;
- the Contract IR canonical self-digest matches `irId`;
- the IR is admissible and its parity receipt passed with zero unexplained findings;
- the evidence names that exact `irId`, parity receipt `runId`, and canonical receipt digest;
- `inputDigest` matches the exact generated-validator, adapter configuration, and toolchain closure;
- `corpusDigest` matches the exact trusted recorded corpus;
- every required adapter is present with the expected language and validator identity;
- every adapter reports `status: "passed"`;
- every expected case is present exactly once, bound to the expected declaration, and has the trusted verdict; and
- independently executed adapters do not disagree.

Missing, stale, malformed, skipped, unsupported, errored, duplicated, tampered, or divergent evidence returns `stopped_for_evaluation`. A validator process crash is **not** equivalent to a schema rejection.

## Evidence format

The adapter receipt is defined by `schema/runtime-evidence.schema.json`. It contains a compact binding rather than a copy of the full Contract IR:

```json
{
  "schema": "ores.typespec-json-schema-validator.runtime-evidence/v1",
  "contractIr": {
    "schema": "ores.typespec-json-schema-validator.contract-ir/v1",
    "irId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "parityReceipt": {
      "runId": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "digest": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    }
  },
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

Raw payloads, stdout, stderr, environment values, stack traces, remote URLs, and credentials are intentionally outside the receipt format.

## Verify and compare

Recompute Contract IR verification from the current checkout. Do not trust a copied green verification JSON document supplied by an adapter.

```js
import {
  verifyContractIr,
} from '@oresoftware/typespec-json-schema-validator';
import {
  compareRuntimeEvidence,
  createRuntimeEvidenceContractBinding,
  loadRuntimeEvidence,
} from '@oresoftware/typespec-json-schema-validator/runtime-conformance';

const contractIrVerification = await verifyContractIr({
  contractIr,
  report: parityReceipt,
  typespec: 'contracts/main.tsp',
  generatedSchema: '.typespec-json-schema-validator/generated',
  authoredSchema: 'contracts/authored.schema.json',
});

const binding = createRuntimeEvidenceContractBinding({
  contractIr,
  contractIrVerification,
});
// Pass `binding` to the isolated adapter jobs; they must return it unchanged.

const evidence = await loadRuntimeEvidence('./artifacts/runtime-evidence.json');
const report = compareRuntimeEvidence({
  evidence,
  contractIr,
  contractIrVerification,
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

The deterministic decision uses schema `ores.typespec-json-schema-validator.runtime-conformance-report/v1`, published at `schema/runtime-conformance-report.schema.json`. It records the admitted Contract IR ID, parity receipt run ID and digest, normalized evidence digest, trusted case digest, finding count, truncation state, and adapter summary.

## Safety and boundedness

`loadRuntimeEvidence()` accepts only regular, non-symbolic-link files and applies an 8 MiB default limit. The normalizer processes at most 64 adapters and 100,000 results per adapter by default. Unknown properties are discarded by the JavaScript API and rejected by the JSON Schema, so untrusted adapter logs cannot leak into deterministic reports.

These functions validate and compare evidence only. Separate sandboxed language-specific runners still need to compile generated validators, execute the corpus, and emit the minimal receipt. Their commands, filesystem permissions, network policy, CPU/memory limits, and toolchain pins remain explicit CI responsibilities.
