# TypeSpec ↔ JSON Schema validator

`@oresoftware/typespec-json-schema-validator` is a fail-closed linter for two independently authored contract authorities:

- TypeSpec source; and
- JSON Schema Draft 2020-12 source.

Neither authority is generated from, ranked below, or silently replaced by the other. The tool does generate a JSON Schema witness from TypeSpec with the official `@typespec/json-schema` emitter, but that witness is comparison evidence only. Any unexplained difference produces `stopped_for_evaluation` and a non-zero exit code.

## What it checks

A `check` run performs five independent gates:

1. A source-level TypeSpec inventory discovers top-level models, enums, unions, scalars, and aliases without treating comments, strings, or nested model bodies as declarations.
2. The official TypeSpec JSON Schema emitter produces a dedicated, immutable comparison witness.
3. Both JSON Schema lanes are structurally checked as Draft 2020-12 documents, including local references, required properties, enum uniqueness, cardinalities, and invalid OpenAPI-only `nullable` usage.
4. The generated and authored declaration sets and normalized declaration bodies are compared recursively.
5. **Both authorities are executed as validators over one instance corpus**, and any instance they disagree about is reported with the value that proves it.

The semantic comparison covers declaration names and kind families, required/optional properties, nullability, scalar types and formats, constraints, enums, unions/composition, references, defaults and annotations, and additional/unevaluated-property policy.

## The two questions

Gates 1–4 answer *do the two documents say the same thing?* Gate 5 answers *is there a JSON
value the two authorities disagree about?* Those are different questions, and a contract needs
both answered.

Two schemas can be byte-different and behave identically — `additionalProperties: false` next to
`unevaluatedProperties: false` on a model with no composition, or `minimum: 0` next to
`exclusiveMinimum: -1` on an integer. Two schemas can also look nearly identical and accept
different data. The structural gate flags the first case; only the differential gate can tell the
two apart, and it does so by producing the witness instance rather than by arguing about
formatting.

```text
authored JSON Schema (A) ──┐                  ┌── verdict A
                           ├── probe corpus ──┤
generated witness    (B) ──┘                  └── verdict B

verdict A ≠ verdict B  ⇒  finding + the instance that proves it
```

Both directions run. Lane A validates instances derived from lane B and lane B validates
instances derived from lane A, so neither authority is the one being graded. Per-declaration
results carry `behaviorallyIndistinguishable`, which is the triage signal for gate 4: a
structural difference on a behaviourally indistinguishable declaration is a spelling difference
to reconcile; the same difference alongside a witness is a contract difference. Both stop
evaluation.

The probe corpus is deterministic and assembled from both lanes: declared `examples` and
`default` values, a synthesized full and minimal instance per declaration, every member of every
`enum`/`const` domain reachable through `$ref`, and a bounded family of mutants (property
deletion, unexpected-property injection, typed scalar substitution). A probe does not have to be
valid to be informative — disagreement is the signal either way — so synthesis quality affects
coverage, never soundness.

The instance validator is dependency-free and fail-closed. It covers the Draft 2020-12 core,
applicator and validation vocabularies including annotation-driven `unevaluatedProperties` and
`unevaluatedItems`, and it *refuses* the dynamic-reference family (`$dynamicRef`,
`$dynamicAnchor`, `$recursiveRef`, `$vocabulary`) rather than approximating it, because silently
skipping a keyword would make two genuinely different schemas look identical. Refusals surface
as `differential-validation-refused`; they are never counted as agreement.

## Install

```bash
npm install --save-dev @oresoftware/typespec-json-schema-validator
```

The package pins compatible versions of `@typespec/compiler`, `@typespec/json-schema`, and the canonical `@oresoftware/f2e` CLI parser. Node.js 22.9 or newer is required.

## Usage

> `tjsv` is the canonical command. The older `tsjsv` and `typespec-json-schema-validator` names remain compatibility aliases.


```bash
npx tjsv check \
  --typespec=./contracts/main.tsp \
  --schema=./contracts/authored.schema.json \
  --report=./artifacts/schema-parity.json
```

The command generates its witness under `.typespec-json-schema-validator/generated/` by default. That path is deliberately separate from both authored authorities.

Compare an already generated witness:

```bash
npx tjsv compare \
  --typespec=./contracts/main.tsp \
  --generated-schema=./artifacts/typespec.generated.schema.json \
  --schema=./contracts/authored.schema.json
```

Run only the differential lane — the independently authored schema validating instances of the
generated one, and the reverse — with no TypeSpec compiler required:

```bash
npx tjsv validate \
  --schema=./contracts/authored.schema.json \
  --generated-schema=./artifacts/typespec.generated.schema.json \
  --instances=./contracts/instances
```

Inspect TypeSpec declarations without invoking the emitter:

```bash
npx tjsv inventory --typespec=./contracts/main.tsp
```

Inspect the installed compiler and emitter:

```bash
npx tjsv doctor
```

All flags and defaults are declared in the repository-root `.cli-flags.toml` contract and parsed through `flags-2-env`; there is no second ad hoc flag parser.

## Instance corpus

Recorded payloads are a third statement of intent, and directory layout is the contract:

```text
instances/<Declaration>/valid/*.json     both authorities must accept
instances/<Declaration>/invalid/*.json   both authorities must reject
instances/<Declaration>/*.json           no stated expectation; only disagreement is reported
```

An instance under `valid/` that both authorities reject, or one under `invalid/` that both
accept, is a finding in its own right — the two schemas agree with each other and disagree with
the corpus. A corpus directory naming a declaration absent from either authority also fails
closed, because its instances were never actually checked.

## Differential lane flags

| Flag | Default | Effect |
| --- | --- | --- |
| `--instances`, `-i` | none | Directory of recorded instances, laid out as above. |
| `--probes` | `true` | Set `--probes=false` (or `--no-probes`) to skip the lane; the receipt then records the missing evidence rather than reporting a clean pass. |
| `--max-probes` | `64` | Synthesized probes per declaration per lane. |
| `--format-assertion` | `false` | Treat known `format` values as assertions in both lanes instead of annotations. |

## Exit codes

| Code | Status | Meaning |
| ---: | --- | --- |
| `0` | `passed` | Both direct declaration inventory and generated-schema evidence converge. |
| `2` | `stopped_for_evaluation` | One or more unexplained semantic or structural discrepancies exist. |
| `3` | `failed` | The compiler, configuration, file IO, or validator execution failed. |

## Deterministic receipts

Every comparison writes `ores.typespec-json-schema-validator.report/v1`. Receipts contain input digests, exact comparison settings, declaration mappings, coverage, stable finding fingerprints, toolchain evidence, and no wall-clock timestamp. Repeating a run with the same inputs and toolchain yields the same `runId` and finding order.

The `differential` block records how much behavioural evidence backs the run — probes evaluated,
agreements, divergences, refusals, and which declarations came through indistinguishable. A
receipt with the lane disabled says so explicitly (`differential.disabled`), so "no divergences
found" is never confused with "no divergences looked for".

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
- run: npx tjsv check --typespec=contracts/main.tsp --schema=contracts/authored.schema.json --quiet
```

The repository's own CI also runs positive and negative compiler-backed integration fixtures. The negative fixture must exit `2`; accepting drift is a test failure.

## Scope boundary

JSON Schema represents data shapes, not TypeSpec operations. Interfaces, operations, decorators, functions, and constants are reported in `coverage.outOfScopeTypeSpecDeclarations`; they are not silently counted as data declarations. Imported local `.tsp` files are followed. Package imports under `node_modules` remain compiler-owned and are not treated as authored declarations in the current repository.

See [architecture](docs/architecture.md), [rule catalog](docs/rules.md), and [fleet rollout](docs/rollout.md).
