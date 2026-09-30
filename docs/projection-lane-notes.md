# Projection lane notes

Protobuf, WIT, and Dafny remain downstream generated evidence. TypeSpec and authored JSON Schema remain independent peer authorities.

The WIT tooling lane is implemented by [`ORESoftware/ores-wit`](https://github.com/ORESoftware/ores-wit). This repository remains responsible for Contract IR, parity evidence, projection manifests, and semantic projection admission; `ores-wit` owns WIT package validation, deterministic WIT digests, WIT verification receipts, and binding-generation/adaptor orchestration.

See [`wit-projection.md`](./wit-projection.md) for the handoff contract and fleet rules.
