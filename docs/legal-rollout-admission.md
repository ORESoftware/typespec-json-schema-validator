# Legal rollout admission profile

Issue: `#20` / Linear: `DEN-3828`.

The legal-rollout profile is a narrow downstream use of the validator's parity-approved Contract IR. It does **not** make legal prose a schema authority and does not make this package a contract-management or legal-advice system.

## Authority model

Three layers remain separate:

1. `schema/legal-rollout-manifest.tsp` is the independently authored TypeSpec authority for the manifest shape.
2. `schema/legal-rollout-manifest.schema.json` is the independently authored JSON Schema authority for the same manifest shape.
3. Files under a consumer repository's `docs/legal/internal/` and `docs/legal/external/` are hash-addressed evidence described by a manifest instance.

TypeSpec-emitted JSON Schema is comparison evidence only. The legal admission command accepts a Contract IR only after `verifyContractIr()` proves that its recorded TypeSpec, generated JSON Schema, authored JSON Schema, policy, receipt, and emitter configuration still match the supplied bytes exactly.

A green legal receipt therefore means:

- the two authored manifest authorities achieved parity;
- the supplied Contract IR is admissible for those exact inputs;
- both schema lanes independently accept the manifest instance;
- every manifested document passed the requested integrity and hygiene controls; and
- the legal tree contains no unmanifested or missing agreement Markdown.

It does **not** mean that counsel approved a document, a signature is valid, an agreement is enforceable, or a jurisdictional requirement is satisfied.

## Manifest

```json
{
  "schema": "ores.legal-rollout.manifest/v1",
  "repository": "example/example-docs",
  "legalRoot": "docs/legal",
  "releaseApproved": false,
  "documents": [
    {
      "id": "external-eula",
      "path": "docs/legal/external/end-user-license-agreement.md",
      "classification": "external",
      "agreementType": "end-user-license-agreement",
      "sha256": "[64 LOWERCASE HEX CHARACTERS]",
      "status": "draft",
      "required": true
    }
  ]
}
```

Paths are canonical repository-relative paths. Backslashes, absolute paths, `.` and `..` segments, duplicate paths, duplicate IDs, symlink traversal, and multiply linked files are refused. Every non-README Markdown file under the internal and external trees must appear exactly once.

## Template integrity mode

The default mode is for source-controlled blank templates. It requires, among other controls:

- at least five distinct external and three distinct internal agreement types by default;
- an internal/external path and body classification match;
- the exact `DRAFT TEMPLATE — NOT AN EXECUTED AGREEMENT — NOT LEGAL ADVICE` banner for draft entries;
- square-bracket placeholders;
- blank signer initials;
- blank `By`, `Date`, `Name`, and title/role/capacity fields;
- an executed/completed-copy destination that expressly says `NEVER GIT`;
- no filled signature or `By` field;
- no credential-, private-key-, SSN-, or payment-card-shaped material; and
- an exact SHA-256 match for UTF-8 Markdown bytes.

The receipt records paths, classifications, agreement types, statuses, sizes, and digests. It does not copy legal prose into findings or receipts.

## Release mode

`--release` is a separate fail-closed gate. It requires:

- `releaseApproved: true` at manifest level;
- every required document to have `status: "approved"`;
- an `effectiveDate` and immutable `approvalRecord` for each approved document;
- the `APPROVED TEMPLATE — NOT AN EXECUTED AGREEMENT` marker; and
- removal of the draft banner from approved renditions.

A repository can therefore merge draft legal templates while signed application or publication workflows remain blocked until counsel and the designated owners approve exact bytes. The validator never infers approval from Git history, a pull-request review, or parity alone.

## CLI

First create parity evidence and Contract IR from the two manifest authorities:

```bash
npx tsjsv check \
  --typespec node_modules/@oresoftware/typespec-json-schema-validator/schema/legal-rollout-manifest.tsp \
  --schema node_modules/@oresoftware/typespec-json-schema-validator/schema/legal-rollout-manifest.schema.json \
  --output-dir .legal-rollout/generated \
  --bundle-id legal-rollout.generated.schema.json \
  --report .legal-rollout/parity-report.json \
  --contract-ir .legal-rollout/contract-ir.json
```

Then admit the manifest and Markdown evidence:

```bash
npx tsjsv legal-rollout \
  --manifest docs/legal/LEGAL_DOCUMENT_MANIFEST.json \
  --typespec node_modules/@oresoftware/typespec-json-schema-validator/schema/legal-rollout-manifest.tsp \
  --schema node_modules/@oresoftware/typespec-json-schema-validator/schema/legal-rollout-manifest.schema.json \
  --parity-report .legal-rollout/parity-report.json \
  --contract-ir .legal-rollout/contract-ir.json \
  --project-root . \
  --legal-root docs/legal \
  --report .legal-rollout/receipt.json
```

Add `--release` only to a publication or signed-build job. Exit codes remain the validator-wide contract: `0` passed, `2` stopped for evaluation, `1` execution failure, and `64` usage error where the argument contract reports one.

All options are declared in the repository-root `.cli-flags.toml`; `flags-2-env` maps argv and environment values into the existing `TSJSV_*` configuration surface.

## Composite action

A consumer repository can pin the action by commit SHA:

```yaml
- uses: ORESoftware/typespec-json-schema-validator/legal-rollout-action@<FULL_COMMIT_SHA>
  with:
    manifest: docs/legal/LEGAL_DOCUMENT_MANIFEST.json
    legal_root: docs/legal
    release: 'false'
```

The action installs the repository's lockfile-pinned dependencies, compiles and compares the two packaged authorities, emits the parity receipt and Contract IR, and then runs legal admission. It returns absolute receipt, parity-report, and Contract IR paths for artifact upload by the caller.

The action uses checked-in files and content digests rather than cross-repository symlinks. Consumer release workflows should upload all three receipts together with their signed artifact evidence.

## Determinism and privacy

`ores.legal-rollout.receipt/v1` contains no wall-clock timestamp, random identifier, host path, or document body. Its `runId` is SHA-256 over canonical receipt content. Findings have stable fingerprints and bounded metadata. Re-running the same exact inputs and options produces the same receipt bytes.

Executed agreements, wet signatures, identity documents, privileged communications, customer matter data, payment details, and production credentials must remain in approved external records systems, never in Git or validator receipts.
