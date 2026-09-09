# Protobuf projection compatibility

`@oresoftware/typespec-json-schema-validator/protobuf-compatibility` adds a fail-closed compatibility gate for **generated Protobuf evidence from the TypeSpec lane**.

This does not create a third contract authority. The architecture remains:

```text
human-authored TypeSpec -----------------> generated Protobuf/gRPC evidence
       |                                             |
       |                                             v
       +---- TJSV peer-authority parity ----> compatibility receipt
       |
human-authored JSON Schema/OpenAPI ------> independent JSON/HTTP lane
```

The normalized Protobuf projection, its baseline, and the compatibility receipt are downstream evidence. They may never overwrite the human-authored TypeSpec or JSON Schema/OpenAPI sources. WIT remains an optional generated execution projection and is not promoted to an authored authority by this gate.

## Projection contract

The machine-readable input schema is exported as:

```text
@oresoftware/typespec-json-schema-validator/schema/protobuf-projection
```

A projection has this shape:

```json
{
  "schema": "ores.typespec-json-schema-validator.protobuf-projection/v1",
  "syntax": "proto3",
  "package": "ores.accounts.v1",
  "messages": [
    {
      "name": "Account",
      "fields": [
        {
          "name": "id",
          "number": 1,
          "type": "string",
          "cardinality": "singular",
          "presence": "implicit",
          "oneof": null,
          "jsonName": "id"
        }
      ],
      "reservedNumbers": [9],
      "reservedNames": ["legacy_id"]
    }
  ],
  "enums": [],
  "services": []
}
```

The runtime normalizer additionally enforces invariants that JSON Schema cannot express cleanly, including unique field names/numbers, unique enum names/numbers, active-vs-reserved conflicts, the Protobuf field-number reserved range `19000..19999`, and deterministic ordering.

## Breaking-change rules

The gate stops evaluation for unexplained changes to:

- package identity;
- message, enum, service, or RPC method removal;
- field number reuse or renumbering;
- field type, cardinality, presence, `oneof`, or JSON name;
- reuse of baseline-reserved field names/numbers;
- enum renumbering or reuse of baseline-reserved enum names/numbers;
- RPC input/output types;
- client/server streaming semantics; or
- the declared RPC error model.

Removing a field or enum value requires the current projection to reserve **both** its previous number and its previous name. This prevents accidental reuse while retaining explicit evidence of the removal.

Additive messages, fields with fresh numbers/names, enum values with fresh numbers/names, services, and RPC methods are accepted by this compatibility gate. Peer-authority, runtime, generated-client, and behavioral gates can still reject an additive change for other semantic reasons.

## Library API

```js
import {
  createProtobufCompatibilityReceipt,
} from '@oresoftware/typespec-json-schema-validator/protobuf-compatibility';

const receipt = createProtobufCompatibilityReceipt({
  baseline,
  current,
  maxFindings: 250,
});

if (receipt.status !== 'passed') {
  throw new Error(`protobuf promotion blocked: ${receipt.status}`);
}
```

Receipts use schema `ores.typespec-json-schema-validator.protobuf-compatibility-receipt/v1`. They bind normalized baseline/current SHA-256 digests, deterministic finding fingerprints, truncation state, and a self-digesting `verificationId`.

## GitHub Action

Pin the action to an exact TJSV commit:

```yaml
- name: Verify generated Protobuf compatibility
  uses: ORESoftware/typespec-json-schema-validator/actions/verify-protobuf@<40-character-commit>
  with:
    baseline: contracts/evidence/protobuf.baseline.json
    current: contracts/evidence/protobuf.current.json
    verification: artifacts/protobuf-compatibility.json
```

The action exits `0` on `passed`, `2` on `stopped_for_evaluation`, and `3` on execution/configuration failure. A failing run still writes its receipt before returning nonzero so CI retains the reason promotion was blocked.

The runner accepts only normalized relative POSIX paths beneath its configured root, rejects symlinked or multiply-linked input files, and the receipt writer refuses to replace symlinked, multiply-linked, or unrecognized evidence files.

## Promotion rule

A green Protobuf compatibility receipt is necessary evidence for a Protobuf/gRPC promotion but is not sufficient by itself. Promotion still requires the exact-head TypeSpec/JSON Schema peer-authority receipt, the applicable projection-admission receipt, generated client/runtime evidence, and any required descriptor/runtime conformance gates. An unexplained mismatch remains `STOPPED_FOR_EVALUATION`; no projection wins by fallback.
