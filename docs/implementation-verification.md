# Rust implementation verification (L4)

The Dafny lane proves the reviewed reference/specification at L3. It does **not** prove arbitrary separately written consumers. This lane adds consumer-specific Rust evidence without weakening that boundary.

## Binding model

`implementation-proof-manifest/v1` binds a Rust consumer to all of the following at once:

- the exact `behavior-contract/v1` SHA-256 digest;
- the exact passed `formal-verification-receipt/v1` verification ID;
- the exact consumer Git revision;
- the concrete Rust implementation source and symbol;
- immutable proof-source digests; and
- one or more Verus and/or Kani proof targets.

The verifier refuses to issue a passed receipt when the checkout is dirty or at a different revision. This prevents an L4 receipt from silently floating across later source changes.

Every proof source must also contain these machine-readable review markers:

```text
TJSV_OPERATION_ID: locks.check_ttl
TJSV_BEHAVIOR_DIGEST: sha256:<behavior-contract-digest>
```

Those markers do not prove that the harness calls the intended function by themselves. They make the semantic binding visible and grep-able while the proof-source digest, Git revision, proof target, and verifier result remain the stronger evidence envelope.

## Kani

Kani is intended for ordinary Rust implementations. A target names a Cargo manifest and proof harness:

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

TJSV executes:

```sh
cargo kani --manifest-path Cargo.toml --harness verification::check_ttl_contract
```

Kani evidence is recorded as `proofMode: "model-checking"`. Where a Kani proof uses explicit unwind bounds, the human review must retain those bounds and their scope; a passed receipt must not be paraphrased as an unbounded proof when the harness is bounded.

## Verus

Verus targets point at an immutable `.rs` proof source:

```json
{
  "tool": "verus",
  "source": "verification/check_ttl.rs",
  "sourceSha256": "sha256:<digest>"
}
```

TJSV executes:

```sh
verus verification/check_ttl.rs
```

Verus evidence is recorded as `proofMode: "deductive"`.

## Receipt semantics

A passed `implementation-verification-receipt/v1` is L4 evidence **only for the concrete Rust consumer revision named in the receipt**. It does not promote Go, Dart, TypeScript, or another Rust implementation to L4.

For those other implementations, keep the claim at L2 unless they have their own implementation-proof lane. Reuse the same operation IDs and behavioral digest in generated conformance corpora and runtime-conformance evidence so drift is detected without pretending the implementation was formally proved.

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
