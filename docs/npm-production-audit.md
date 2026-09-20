# Production dependency advisory gate

Tracking: DEN-1721 and GitHub issue #62.

The reusable GitHub Action executes from this repository, so its own production dependency closure is part of the contract-enforcement trust boundary. A successful TypeSpec/JSON Schema parity result does **not** imply that the action's npm dependency closure is security-cleared.

## Fail-closed execution

Before `npm ci --omit=dev`, the root action runs `scripts/npm-audit-gate.mjs`. The runner invokes `npm audit --omit=dev --json --audit-level=high`.

The gate first validates the audit tool identity: npm must report a semantic version and its registry must be an absolute HTTPS URL with no credentials, query, or fragment. Missing/malformed tool identity is infrastructure failure, not a clean audit.

Exit `0` and exit `1` are both eligible for parsing because npm uses exit `1` when the configured vulnerability threshold is present. Any other exit, a registry/tool failure, malformed JSON, missing metadata, or malformed exception ledger emits a `failed` receipt and blocks the action. A valid audit with any unwaived high/critical advisory emits `stopped_for_evaluation` and blocks installation. This distinguishes security findings from unavailable evidence instead of turning collection failures into a clean result.

The gate follows npm's `via` package references back to their reviewed root advisory instead of inventing separate advisory IDs for propagated packages. Every affected production package path is still tracked separately with direct/transitive status, immediate `via` package references, installed node paths, effects, range, and fix availability. An exception must therefore match both the exact root advisory ID and the exact affected package path.

Every production-installed vulnerable path is classified `conservatively-reachable` by default. An exception may narrow that conclusion only when it names the exact advisory and package, has an owner and rationale, carries concrete reachability/compensating-control evidence, and has a canonical UTC expiry in `security/npm-audit-exceptions.json`. There is no severity-wide or package-wide wildcard suppression.

The receipt schema is `tjsv-npm-production-audit-receipt/v1`. It records npm/registry identity, production-only audit arguments, package and lockfile digests, audit-document digest, advisory/package path evidence, exact applied exceptions, and every unwaived high/critical path. CI retains the receipt even when the gate fails.

## Remediated advisory: GHSA-2q42-4q24-7rgv

The 2026-09-09 registry-backed audit reported one reviewed high-severity advisory, npm source `1193788` / `GHSA-2q42-4q24-7rgv`, propagated across `@typespec/compiler`, direct `@typespec/json-schema`, and transitive `@typespec/asset-emitter`. The advisory covered compiler/OpenAPI3 versions through `1.15.0`. While no patched release existed, three exact package-path exceptions held the gate open until `2026-09-16T04:00:00.000Z`, bounded by the sole-emitter argument that `test/unit/npm-advisory-boundary.test.mjs` still locks: the demonstrated exploit requires the separately packaged `@typespec/openapi3` emitter, TJSV installs only `@typespec/json-schema`, and the pinned-compiler fallback sets `emit: [emitterPath]`.

Upstream published `@typespec/compiler` `1.16.0`, which is outside the advisory range. The dependency declaration and lockfile were upgraded to it, the exception ledger was emptied, and `security/typespec-runtime-provenance.json` records the exact remediated package identities. **`security/npm-audit-exceptions.json` currently holds zero exceptions**, and a registry-backed audit of the current lockfile reports zero advisory paths. Nothing about the advisory is waived any more; it is simply not present.

Exceptions were never the fix. Upgrading past the advisory is always the first remediation; renewing an exception is only for an advisory with no patched release.

## Expiry is an outage, so it is announced early

An exception expires on a calendar date. Consumer repositories pin this action to an immutable commit, so an expiry silently reds the `admission` check in every repository still pinned to a revision whose ledger contains it — with no code change in either repository. That happened with the exceptions above: pins from before the `1.16.0` upgrade began failing with `high npm:1193788 (exception-expired)` once `2026-09-16T04:00:00.000Z` passed.

Three mechanisms make that visible before it bites, none of which relaxes the gate:

- Every gate run, including a passing one and including runs inside a consumer's pinned action, emits a warning (a GitHub `::warning::` annotation under Actions) for each applied exception expiring within the warning window, naming the package, advisory, expiry instant, days remaining, and owner.
- The window is `30` days by default and can be widened or narrowed with `TSJSV_NPM_AUDIT_EXPIRY_WARNING_DAYS`. A malformed value fails the gate rather than silently reverting to the default. The window only affects when a warning is emitted; enforcement still happens exactly at `expiresAt`.
- The scheduled `npm-advisory-exception-expiry` workflow runs the same gate daily in this repository and reconciles one tracking issue on every run, on the clean path as well as the alert path.

The receipt records `scope.expiryWarningDays` and an `exceptionsExpiringSoon` array, and an unwaived finding carries the ordered `remediation` steps, so both the human-readable output and the retained evidence say what to do next.

### Tracking issue lifecycle

The tracker is identified by a stable identity, never by its title or its position in a listing: an issue (not a pull request) carrying both the `tjsv-npm-advisory-exception-expiry` label and the hidden body marker `<!-- tjsv:npm-advisory-exception-expiry-tracker -->`. Applying a label needs triage permission, so an outside reporter who pastes the marker cannot get an issue adopted or closed; the marker keeps an unrelated issue that a maintainer labeled from being touched. Do not remove either from the tracker.

| Alert | Open tracker | Closed tracker | Action |
| --- | --- | --- | --- |
| yes | no | no | **create** the labeled, marked issue (and the label, if missing) |
| yes | yes | any | **update** the oldest open tracker's title and body and add a comment; never create a duplicate. Extra open trackers are closed as duplicates of it |
| yes | no | yes | **reopen** the most recently closed tracker, so one issue keeps the whole history, rather than opening a new one |
| no | yes | any | **close** every open tracker with a `Resolved:` comment naming the scheduled run and commit — only when the audit gate also passed |
| no | no | any | **noop**; a run with no tracker is a normal state and never fails the schedule |

The decision is the pure function `planExpiryTrackerReconciliation` in `src/npm-audit-expiry-tracker.mjs`; it returns the exact REST operations and the workflow step only fetches state and executes them. It fails closed in its own right: the alert verdict must be the literal `true` or `false` (a missing or malformed verdict, or an unreadable issue listing, stops the step instead of being read as "clean"), and a clean verdict while the production audit gate is red holds the tracker open. The lifecycle never feeds back into enforcement: the final step still fails the run whenever the gate did not pass.

## When an exception expires

1. Check whether upstream has published a release outside the advisory range. If it has, upgrade the dependency declaration and lockfile to the smallest compatible fix, delete the exception entries, and update `security/typespec-runtime-provenance.json`.
2. Only when no patched release exists, renew the exact advisory/package exception with a new canonical RFC3339 UTC expiry, owner, rationale, and **re-verified** reachability evidence. Renewal is a fresh review, not a date bump.
3. Never widen an exception to a severity, package, or advisory wildcard, and never use `npm audit fix --force`.
4. Consumers pin this action by commit, so a fix here does not reach them until each repository bumps its pin. Treat the pin bump as part of the remediation, not as follow-up.

## What this proves

A passing receipt proves only that the exact audited production lockfile had zero unwaived high/critical advisory paths according to the registry response used by that run, or that every such path had a still-valid exact exception whose producer boundary tests passed. It does not prove absence of unknown vulnerabilities, exploitability, dependency-license suitability, or security of the authored TypeSpec/JSON Schema contracts themselves.

Dependency remediation must update the authoritative dependency declaration and lockfile with the smallest compatible fix as soon as one exists, then rerun the full unit/compiler-backed integration suite and at least one real downstream peer-authority consumer. `npm audit fix --force` is not an accepted remediation strategy.
