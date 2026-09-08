# Consumer admission regression gate

Tracking: DEN-3828 and issue #20.

`actions/test-consumer-admission` uses the existing canonical `verifyConsumerContract` implementation. It is not another schema authority or validator. Run the root compiler-backed parity action first, pinned to the same exact validator commit, and retain its report, generated witness, and Contract IR.

The new action verifies that current evidence passes; then checks seven altered copies: changed IR digest, stale receipt identity, disabled differential evidence, incomplete IR scope, empty consumer scope, duplicate scope, and mismatched scope. Each negative must throw the canonical `STOPPED_FOR_EVALUATION` error. A broken baseline, missing infrastructure, returned failure object, or unexpectedly accepted negative is a failed job, not successful negative coverage. A final positive verification checks that the negative cases did not leak mutable state.

Neither authored TypeSpec nor independently authored JSON Schema is modified. The action writes a canonical consumer verification receipt only after every case passes. A failure replaces prior validator-owned verification evidence with a failed receipt using the existing safe writer. Input and output paths are caller-owned and must remain within the workspace; symbolic-link components and multiply-linked evidence files are refused.

Use this after the root action:

```yaml
- uses: ORESoftware/typespec-json-schema-validator/actions/test-consumer-admission@<reviewed-40-character-commit>
  with:
    contract_ir: .typespec-json-schema-validator/contract-ir.json
    report: .typespec-json-schema-validator/report.json
    typespec: contracts/main.tsp
    schema: contracts/authored.schema.json
    generated_schema: .typespec-json-schema-validator/generated/typespec.generated.schema.json
    expected_declarations: '["Domain.Item"]'
```

Require this job before any generation or promotion it protects. Branch protection is a separate repository setting, not created by adding a workflow. Do not use `continue-on-error`, `pull_request_target` with untrusted code, mutable action refs, or a copied status field as admission. Preserve all existing native checks and versioned source boundaries.

Coverage is only the configured declaration bundle. A repository-local canary does not certify production APIs, runtime validators, SQL catalogs, Diesel/SeaORM behavior, transport projections, or sibling test suites. Report canary and production-domain adoption separately. These bounded regressions do not prove universal schema equivalence or artifact provenance.
