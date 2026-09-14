# Formal verification lane

TJSV keeps structural, behavioral, and formal claims separate.

- TypeSpec and authored JSON Schema remain independent structural authorities.
- `behavior-contract/v1` remains an independently authored behavioral authority.
- `formal-manifest/v1` is an independently authored proof manifest that binds selected behavioral operations to immutable Dafny source files and symbols.
- Dafny output, receipts, generated schemas, Contract IR, and runtime evidence remain derived evidence. None of them may rewrite an authority.

The formal lane exists to answer a stronger question than schema parity: **does the reviewed proof source establish the behavioral contract for the exact operation that consumers claim to implement?**

## Manifest

```json
{
  "schema": "ores.typespec-json-schema-validator.formal-manifest/v1",
  "authority": "independently-authored-formal-authority",
  "behaviorContractDigest": "sha256:<digest>",
  "operations": [
    {
      "operationId": "locks.acquire",
      "language": "dafny",
      "source": "formal/locks.dfy",
      "module": "Locks",
      "symbol": "Acquire",
      "sourceSha256": "sha256:<digest>",
      "verifyIncludedFiles": true
    }
  ]
}
```

The manifest is deliberately small. Function parameters, result types, preconditions, postconditions, invariants, effects, determinism, and idempotency remain in `behavior-contract/v1`; copying those fields into the proof manifest would create another drift surface.

Every manifest operation must resolve to a `language: "dafny"` behavioral operation. Every Dafny behavioral operation must have exactly one proof target. Proof source paths are normalized relative POSIX paths inside a trusted root and must name `.dfy` files. The source digest is mandatory.

## TypeSpec binding gate

Before Dafny runs, TJSV compiles the current TypeSpec authority and resolves `@behaviorRef` metadata through the package's TypeSpec library. For each Dafny behavioral operation the verifier requires exactly one TypeSpec operation binding.

The verifier compares:

- parameter count and order;
- parameter names;
- required/optional status;
- named/scalar parameter types;
- result type and nullability; and
- an embedded `@behavior(...)` payload, when present, against the independently authored behavioral authority.

A missing, duplicate, or drifting binding stops evaluation before proof evidence can be promoted.

## Dafny proof gate

The verifier probes `dafny --version`, safely reads every referenced source, recomputes its SHA-256 digest, checks that the requested module and symbol are present, and runs modern command-style Dafny verification:

```sh
dafny verify formal/locks.dfy
```

When a target opts into included-file verification, TJSV uses:

```sh
dafny verify --verify-included-files formal/locks.dfy
```

A non-zero exit status, unavailable executable, missing source, unsafe filesystem object, stale digest, or missing symbol is a fail-closed finding. The receipt stores only command exit/signal data and SHA-256 digests of stdout/stderr; it does not copy arbitrary proof output into durable evidence.

Dafny verifies all explicit files listed on the command line; `--verify-included-files` extends verification to non-library included files. Keep reusable libraries separately verified and pin their source through the normal repository dependency and provenance controls.

## Proof receipt

Successful and stopped runs produce `formal-verification-receipt/v1`. The receipt binds:

- the behavioral-contract digest;
- the normalized formal-manifest digest;
- the resolved TypeSpec operation bindings;
- the Dafny executable/version probe evidence;
- each source proof run and its output digests; and
- deterministic findings plus a self-digesting `verificationId`.

Do not copy a boolean such as `dafnyVerified: true` into a consumer repository. Consumers must retain or recompute the exact receipt for the source revision being promoted.

## Assurance levels

TJSV should describe what was actually established rather than treating all consumers as formally verified:

| Level | Claim |
| --- | --- |
| L0 | TypeSpec ↔ JSON Schema structural parity |
| L1 | Consumer function/interface signature conforms |
| L2 | Runtime differential/property/conformance corpus agrees |
| L3 | Dafny specification/reference algorithm verifies |
| L4 | The concrete consumer implementation itself is verified (for example with Verus/Kani for Rust) |

A Dafny proof of the reference model is an L3 claim. It is not automatically an L4 proof of independently written Rust, Go, Dart, or TypeScript code.

## Pattern matching

Closed TypeSpec unions and JSON Schema `oneOf` variants should be represented as Dafny datatypes where feasible. Exhaustive `match` expressions are especially useful for state machines, result unions, error variants, lock/lease outcomes, and protocol transitions because adding a new constructor creates an explicit proof/update obligation instead of silently falling through a default branch.

Example:

```dafny
datatype AcquireResult =
  | Acquired(token: nat)
  | Contended(owner: string)
  | Expired
  | Rejected(reason: string)

function IsTerminal(result: AcquireResult): bool {
  match result
    case Acquired(_) => true
    case Contended(_) => false
    case Expired => true
    case Rejected(_) => true
}
```

## Consumer implementation verification

For correctness-critical Rust consumers, use the same behavioral operation IDs and proof vectors with Verus and/or Kani. The Dafny lane remains language-neutral reference evidence; Rust-specific verification should publish separate implementation evidence bound to the same behavior-contract digest and source revision.
