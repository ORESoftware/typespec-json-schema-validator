# Behavioral contracts

TJSV treats structure and behavior as separate contract dimensions.

- Independently authored TypeSpec remains a structural authority.
- Independently authored JSON Schema Draft 2020-12 remains a structural authority.
- Generated JSON Schema remains comparison evidence only.
- OpenAPI, Protobuf/gRPC, WIT, SQL, ORM and client artifacts remain downstream projections unless a consumer explicitly establishes another reviewed authority lane.
- `behavior-contract/v1` is an independently authored **behavioral** authority bound to stable operation IDs. It does not outrank or rewrite either structural authority.

This split avoids turning TypeSpec or JSON Schema into programming languages while still making preconditions, postconditions, invariants and implementation intent machine-readable.

## Contract shape

```json
{
  "schema": "ores.typespec-json-schema-validator.behavior-contract/v1",
  "authority": "independently-authored-behavioral-authority",
  "operations": [
    {
      "operationId": "calculate_discount",
      "kind": "expression",
      "language": "cel",
      "executable": true,
      "inputs": [
        { "name": "age", "type": "int32", "required": true },
        { "name": "loyalty_years", "type": "int32", "required": true }
      ],
      "output": { "type": "float32", "nullable": false },
      "requires": ["age >= 0", "loyalty_years >= 0"],
      "ensures": ["result >= 0.0", "result <= 1.0"],
      "invariants": [],
      "expression": "age >= 65 ? 0.20 : loyalty_years > 5 ? 0.10 : 0.0",
      "algorithm": null,
      "effects": [],
      "errors": [],
      "deterministic": true,
      "idempotent": true,
      "pure": true
    }
  ]
}
```

The runtime normalizer is intentionally stricter than free-form documentation. Unexpected keys fail closed; operation IDs and input/error identifiers cannot silently duplicate; expression-like behavior requires an expression; algorithm/procedure/state-machine behavior requires an algorithm; pseudocode cannot claim to be executable; and pure behavior cannot declare effects.

## Languages

`cel` is the preferred portable expression language for deterministic predicates, transforms and calculations. `cue` is appropriate for constraint-oriented behavior, `rego` for policy/authorization, and `dafny` for correctness-critical algorithms and pre/postcondition verification. `pseudocode` is a review-only fallback and must set `executable: false`. `none` records an intentionally external implementation without pretending to specify a body.

## Adapters

The canonical behavior payload deliberately excludes transport syntax. Adapters may carry the same normalized payload through:

- TypeSpec custom decorators, such as an ORES `@behavior(...)` decorator;
- OpenAPI `x-ores-behavior` operation extensions;
- Protobuf custom method options;
- generated runtime test vectors for Rust, Dart, TypeScript, Go and other implementations.

`normalizeEmbeddedBehavior()` validates this adapter payload. `normalizeBehaviorContract()` validates the independently authored operation-indexed authority. `behaviorContractDigest()` provides a deterministic digest for projection receipts and runtime evidence.

## Parity rule

Behavioral parity is not ordinary schema equality. A promotion gate should prove, at minimum:

1. every behavior `operationId` resolves to a structural operation;
2. parameter names/types and result types agree with the admitted structural contract;
3. each transport projection preserves the operation-to-behavior binding;
4. executable CEL/CUE/Rego behavior is evaluated against shared fixtures where applicable;
5. each runtime implementation produces results compatible with the behavioral contract;
6. changed Dafny/pseudocode/opaque algorithms require explicit review evidence rather than being assumed equivalent.

This lets TJSV evolve from structural parity into semantic parity without making generated artifacts editable authorities.
