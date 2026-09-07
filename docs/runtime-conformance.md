# Cross-runtime validator evidence

This module admits evidence produced by runtime validators such as Zod in TypeScript, Serde-backed validation in Rust, and generated Dart/Freezed validation. Runtime libraries and their receipts are downstream execution evidence only. They are not editable contract authorities, and this module does not execute arbitrary adapter commands.

The admission chain is:

```text
independently authored TypeSpec ---------.
                                           +-- parity receipt -- verified Contract IR
independently authored JSON Schema A ----'                         |
TypeSpec-emitted JSON Schema B (witness only) ---------------------'
                                                                  |
trusted recorded instance corpus ---------------------.           |
                                                       v           v
                                                runtime adapter jobs
                                                       |
                                contractIrId + receipt runId + corpus digest
                                                       |
                                                       v
                                          compareRuntimeEvidence()
```

A runtime pass requires all of the following:

- the supplied Contract IR is self-digest-valid, passed, non-editable, and admissible;
- its authority roles still identify TypeSpec and JSON Schema as independent peers and generated JSON Schema as comparison evidence only;
- its retained parity receipt and all three source-lane provenance digests are present;
- a fresh `verifyContractIr()` or `verifyContractIrEvidence()` result proves the IR against the retained receipt and current checked-out source inputs;
- adapter evidence names the exact verified `contractIrId`;
- adapter evidence `inputDigest` equals the exact parity receipt `runId` for the authority, configuration, and toolchain closure;
- adapter evidence is bound to the exact recorded corpus by `corpusDigest`;
- every trusted case targets a declaration admitted by Contract IR;
- every required adapter is present with the expected language and validator identity;
- every adapter reports `status: "passed"`;
- every expected case is present exactly once and no unknown case is reported;
- declaration identities and trusted accepted/rejected expectations match; and
- independently executed adapters do not disagree.

Missing, stale, tampered, malformed, skipped, unsupported, errored, duplicated, or divergent evidence returns `stopped_for_evaluation`. A validator process crash is **not** equivalent to a schema rejection. A copied `status: "passed"`, copied IR id, or copied receipt run id is never sufficient.

## Evidence format

The JSON format is defined by `schema/runtime-evidence.schema.json`. It deliberately excludes raw payloads, stdout, stderr, environment values, stack traces, credentials, and adapter-authored expectations.

```json
{
  "schema": "ores.typespec-json-schema-validator.runtime-evidence/v1",
  "contractIrId": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
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

`inputDigest` is the exact `runId` from the passed parity receipt embedded in the verified Contract IR. It is not a free-form repository hash. `contractIrId` is the Contract IR self-digest. Both are required so adapters cannot replay evidence from a different parity run or a different IR with the same broad source label.

The trusted caller supplies case expectations separately. Adapter-authored `expected` fields are intentionally rejected by the JSON Schema because an adapter must not grade its own output.

## Required verification sequence

Verify the Contract IR over the current checkout immediately before admitting runtime evidence:

```js
import {
  verifyContractIr,
} from '@oresoftware/typespec-json-schema-validator';
import {
  compareRuntimeEvidence,
  loadRuntimeEvidence,
} from '@oresoftware/typespec-json-schema-validator/runtime-conformance';

const parityReport = JSON.parse(await readFile('./artifacts/parity-report.json', 'utf8'));
const contractIr = JSON.parse(await readFile('./artifacts/contract-ir.json', 'utf8'));
const runtimeEvidence = await loadRuntimeEvidence('./artifacts/runtime-evidence.json');

const contractIrVerification = await verifyContractIr({
  contractIr,
  report: parityReport,
  typespec: './idl/typespec/main.tsp',
  generatedSchema: './artifacts/generated-json-schema',
  authoredSchema: './json-schema',
});

const report = compareRuntimeEvidence({
  evidence: runtimeEvidence,
  contractIr,
  contractIrVerification,
  expectedInputDigest: parityReport.runId,
  expectedCorpusDigest,
  expectedCases: [
    {
      id: 'user.valid.basic',
      declaration: 'Accounts.User',
      expectation: 'accepted',
    },
    {
      id: 'user.invalid.missing-id',
      declaration: 'Accounts.User',
      expectation: 'rejected',
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

Do not persist and reuse a prior verification result after changing the receipt, TypeSpec input closure, generated Schema B, authored Schema A, mapping/configuration, or toolchain. `verifyContractIr()` recomputes the expected IR from those current inputs; runtime admission checks that its supplied, computed, and expected IR ids all match.

## Corpus boundary

`expectedCases` is trusted test metadata, not a third schema authority. Every case declaration must exist in `contractIr.declarations`; excluded and out-of-scope declarations cannot receive a green runtime receipt. The separately supplied `expectedCorpusDigest` must be produced by the trusted corpus loader over the exact recorded fixtures used by every adapter.

A finite corpus provides bounded behavioral evidence only. It does not prove universal semantic equivalence and cannot waive an unexplained structural discrepancy from the TypeSpec/JSON Schema parity gate.

## Safety and boundedness

`loadRuntimeEvidence()` accepts only regular, non-symbolic-link files and applies an 8 MiB default limit. The normalizer processes at most 64 adapters and 100,000 results per adapter by default. Unknown evidence properties are discarded by the JavaScript API and rejected by the JSON Schema, so untrusted adapter logs cannot leak into deterministic reports.

Contract IR validation reports safe identifiers, digests, booleans, and bounded status metadata rather than serializing arbitrary Contract IR content into findings. Raw schema values and instance payloads remain outside runtime evidence and its deterministic report.

These functions validate and compare evidence only. Separate sandboxed language-specific runners still need to compile generated validators, execute the corpus, and emit the minimal receipt. Their commands, filesystem permissions, network policy, CPU/memory/time limits, immutable toolchain versions, and artifact retention remain explicit CI responsibilities.
