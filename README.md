# TypeSpec ↔ JSON Schema validator

`@oresoftware/typespec-json-schema-validator` is a fail-closed linter for two independently authored contract authorities:

- TypeSpec source; and
- JSON Schema Draft 2020-12 source.

Neither authority is generated from, ranked below, or silently replaced by the other. The tool does generate a JSON Schema witness from TypeSpec with the official `@typespec/json-schema` emitter, but that witness is comparison evidence only. Any unexplained difference produces `stopped_for_evaluation` and a non-zero exit code.

## What it checks

A `check` run performs four independent gates:

1. A source-level TypeSpec inventory discovers top-level models, enums, unions, scalars, and aliases without treating comments, strings, or nested model bodies as declarations.
2. The official TypeSpec JSON Schema emitter produces a dedicated, immutable comparison witness.
3. Both JSON Schema lanes are structurally checked as Draft 2020-12 documents, including local references, required properties, enum uniqueness, cardinalities, and invalid OpenAPI-only `nullable` usage.
4. The generated and authored declaration sets and normalized declaration bodies are compared recursively.

The semantic comparison covers declaration names and kind families, required/optional properties, nullability, scalar types and formats, constraints, enums, unions/composition, references, defaults and annotations, and additional/unevaluated-property policy.

## Install

```bash
npm install --save-dev @oresoftware/typespec-json-schema-validator
```

The package pins compatible versions of `@typespec/compiler`, `@typespec/json-schema`, and the canonical `@oresoftware/f2e` CLI parser. Node.js 22.9 or newer is required.

## Usage

```bash
npx tsjsv check \
  --typespec=./contracts/main.tsp \
  --schema=./contracts/authored.schema.json \
  --report=./artifacts/schema-parity.json
```

The command generates its witness under `.typespec-json-schema-validator/generated/` by default. That path is deliberately separate from both authored authorities.

Compare an already generated witness:

```bash
npx tsjsv compare \
  --typespec=./contracts/main.tsp \
  --generated-schema=./artifacts/typespec.generated.schema.json \
  --schema=./contracts/authored.schema.json
```

Inspect TypeSpec declarations without invoking the emitter:

```bash
npx tsjsv inventory --typespec=./contracts/main.tsp
```

Inspect the installed compiler and emitter:

```bash
npx tsjsv doctor
```

All flags and defaults are declared in the repository-root `.cli-flags.toml` contract and parsed through `flags-2-env`; there is no second ad hoc flag parser.

## Exit codes

| Code | Status | Meaning |
| ---: | --- | --- |
| `0` | `passed` | Both direct declaration inventory and generated-schema evidence converge. |
| `2` | `stopped_for_evaluation` | One or more unexplained semantic or structural discrepancies exist. |
| `3` | `failed` | The compiler, configuration, file IO, or validator execution failed. |

## Deterministic receipts

Every comparison writes `ores.typespec-json-schema-validator.report/v1`. Receipts contain input digests, exact comparison settings, declaration mappings, coverage, stable finding fingerprints, toolchain evidence, and no wall-clock timestamp. Repeating a run with the same inputs and toolchain yields the same `runId` and finding order.

Generated receipts are evidence. They do not authorize either source to overwrite the other.

## Declaration identity and mappings

By default, a TypeSpec declaration's simple name must equal the `$defs` key in both JSON Schema lanes. If namespaces or legacy names require an explicit bridge, pass a mapping file:

```json
{
  "schema": "ores.typespec-json-schema-validator.mapping/v1",
  "declarations": [
    {
      "typespec": "Accounts.User",
      "generated": "User",
      "authored": "AccountUser"
    }
  ],
  "ignore": {
    "typespec": [],
    "generated": [],
    "authored": []
  }
}
```

Ignored declarations are explicit policy and are included in the configuration evidence. Ambiguous simple names stop evaluation unless a mapping resolves them.

## CI

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm
- run: npm ci
- run: npx tsjsv check --typespec=contracts/main.tsp --schema=contracts/authored.schema.json --quiet
```

The repository's own CI also runs positive and negative compiler-backed integration fixtures. The negative fixture must exit `2`; accepting drift is a test failure.

## Scope boundary

JSON Schema represents data shapes, not TypeSpec operations. Interfaces, operations, decorators, functions, and constants are reported in `coverage.outOfScopeTypeSpecDeclarations`; they are not silently counted as data declarations. Imported local `.tsp` files are followed. Package imports under `node_modules` remain compiler-owned and are not treated as authored declarations in the current repository.

See [architecture](docs/architecture.md), [rule catalog](docs/rules.md), and [fleet rollout](docs/rollout.md).
