# GitHub fleet manifest adoption audit

This is the second stage of the GitHub fleet audit. The first stage (`npm run audit:fleet`) proves the configured organization/repository coverage and records immutable TJSV consumer references. The manifest-adoption stage reuses that receipt instead of re-enumerating the fleet.

## Purpose

The audit identifies repositories that still duplicate TJSV consumer configuration in workflow YAML after `.ores-tjsv.toml` became the canonical consumer manifest.

For every repository with a root `ORESoftware/typespec-json-schema-validator@<sha>` Action reference recorded by the first-stage receipt, the audit reads only:

- root `.ores-tjsv.toml` metadata; and
- the exact workflow paths that contained root TJSV Action references.

It then classifies root Action steps as:

- `legacy-inline`: both `with.typespec` and `with.schema` are still declared in YAML;
- `manifest-explicit`: `with.contract` selects a named manifest contract;
- `manifest-auto`: neither legacy authority input nor `contract` is supplied, so the Action uses manifest auto/default selection;
- `invalid-partial-legacy`: only one peer-authority input is supplied;
- `invalid-mixed`: manifest selection and legacy authority inputs are mixed in one step.

Multiple incompatible modes in one workflow/repository are reported as mixed/invalid. Manifest mode without a root `.ores-tjsv.toml` is blocking. Legacy inline consumers are review-level migration candidates rather than automatic failures so the fleet can migrate incrementally without weakening existing parity admission.

## Run

First produce the normal fleet receipt:

```bash
export GITHUB_TOKEN='...'
export TJSV_ADMITTED_REVISION='<40-character admitted TJSV main SHA>'
npm run audit:fleet
```

Then classify manifest adoption from that exact receipt:

```bash
npm run audit:fleet:manifests
```

Defaults:

- input: `.typespec-json-schema-validator/github-fleet-audit.json`
- output: `.typespec-json-schema-validator/github-fleet-manifest-adoption.json`

Override those with `TJSV_FLEET_RECEIPT` and `TJSV_FLEET_MANIFEST_RECEIPT` respectively.

The second-stage audit requires `GITHUB_TOKEN` or `GH_TOKEN`. It stops evaluation rather than silently shrinking coverage when GitHub reads fail or the remaining API rate limit falls below its safety floor.

## Receipt

The receipt schema is `ores.typespec-json-schema-validator.github-fleet-manifest-adoption/v1` and includes:

- deterministic per-repository adoption mode;
- per-workflow root Action classifications;
- blocking and review findings;
- a sorted `migrationQueue` of legacy-inline repositories;
- summary counts for adopted manifests, migration candidates, findings, and read failures;
- provenance links back to the first-stage fleet receipt schema and admitted TJSV revision.

This audit does not parse or reinterpret TypeSpec or JSON Schema semantics. The root Action and `ores-cli` remain responsible for fail-closed manifest parsing, authority independence, Draft 2020-12 admission, generated-evidence isolation, and contract selection semantics.
