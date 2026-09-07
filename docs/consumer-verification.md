# Downstream consumer evidence verification

Tracking: DEN-3828 and issue #20.

Use `actions/verify-contract-ir` immediately before consuming a retained Contract IR.
Pin both the producer action and this verifier to the same reviewed immutable commit.
The producer must have run successfully in the trusted workflow for the current revision.
Do not replace failed, absent, skipped, or unsupported producer evidence with copied green fields.

```yaml
- name: Verify before downstream generation
  uses: ORESoftware/typespec-json-schema-validator/actions/verify-contract-ir@<reviewed-40-character-commit>
  with:
    contract_ir: .typespec-json-schema-validator/contract-ir.json
    report: .typespec-json-schema-validator/report.json
    typespec: schema-authority-canary/main.tsp
    schema: schema-authority-canary/authored.schema.json
    generated_schema: .typespec-json-schema-validator/generated/typespec.generated.schema.json
    expected_declarations: '["OreSchemaAuthority.AuthorityKind","OreSchemaAuthority.PeerAuthorityRegistration"]'
```

The action installs the pinned verifier toolchain and invokes the canonical `verifyContractIr`
implementation. It rebuilds the expected IR from explicit checked-out input paths, verifies the
IR self-digest, complete receipt binding, and current TypeSpec/authored/generated input digests.
Paths are never selected by the report, and real paths must stay inside the caller workspace.
Missing files, invalid JSON, exceptions, tombstones, and failed verification exit nonzero.

Consumer scope must be an explicit nonempty JSON array of qualified TypeSpec declaration IDs.
The complete admitted set must match it exactly. Duplicate identities, omitted declarations,
count mismatches, excluded declarations, out-of-scope operations, and incomplete scopes stop
admission. Keep independent contracts in separately admitted bundles; do not disable completeness
just to combine supported data declarations with unsupported operations.

This action does not turn the receipt into a signature or prove its producer's identity. The
workflow must establish that trust through immutable code, a successful fresh producer, controlled
artifact provenance, and exact revision checkout. It reuses the canonical verifier; it does not
rerun the differential instance corpus or attest every transport/runtime. It does not authorize
emitter options or operation metadata absent from this data IR. Downstream generation manifests
must separately bind their operation inventories, emitter configuration, compatibility locks,
and toolchains, as required by issue #20.

The internal Node entrypoint accepts no command-line options. GitHub Action inputs are its fixed
configuration boundary. This is a thin adapter to the existing JavaScript validator API, not a new
Rust/Python parity implementation or an alternative schema authority. Local unit tests exercise
consumer policy and verifier wiring; compiler-backed integration tests use the actual canonical
verifier and mutate each evidence lane. A repository-local canary verifies only its two declarations,
not unrelated application, authentication, payment, renderer, or other domain contracts.
