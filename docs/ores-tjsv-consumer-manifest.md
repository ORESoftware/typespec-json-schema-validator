# `.ores-tjsv.toml` consumer manifest

`.ores-tjsv.toml` is repository-owned configuration for consumers of the `tjsv` CLI and reusable GitHub Action. It is separate from the package-owned `.cli-flags.toml`, which defines the CLI argument contract.

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
quiet = true

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

The root reusable Action also enters manifest mode when its legacy `typespec` and `schema` inputs are both omitted. It may select a contract with `with: { contract: api }` without restating authority or evidence paths.

## Admission and filesystem boundaries

The consumer manifest is deliberately bounded and fail-closed:

- the manifest must be a regular, non-symlink file with a single hard link;
- the UTF-8 manifest is limited to 256 KiB before parsing;
- a UTF-8 BOM is accepted, but the supported TOML v1 surface remains intentionally small: strings, booleans, integers, `[authority]`, `[defaults]`, and `[[contracts]]`;
- unknown keys and tables are rejected, including JavaScript special-property spellings such as `__proto__`;
- manifest-owned paths must be relative and remain within the manifest root both lexically and after resolving every existing symlink ancestor;
- dangling symlinks and non-directory ancestors on a configured path fail admission rather than falling through to a parent manifest or external filesystem location;
- contract selectors use the same bounded identifier grammar as declared contract IDs.

These checks protect repository-owned policy and evidence paths. They do not turn the manifest into contract evidence and do not weaken the peer-authority rule.

Manifest configuration has lower precedence than real environment variables and explicit CLI arguments. Generated parity receipts and Contract IR remain evidence; the manifest itself is policy/configuration, not evidence.
