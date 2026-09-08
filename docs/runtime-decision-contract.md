# Runtime evidence and decision contracts

Runtime adapter evidence and the trusted admission decision are different protocol objects and use different schema identifiers.

| Object | Schema | Producer | Authority role |
|---|---|---|---|
| Adapter evidence envelope | `ores.typespec-json-schema-validator.runtime-evidence/v1` | Isolated language/runtime jobs | Non-authoritative execution evidence |
| Runtime conformance report | `ores.typespec-json-schema-validator.runtime-conformance-report/v1` | Trusted admission process | Derived fail-closed decision |

Neither object is an editable contract authority. Independently authored TypeSpec and independently authored JSON Schema remain peer authorities. TypeSpec-emitted JSON Schema B, the parity receipt, Contract IR, adapter receipts, and the final decision are downstream evidence.

## Minimal adapter binding

An isolated adapter job needs only two values from the trusted parity boundary:

```json
{
  "contractIrId": "<Contract IR self-digest>",
  "inputDigest": "<exact parity receipt runId>"
}
```

The full Contract IR, parity report, source paths, schemas, mappings, and verifier diagnostics should remain in the trusted admission job.

Use the preferred current-input helper before dispatching adapters:

```js
import {
  createRuntimeEvidenceBindingAgainstCurrentInputs,
} from '@oresoftware/typespec-json-schema-validator/runtime-conformance';

const binding = await createRuntimeEvidenceBindingAgainstCurrentInputs({
  contractIr,
  parityReport,
  typespec: './idl/typespec/main.tsp',
  generatedSchema: './artifacts/generated-json-schema',
  authoredSchema: './json-schema',
});
```

This helper invokes Contract IR verification over the current checkout before returning the binding. It throws when the IR, receipt, or any current source lane is missing, stale, malformed, or non-admissible. Its failure text contains stable rule identifiers only; it does not copy source content or internal verifier error strings into logs.

A trusted orchestrator that has already performed an exact current-input verification may use the lower-level helper:

```js
import {
  createRuntimeEvidenceContractBinding,
} from '@oresoftware/typespec-json-schema-validator/runtime-conformance';

const binding = createRuntimeEvidenceContractBinding({
  contractIr,
  contractIrVerification,
});
```

Do not persist either helper's output as proof of current parity after the source closure, configuration, mapping, toolchain, receipt, or IR changes. The binding exists to tie one bounded adapter run to one admitted parity state.

## Evidence envelope

Each adapter copies the exact binding and adds the corpus digest plus minimal verdict metadata:

```json
{
  "schema": "ores.typespec-json-schema-validator.runtime-evidence/v1",
  "contractIrId": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "inputDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "corpusDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "adapters": [
    {
      "id": "rust-serde",
      "language": "rust",
      "runtime": "rust@1.98.0",
      "validator": "serde@1",
      "toolchain": "cargo@1.98.0",
      "status": "passed",
      "results": [
        {
          "caseId": "user.valid.basic",
          "declaration": "Accounts.User",
          "verdict": "accepted"
        }
      ]
    }
  ]
}
```

Raw instances, stdout, stderr, stack traces, environment values, credentials, and adapter-authored expectations are intentionally excluded.

## Admission decision

`compareRuntimeEvidence()` and `verifyRuntimeEvidenceAgainstCurrentInputs()` return a report using the dedicated decision schema:

```json
{
  "schema": "ores.typespec-json-schema-validator.runtime-conformance-report/v1",
  "status": "passed",
  "zeroUnexplainedFindings": true,
  "findings": [],
  "findingCount": 0,
  "truncated": false,
  "contractIrId": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "contractIrVerified": true,
  "receiptRunId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "receiptDigest": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "evidenceDigest": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "expectedCaseDigest": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "summary": {
    "expectedCases": 1,
    "requiredAdapters": 1,
    "observedAdapters": 1,
    "passedAdapters": 1
  }
}
```

`receiptDigest` is populated only when the Contract IR was freshly verified. A stopped decision uses `null` rather than carrying forward a digest from an unverified or stale IR.

The schemas are published as package exports:

```js
import runtimeEvidenceSchema from '@oresoftware/typespec-json-schema-validator/schema/runtime-evidence' with { type: 'json' };
import runtimeDecisionSchema from '@oresoftware/typespec-json-schema-validator/schema/runtime-conformance-report' with { type: 'json' };
```

## Promotion rule

A downstream projection or deployment may consume a runtime report only when:

- `schema` is the decision schema, not the evidence schema;
- `status` is `passed`;
- `zeroUnexplainedFindings` is `true`;
- `contractIrVerified` is `true`;
- `contractIrId`, `receiptRunId`, and `receiptDigest` match retained parity evidence; and
- the evidence and expected-case digests match the reviewed run.

A copied green status string or copied digest is not sufficient. Consumers must retain and verify the complete decision object and its upstream evidence chain.
