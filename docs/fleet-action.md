# Pinned fleet action

The repository root exposes a composite GitHub Action that executes the same fail-closed validator as the `tsjsv check` CLI.

Consumers must pin the action to an immutable 40-character commit. A branch or moving tag is not sufficient admission evidence.

```yaml
- uses: ORESoftware/typespec-json-schema-validator@<40-character-commit>
  with:
    typespec: schema-authority/main.tsp
    schema: schema-authority/authored.schema.json
    report: .typespec-json-schema-validator/report.json
    output_dir: .typespec-json-schema-validator/generated
```

The action installs the validator's lockfile-pinned compiler and official JSON Schema emitter, generates JSON Schema B into the evidence-only output directory, validates both JSON Schema lanes as Draft 2020-12, compares top-level declarations and normalized bodies, and executes bidirectional instance probes. Exit `0` means the declared comparison passed; exit `2` means semantic or structural evidence stopped for human evaluation; exit `3` means execution failed.

The caller owns artifact retention. Upload the report and generated witness under `if: always()` so a stopped or failed run remains inspectable, then enforce the action's exit status. Neither the action nor the generated witness may overwrite the independently authored TypeSpec or JSON Schema authority.

Repository adoption is incremental: a green, independently authored canary contract proves the gate is installed and executable, but it does not certify unrelated domain contracts. Each domain declaration must move into both authored lanes and converge before downstream generation or promotion can consume it.
