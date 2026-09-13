# TypeSpec behavioral metadata

The npm package is also a TypeSpec library. Consumers can import it directly:

```typespec
import "@oresoftware/typespec-json-schema-validator";
using Ores.Behavior;
```

`@behavior` attaches a structurally typed `behavior-contract/v1` payload to an operation. `@behaviorRef` binds an operation to a separately authored behavioral authority by stable operation ID.

```typespec
@behavior(#{
  kind: "predicate",
  language: "cel",
  executable: true,
  inputs: #[#{ name: "age", type: "int32", required: true }],
  output: #{ type: "boolean", nullable: false },
  requires: #["age >= 0"],
  ensures: #[],
  invariants: #[],
  expression: "age >= 65",
  algorithm: null,
  effects: #[],
  errors: #[],
  deterministic: true,
  idempotent: true,
  pure: true
})
@behaviorRef("eligible_for_discount")
op eligible_for_discount(age: int32): boolean;
```

The TypeSpec compiler checks the payload's field names and structural types. TJSV's `normalizeEmbeddedBehavior()` remains the semantic gate for cross-field invariants such as `pure` requiring no effects and executable behavior forbidding the `pseudocode`/`none` languages.

Node-based emitters and admission tools can import `getTypeSpecBehavior()` and `getTypeSpecBehaviorRef()` from `@oresoftware/typespec-json-schema-validator/typespec-behavior` to read the exact metadata attached to a compiled operation.

OpenAPI emitters may project the normalized payload as `x-ores-behavior`. Protobuf projections should normally carry only the stable `behaviorRef` operation ID via a custom method option, avoiding duplicate CEL/CUE/Rego/Dafny source in `.proto` files.
