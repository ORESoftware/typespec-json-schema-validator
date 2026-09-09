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

## Current unavoidable exception: GHSA-2q42-4q24-7rgv

The 2026-09-09 registry-backed audit reports one reviewed high-severity advisory, npm source `1193788` / `GHSA-2q42-4q24-7rgv`, propagated across `@typespec/compiler`, direct `@typespec/json-schema`, and transitive `@typespec/asset-emitter`. The advisory lists affected compiler/OpenAPI3 versions through `1.15.0` and **no patched version**.

The demonstrated exploit requires the separately packaged `@typespec/openapi3` emitter: an attacker-controlled version value is interpolated into an OpenAPI output filename before the compiler's generic `emitFile()` sink. TJSV does not install `@typespec/openapi3`; it resolves `@typespec/json-schema` as its sole emitter, and the pinned-compiler fallback explicitly sets `emit: [emitterPath]`. The action now also prefers its own lockfile-installed `tsp` executable over any caller-workspace binary. `test/unit/npm-advisory-boundary.test.mjs` locks these assumptions.

Because there is no upstream patched release to adopt, the three exact package-path exceptions expire at `2026-09-16T04:00:00.000Z`. Adding OpenAPI3, changing the sole-emitter boundary, expiry, a new advisory ID, or any additional high/critical path causes producer CI or the audit gate to fail closed. The exception is not a claim that `@typespec/compiler` is generally safe; it is a bounded statement about this immutable action execution path until upstream publishes a fix.

## What this proves

A passing receipt proves only that the exact audited production lockfile had zero unwaived high/critical advisory paths according to the registry response used by that run, or that every such path had a still-valid exact exception whose producer boundary tests passed. It does not prove absence of unknown vulnerabilities, exploitability, dependency-license suitability, or security of the authored TypeSpec/JSON Schema contracts themselves.

Dependency remediation must update the authoritative dependency declaration and lockfile with the smallest compatible fix as soon as one exists, then rerun the full unit/compiler-backed integration suite and at least one real downstream peer-authority consumer. `npm audit fix --force` is not an accepted remediation strategy.
