# `.ores-tjsv.toml` consumer manifest

`.ores-tjsv.toml` is repository-owned configuration for consumers of the `tjsv` CLI. It is separate from the package-owned `.cli-flags.toml`, which defines the CLI argument contract.

`tjsv check`, `compare`, `validate`, `inventory`, and `generate` discover `.ores-tjsv.toml` from the current directory upward, stopping at the repository `.git` boundary. Manifest paths are resolved relative to the manifest directory. Explicit CLI flags and environment values continue to override manifest values.

TypeSpec and authored JSON Schema remain peer authorities. A consumer manifest may record that policy, but it cannot downgrade either authority.

```toml
version = 1
default_contract = "api"

[authority]
typespec = "peer-authority"
json_schema = "peer-authority"

[defaults]
report = ".typespec-json-schema-validator/report.json"
contract_ir = ".typespec-json-schema-validator/contract-ir.json"
output_dir = ".typespec-json-schema-validator/generated"
probes = true
max_probes = 64
format_assertion = false

[[contracts]]
id = "api"
typespec = "contracts/main.tsp"
schema = "contracts/authored.schema.json"
instances = "contracts/instances"
mapping = "contracts/mapping.json"
```

With that file, the normal consumer invocation becomes:

```bash
tjsv check
```

A manifest with one contract selects it automatically. A manifest with multiple contracts can define `default_contract` or be selected explicitly:

```bash
tjsv check --contract=admin
tjsv check --consumer-manifest=./config/.ores-tjsv.toml --contract=api
```

The corresponding environment variables are `TSJSV_CONTRACT` and `TSJSV_CONSUMER_MANIFEST`. These selectors are part of the package-owned `.cli-flags.toml` contract and go through `flags-2-env`; there is no separate argv parser.

Manifest configuration has lower precedence than real environment variables and explicit CLI arguments. Generated parity receipts and Contract IR remain evidence; the manifest itself is policy/configuration, not evidence.
