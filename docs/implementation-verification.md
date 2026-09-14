# Rust implementation verification (L4)

The Dafny lane proves the reviewed reference/specification at L3. It does **not** prove arbitrary separately written consumers. This lane adds consumer-specific Rust evidence without weakening that boundary.

## Binding model

`implementation-proof-manifest/v1` binds a Rust consumer to all of the following at once:

- the exact `behavior-contract/v1` SHA-256 digest;
- the exact, self-digest-valid, passed `formal-verification-receipt/v1` verification ID;
- an L3 receipt that contains exactly one TypeSpec binding and at least one successful Dafny proof run for every promoted operation ID;
- the exact consumer Git revision and a clean worktree;
- the concrete Rust implementation source, symbol, and source digest;
- immutable proof-source digests; and
- one or more Verus and/or Kani proof targets.

The verifier refuses to issue a passed receipt when the checkout is dirty or at a different revision. This prevents an L4 receipt from silently floating across later source changes. It also recomputes the L3 receipt's `verificationId` instead of trusting a copied green identifier.

Every proof source must contain these machine-readable review markers:

```text
TJSV_OPERATION_ID: locks.check_ttl
TJSV_BEHAVIOR_DIGEST: sha256:<behavior-contract-digest>
TJSV_IMPLEMENTATION_SHA256: sha256:<concrete-rust-source-digest>
```

The markers make the semantic binding visible and grep-able. They are not proof by themselves: the exact proof-source digest, implementation-source digest, Git revision, L3 receipt, proof target, and verifier result form the evidence envelope.

Because source digests are byte-level pins, consumer repositories intended to verify on Windows, macOS, and Linux should make proof and implementation source line endings explicit in `.gitattributes`, for example `*.rs text eol=lf`.

## Kani

Kani is intended for ordinary Rust implementations where the proof harness may live separately from the production function. A target names a Cargo manifest and proof harness:

```json
{
  "tool": "kani",
  "source": "src/verification.rs",
  "sourceSha256": "sha256:<digest>",
  "manifestPath": "Cargo.toml",
  "harness": "verification::check_ttl_contract",
  "package": null
}
```

TJSV requires the pinned proof source to contain the named `#[kani::proof]` function and then executes:

```sh
cargo kani --manifest-path Cargo.toml --harness verification::check_ttl_contract
```

Kani evidence is recorded as `proofMode: "model-checking"`. Where a Kani proof uses explicit unwind bounds or other bounded assumptions, human review must retain those bounds and their scope; a passed receipt must not be paraphrased as an unbounded mathematical proof.

## Verus

Verus is admitted only when it verifies the **exact pinned implementation source**. TJSV rejects a separate Verus model file that merely resembles the production implementation, because that would reintroduce the same L3/L4 gap this lane exists to close.

```json
{
  "tool": "verus",
  "source": "src/lib.rs",
  "sourceSha256": "sha256:<same implementation digest>"
}
```

TJSV executes:

```sh
verus src/lib.rs
```

Verus evidence is recorded as `proofMode: "deductive"`.

## Receipt semantics

A passed `implementation-verification-receipt/v1` is L4 evidence **only for the concrete Rust consumer revision named in the receipt**. The receipt is self-digesting, sorts findings and proof runs deterministically, and labels Kani and Verus evidence separately.

It does not promote Go, Dart, TypeScript, or another Rust implementation to L4. For those implementations, keep the claim at L2 unless they have their own implementation-proof lane. Reuse the same operation IDs and behavioral digest in generated conformance corpora and runtime-conformance evidence so drift is detected without pretending the implementation was formally proved.

## Example manifest

```json
{
  "schema": "ores.typespec-json-schema-validator.implementation-proof-manifest/v1",
  "authority": "consumer-authored-implementation-proof-plan",
  "behaviorContractDigest": "sha256:<behavior-digest>",
  "formalVerificationId": "sha256:<passed-l3-receipt-id>",
  "repository": "https://github.com/ORESoftware/example-rust-consumer",
  "revision": "<exact-git-sha>",
  "operations": [
    {
      "operationId": "locks.check_ttl",
      "language": "rust",
      "implementation": {
        "source": "src/lib.rs",
        "sourceSha256": "sha256:<digest>",
        "symbol": "check_ttl"
      },
      "proofs": [
        {
          "tool": "kani",
          "source": "src/verification.rs",
          "sourceSha256": "sha256:<digest>",
          "manifestPath": "Cargo.toml",
          "harness": "verification::check_ttl_contract",
          "package": null
        }
      ]
    }
  ]
}
```
