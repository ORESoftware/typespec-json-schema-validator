# WIT projection compatibility

WIT is a downstream execution/interface projection. It does **not** become a third structural authority beside the independently authored TypeSpec and JSON Schema sources.

The intended pipeline is:

```text
TypeSpec + authored JSON Schema
          |
          v
  parity + Contract IR
          |
          v
   ores-wit emitter/parser
          |
          v
normalized WIT projection JSON
          |
          v
tjsv verify-wit
          |
          v
digest-bound compatibility receipt
          |
          +--> wit-bindgen / component tooling / SDK language compilation
```

`ORESoftware/ores-wit` should own raw `.wit` parsing, canonical formatting, semantic projection emission, component-model toolchain discovery, syntax/toolchain verification receipts, binding generation, and cross-language fixtures. This package owns the normalized projection compatibility contract, released-baseline comparison, and WIT compatibility receipt. Those are distinct receipts and must not be conflated.

## Normalized projection

The normalized representation is intentionally syntax-independent. Named WIT types carry a canonical `shape` string produced from the parsed WIT semantic model, not from raw source text. A change to an existing type shape is treated as breaking; this includes adding/removing enum or variant cases. The producer must resolve `use`/`include`, resource methods, handles, gated features, current async function semantics, and active value types such as `map<K,V>` before producing the canonical shape so formatting-only source changes cannot affect compatibility evidence. Fully-qualified interface targets must use Component Model canonical interface names; non-canonical version suffix metadata belongs in the syntax/toolchain evidence rather than being mistaken for a structural target change. Resolved `use` items that are exported from an interface must be materialized in the normalized semantic type inventory even when no function references them. For world bindings of `kind = function`, `target` must be the deterministic semantic function signature (including async, parameter names/types, and result type), not merely the local function name.

WIT names are case-insensitively unique. Normalization therefore rejects names that differ only by case. Sorting uses deterministic code-point ordering rather than locale-sensitive collation.

Package identity and package version are handled using the Component Model canonical-version rules. Changing `namespace:package` is breaking. Stable `1.x.y` revisions share the `1` compatibility line, `0.2.x` revisions share `0.2`, and `0.0.x` patch releases are distinct; prereleases remain distinct. Structural comparison still decides whether changes inside one compatible version line are admissible.

WIT function parameters are always named and case-insensitively unique. The normalized function projection carries an explicit `async` boolean because sync↔async changes alter the component function type. A WIT function has at most one return type in the syntax; multiple logical values must be carried by a tuple or record. The normalized projection rejects representations that violate those invariants.

World exports are protected from removal or signature/target changes. New world imports are breaking because they add host requirements. Existing interface functions may not be removed or have their signatures changed. In `strict` mode, adding interface functions or exports to an existing world is also breaking because either can add a new provider obligation.

## CLI

```bash
tjsv verify-wit \
  --baseline=contracts/wit/baseline.json \
  --current=artifacts/wit/current.json \
  --mode=strict \
  --verification=artifacts/wit-compatibility.json
```

`strict` is the default and is the fleet/release mode. Use `--mode=consumer` only for an explicitly consumer-only SDK surface where an additive interface function is known not to impose a new implementation obligation.

The receipt is deterministic and self-digesting. A compatibility pass is necessary but not sufficient for promotion: the exact-head TypeSpec/JSON Schema parity receipt, Contract IR/projection admission, raw `.wit` formatting/validation, generated binding compilation, and cross-runtime fixtures must also pass.

## Fleet use

Every `*-clients` SDK generator should retain:

- the raw generated `.wit` package/world;
- the normalized WIT projection JSON;
- the previous released normalized projection as the compatibility baseline;
- the `verify-wit` receipt;
- generated binding compilation evidence for each supported language; and
- at least one cross-language round-trip fixture for the SDK's RPC/HTTP/component boundary.

The WIT lane complements OpenAPI/Protobuf/JSON Schema; it does not replace them.


## Generation context

TJSV deliberately does not parse raw WIT. The `ores-wit` syntax/toolchain receipt must bind the exact parser/emitter revision, Component Model/WASI feature level, selected world, target package version, enabled feature gates, source-tree digest, and Contract IR digest used to produce the normalized projection. Promotion must reject a compatibility receipt if that generation context is missing or does not belong to the same admitted source closure. This prevents a different target version or feature selection from looking like an ordinary API edit.
