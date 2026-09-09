# Production dependency advisory gate

Tracking: DEN-1721 and GitHub issue #62.

The reusable GitHub Action executes from this repository, so its own production dependency closure is part of the contract-enforcement trust boundary. A successful TypeSpec/JSON Schema parity result does **not** imply that the action's npm dependency closure is security-cleared.

## Fail-closed execution

Before `npm ci --omit=dev`, the root action runs `scripts/npm-audit-gate.mjs`. The runner invokes:

```text
npm audit --omit=dev --json --audit-level=high
```

Exit `0` and exit `1` are both eligible for parsing because npm uses exit `1` when the configured vulnerability threshold is present. Any other exit, a registry/tool failure, malformed JSON, missing metadata, or malformed exception ledger emits a `failed` receipt and blocks the action. A valid audit with any unwaived high/critical advisory emits `stopped_for_evaluation` and blocks installation. This distinguishes security findings from unavailable evidence instead of turning collection failures into a clean result.

Every production-installed vulnerable path is classified `conservatively-reachable` by the composite action. The gate does not infer that a transitive package is harmless merely because a static import scan cannot see an internal compiler path. An exception may narrow that conclusion only when it names the exact advisory and package, has an owner and rationale, carries concrete reachability/compensating-control evidence, and has a canonical UTC expiry in `security/npm-audit-exceptions.json`. There is no severity-wide or package-wide wildcard suppression.

The receipt schema is `tjsv-npm-production-audit-receipt/v1`. It records npm/registry identity, production-only audit arguments, package and lockfile digests, audit-document digest, direct/transitive classification, vulnerable range, fix availability, exact applied exceptions, and every unwaived high/critical path. CI retains the receipt even when the gate fails.

## What this proves

A passing receipt proves only that the exact audited production lockfile had zero unwaived high/critical advisory paths according to the registry response used by that run. It does not prove absence of unknown vulnerabilities, exploitability, runtime invocation of every transitive path, dependency-license suitability, or security of the authored TypeSpec/JSON Schema contracts themselves.

Dependency remediation must update the authoritative dependency declaration and lockfile with the smallest compatible fix, then rerun the full unit/compiler-backed integration suite and at least one real downstream peer-authority consumer. `npm audit fix --force` is not an accepted remediation strategy.
