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

`ORESoftware/ores-wit` should own raw `.wit` parsing, canonical formatting, projection emission, component-model toolchain discovery, binding generation, and cross-language fixtures. This package owns the fail-closed evidence contract and baseline compatibility decision.

## Normalized projection

The normalized representation is intentionally syntax-independent. Named WIT types carry a canonical `shape` string produced by the WIT tooling. A change to an existing type shape is treated as breaking; this includes adding/removing enum or variant cases.

Compatibility is directional. In `consumer` mode, callers/hosts are protected: removing exports/functions or adding host imports is breaking, while additive exports/functions are allowed. In `provider` mode, implementers/guests are protected: adding required exports/functions or removing imports they may consume is breaking. `strict` mode applies both directions and also rejects newly added interfaces, named types, and worlds. Signature/target changes are breaking in every mode.

Package release versions are not themselves treated as structural breakage: `ores:example@1.0.0` and `ores:example@1.1.0` have the same package identity. Changing the namespace/name identity is breaking. Version policy and semver correctness remain separate release-policy concerns.

## CLI

```bash
tjsv verify-wit \
  --baseline=contracts/wit/baseline.json \
  --current=artifacts/wit/current.json \
  --mode=consumer \
  --verification=artifacts/wit-compatibility.json
```

Use `--mode=consumer` for callers/hosts, `--mode=provider` for implementers/guests, and `--mode=strict` for conservative fleet promotion where either direction must remain compatible.

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
