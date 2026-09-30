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

`ORESoftware/ores-wit` owns raw `.wit` parsing/canonicalization, resolved WIT, normalized-projection emission, component-model toolchain discovery, binding generation and cross-language fixtures. This package owns the fail-closed normalized evidence contract and baseline compatibility decision.

## Normalized projection

The normalized representation is intentionally syntax-independent. Named WIT types carry a canonical `shape` string produced by WIT tooling. A change to an existing type kind or shape is treated as breaking; this includes record/variant/enum/flags/resource/handle/future/stream shape changes.

Package compatibility compares the package **identity** (`namespace:name`) separately from its optional `@version`. A version-only release bump such as `ores:example@1.0.0` → `ores:example@1.1.0` does not by itself make an otherwise identical interface incompatible. Changing `ores:example` to a different package identity does stop admission. Release/versioning policy may impose additional SemVer requirements separately; this compatibility gate does not infer semantic version intent from the version string.

World exports are protected from removal or signature/target changes. New world imports are breaking because they add host requirements. Existing interface functions may not be removed or have their signatures changed.

### Consumer vs strict mode

`consumer` mode is oriented toward consumers of an interface:

- additive interface functions are allowed;
- additive world exports are allowed;
- removals and changes to existing functions/types/exports are rejected; and
- newly required world imports are rejected.

`strict` mode is intended for implementers/providers that must satisfy the whole interface/world. It applies all consumer checks and additionally rejects additive interface functions and additive world exports.

## Bounded findings

Compatibility scans continue after the visible finding limit is reached. `breakingChangeCount` records the total number of detected breaking changes while `breakingChanges` is the bounded visible subset. When `truncated` is `true`, `breakingChangeCount` is therefore greater than `breakingChanges.length`; when `truncated` is `false`, they must be equal. This prevents a bounded diagnostic receipt from under-reporting the actual number of detected incompatibilities.

## CLI

```bash
tjsv verify-wit \
  --baseline=contracts/wit/baseline.json \
  --current=artifacts/wit/current.json \
  --mode=consumer \
  --verification=artifacts/wit-compatibility.json
```

Use `--mode=strict` for component/provider contracts where additive functions or exports must stop promotion.

The receipt is deterministic and self-digesting. A compatibility pass is necessary but not sufficient for promotion: the exact-head TypeSpec/JSON Schema parity receipt, Contract IR/projection admission, raw `.wit` formatting/validation, generated binding compilation, stale-generation checks, and cross-runtime fixtures must also pass.

## Fleet use

Every `*-clients` SDK generator should retain:

- the raw generated `.wit` package/world;
- the normalized WIT projection JSON;
- the previous released normalized projection as the compatibility baseline;
- the `verify-wit` receipt;
- generated binding compilation evidence for each supported language; and
- at least one cross-language round-trip fixture for the SDK's RPC/HTTP/component boundary.

Baselines are immutable release evidence. They must not be regenerated automatically merely because a compatibility check failed.

The WIT lane complements OpenAPI/Protobuf/JSON Schema; it does not replace them.
