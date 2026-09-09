# Five-runtime language-boundary example

The example at `examples/language-boundaries/manifest.json` declares five required language/runtime boundaries:

- Rust / native
- TypeScript / Node.js
- Dart / Flutter
- Go / native
- Gleam / BEAM

It is a **manifest example**, not proof that these five runtimes executed. A promotion decision must still supply a current TJSV parity receipt, a parity-bound admissible Contract IR, and one freshly produced evidence envelope for every required runtime.

Each runtime receipt must bind the same immutable source revision plus its exact generated artifact digest, generator/toolchain identity, parity `runId`, Contract IR `irId`, and passed ingress/egress validation. Missing evidence, source-revision drift, stale receipt/IR bindings, or symbolic revisions stop evaluation.

TypeSpec and independently authored JSON Schema Draft 2020-12 remain peer authorities. The generated JSON Schema witness, Contract IR, generated clients, runtime artifacts, this manifest, and all verification receipts are downstream evidence only.
