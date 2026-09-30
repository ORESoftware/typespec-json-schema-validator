# Pinned fleet action

The repository root exposes a composite GitHub Action that executes the same fail-closed validator as the `tjsv check` CLI.

Consumers must pin the action to an immutable 40-character commit. A branch or moving tag is not sufficient admission evidence.

## Consumer-manifest mode

New consumers should keep repository-owned TJSV configuration in `.ores-tjsv.toml` and let the action discover it from `github.workspace`:

```yaml
- uses: ORESoftware/typespec-json-schema-validator@<40-character-commit>
```

For a multi-contract manifest, select a declared contract without restating its authority paths:

```yaml
- uses: ORESoftware/typespec-json-schema-validator@<40-character-commit>
  with:
    contract: api
```

A nonstandard manifest location may be selected explicitly:

```yaml
- uses: ORESoftware/typespec-json-schema-validator@<40-character-commit>
  with:
    consumer_manifest: config/.ores-tjsv.toml
    contract: api
```

Manifest mode is selected when both legacy `typespec` and `schema` inputs are omitted. Existing action defaults are not forwarded in this mode, because doing so would silently override repository-owned manifest values. Put contract configuration in `.ores-tjsv.toml`; job-level `TSJSV_*` environment variables remain the explicit runtime override channel. Mixing a manifest with legacy action configuration inputs fails closed.

## Legacy input mode

Existing callers remain supported by supplying both authored authorities:

```yaml
- uses: ORESoftware/typespec-json-schema-validator@<40-character-commit>
  with:
    typespec: schema-authority/main.tsp
    schema: schema-authority/authored.schema.json
    report: .typespec-json-schema-validator/report.json
    output_dir: .typespec-json-schema-validator/generated
```

Supplying only one of `typespec` or `schema` is invalid. `contract` is valid only in manifest mode.

The action installs the validator's lockfile-pinned compiler and official JSON Schema emitter, including the reviewed native lifecycle build required by the pinned `flags-2-env` dependency. It then generates JSON Schema B into the evidence-only output directory, validates both JSON Schema lanes as Draft 2020-12, compares top-level declarations and normalized bodies, and executes bidirectional instance probes. Exit `0` means the declared comparison passed; exit `2` means semantic or structural evidence stopped for human evaluation; exit `3` means execution failed.

## Official emitter strategy inputs

Legacy action mode defaults to the validator's conservative, interoperable emitter policy:

```yaml
with:
  int64_strategy: string
  seal_object_schemas: "true"
  polymorphic_models_strategy: oneOf
```

In manifest mode these settings belong in `.ores-tjsv.toml`, so the GitHub Action, local CLI, and other automation consume the same repository-owned configuration.

These settings map directly to the reviewed CLI flags and official TypeSpec JSON Schema emitter options. A caller whose independently authored wire contract intentionally uses JSON numbers for 64-bit values may set `int64_strategy: number`; that is a contract decision, not a way to hide disagreement. Such callers must retain differential probes around JavaScript's exact-integer boundary and document whether values outside the safe range are rejected, encoded separately, or forbidden by the domain protocol.

`seal_object_schemas` accepts `true` or `false`. `polymorphic_models_strategy` accepts `ignore`, `oneOf`, or `anyOf`. Invalid values fail during the CLI configuration phase before generated evidence is accepted.

## Admission and evidence retention are separate gates

The parity action and consumer-admission action are semantic gates. They must remain fail-closed: do not set `continue-on-error` on either action, do not mask their exit code, and do not make downstream promotion depend on a weaker fallback authority.

Artifact upload is diagnostic transport, not semantic admission. Upload the report, Contract IR, SARIF, and generated comparison witness under `if: ${{ always() }}` so stopped runs remain inspectable, but set `continue-on-error: true` on the upload step. GitHub artifact quota exhaustion, a transient artifact-service failure, or retention infrastructure being unavailable must not convert a successful peer-authority comparison into a false red. The authored TypeSpec and JSON Schema authorities remain independent regardless of whether diagnostic transport succeeds.

The canonical consumer workflow is recorded in `docs/fleet-peer-authority-workflow.yml`. Keep the invariant explicit:

1. exact-head checkout and revision verification are mandatory;
2. TypeSpec ↔ JSON Schema comparison is fail-closed;
3. current Contract IR / receipt admission is fail-closed;
4. authored authorities must remain byte-for-byte unmodified by the run; and
5. diagnostic artifact retention is best-effort only.

Repository adoption is incremental: a green, independently authored canary contract proves the gate is installed and executable, but it does not certify unrelated domain contracts. Each domain declaration must move into both authored lanes and converge before downstream generation or promotion can consume it.
