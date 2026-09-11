# GitHub fleet audit

TJSV includes a fail-closed fleet audit for repositories that consume or should admit TypeSpec and independently authored Draft 2020-12 JSON Schema authorities.

The audit is intentionally separate from parity evaluation inside one repository. It answers a different question: whether a configured GitHub fleet has enough verifiable coverage and whether each repository's TJSV provenance and admission evidence follows the same immutable-source rules.

## Coverage contract

The checked-in scope is `security/github-fleet-audit-scope.json`. The initial fleet requires at least 11 successfully enumerated GitHub organizations and at least 100 non-archived repositories. The configured scope currently spans 13 organizations:

- `claritas-viz`
- `elenkos-systems`
- `fiducia-cloud`
- `gha-indie-worker`
- `messaging-intel`
- `opto-sync`
- `ores-chat`
- `ores-forms`
- `ores-legal`
- `ores-rate-limit`
- `ores-redis-lru-cache`
- `shared-auth`
- `zed-pkg`

Enumeration failures are not treated as empty organizations. A denied, rate-limited, truncated, or malformed GitHub response fails the audit rather than silently reducing coverage.

`ORESoftware` is intentionally not counted toward the organization minimum because the connected GitHub owner is a user namespace, not a GitHub Organization.

## Provenance rules

Blocking findings include:

- a floating TJSV GitHub Action ref;
- a floating TJSV source-checkout ref;
- a semver/range package dependency instead of a full Git SHA source;
- malformed TJSV source-lock revisions;
- disagreement between an immutable TJSV workflow/package pin and `tooling/source-lock.json`;
- credential-bearing GitHub URLs.

Immutable pins that differ from the admitted TJSV revision are review findings until GitHub ancestry is checked. A main-reachable ancestor can be safely classified as stale; a divergent or unreachable revision must block promotion.

## Authority and portability review

Repository-tree classification never promotes generated JSON into authored authority. Paths below `generated/`, `dist/`, `build/`, `tmp/`, `target/`, `vendor/`, or `node_modules/` are excluded from authored-authority candidates.

When a repository visibly contains both TypeSpec and authored `*.schema.json` candidates but no TJSV use, the audit emits `tjsv-admission-not-visible` for review. This is intentionally not an automatic blocking finding because a path inventory alone cannot prove architectural intent.

A workflow that visibly uses TJSV but does not visibly include Ubuntu, macOS, and Windows runner families emits `tjsv-portability-matrix-incomplete`. A visible TJSV workflow without a report, receipt, SARIF, or status assertion emits `tjsv-evidence-assertion-not-visible`.

These review findings stop unattended fleet promotion until evaluated; they do not rewrite either authority or weaken parity rules.

## Running the live audit

The audit requires authenticated GitHub access because the scope includes private repositories. Unauthenticated execution is refused.

```bash
export GITHUB_TOKEN='...'
export TJSV_ADMITTED_REVISION='<40-character admitted TJSV main SHA>'
npm run audit:fleet
```

Optional variables:

- `TJSV_FLEET_SCOPE` selects another scope document relative to the repository root.
- `TJSV_FLEET_RECEIPT` selects the output receipt path.

The default receipt is `.typespec-json-schema-validator/github-fleet-audit.json`, which is ignored by Git. The runner creates its parent directory before writing.

Exit status is `0` for a clean pass, `2` when deterministic blocking/review findings require evaluation, and `1` for infrastructure or coverage failure.

## GitHub API safety

The live scanner uses Node's built-in `fetch`, an explicit API version, bounded request timeouts, deterministic ordering, and a GitHub rate-limit safety floor. It reads recursive trees first and fetches only bounded-size candidate text files such as workflows, package manifests, TJSV config, and source locks. A truncated recursive tree fails closed.

The receipt records repository/path/rule evidence, not full source file contents. Credential-bearing URLs are detected without copying the credential into findings.

## Rollout discipline

Fleet findings should drive focused consumer PRs. Do not mass-edit 100 repositories merely to satisfy a count. For an immutable-but-stale pin, first verify that it is an ancestor of the admitted TJSV revision, repin the consumer to the admitted full SHA, then require exact-head consumer CI before promotion. For an interface/contract repository with peer authorities but no visible TJSV admission, add a repository-specific admission gate that preserves TypeSpec and authored JSON Schema as independent authorities and treats generated schemas/Contract IR as evidence only.
