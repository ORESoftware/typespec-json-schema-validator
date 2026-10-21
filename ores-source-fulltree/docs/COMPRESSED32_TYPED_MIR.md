# Typed actor-local compressed references: compiler/runtime gate (draft)

## Intent and where the implementation stops

Native Oreslang's full-width machine pointers and managed guest references are
distinct. A separate heap/region for each actor allows a compact `u32` slot
reference to be interpreted relative to *that actor's own heap* without a
global 4-GiB pointer cage. With 8-byte object alignment and reserved zero,
the reference codec can represent object starts spanning nearly 32 GiB. The
current fixed-capacity C actor arena deliberately admits **at most 64 MiB**
(including scratch) and does not reserve a 32-GiB region.

This stacked draft provides a **compiler-internal MIR contract** and an
executable LLVM-to-native-C runtime bridge. It does **not** parse or execute
general Oreslang `Ref<T>`, `state {}`, ownership-aware object graphs, or
arbitrary actor class references. The existing native source parser rejects
the new actor `state {}` contract rather than silently treating it as legacy
scalar actor fields. LLVM support must not be advertised as guest source
pointer support until the sealed critical state-loan verifier is integrated.

## Host-runtime scalar ABI

`ActorArena.h/.c` exposes three compiler-only trusted scalar entrypoints:

```c
uint32_t ores_actor_arena_compact_publish_i32(
    OresActorArena*, uint64_t domain, uint64_t epoch,
    uint64_t slot_index, uint64_t generation);
uint64_t ores_actor_arena_compact_load_i64(
    OresActorArena*, uint64_t domain, uint64_t epoch,
    uint32_t bits, uint64_t byte_offset);
void ores_actor_arena_compact_store_i64(
    OresActorArena*, uint64_t domain, uint64_t epoch,
    uint32_t bits, uint64_t byte_offset, uint64_t value);
```

These are not registered as Oreslang user-callable functions. Their
`OresActorArena*` and admitted turn tokens must come from a trusted
scheduler-provided actor execution context, *never* from message payloads.
The C runtime independently checks actor domain/epoch and carrier, slot
publication and liveness, allocation-start alignment, object bounds and
borrow exclusion on writes. A stale published compact offset may never
be recycled for another object before actor retirement (quarantine). The
host descriptor's domain information is **not** encoded into the 32-bit
guest field. Two actor heaps may legitimately produce the same bits.

Separate scalar arguments avoid guessing how an LLVM backend will coerce
the C structs `OresArenaTurn` and `OresArenaCompactHandle` across target
platform ABIs. Memory access uses checked C memcpy operations. The compiler
does not expose an `inttoptr` or raw-pointer dereference path.

## MIR admission

`ManagedRefMir.hpp` represents a logical typed managed reference with:

- actor-private provenance, actor-local escape and verified compile-time origin;
- read vs mutable write authority from a critical state loan;
- target/ref physical layout fixed before objects exist;
- no outstanding borrow across `await`, no native FFI in untrusted domains;
- a lifetime-safe published-slot recycling rule.

At present only the implemented `QuarantinePublished` policy can be
certified. A future `ProvenNoIncoming` representation needs a real ownership
and edge-invalidation proof and **must not** be accepted by changing just an
enum. Reject cross-actor mailbox transport, frozen shared regions, native
FFI pointers, integer casts, capability types, unsafe recycle policy and
native32 configurations.

### Compiler policy helper and remaining authority gate

`ActorRefOwnershipVerifier.hpp` now re-runs the ownership CFG at the exact
live-loan block, re-runs the sealed `handle_state` callback/effect admission,
checks read versus exclusive-write loan mode, and derives actor-owned/local,
compressed32/quarantined MIR **claims**. It intentionally returns ordinary
`ActorManagedRefMir` data and cannot construct `ActorRefOwnershipEvidence`.

That distinction is security-critical: an internal caller can construct a
synthetic CFG or callback description, so successful policy validation alone
must not mint codegen authority. The evidence constructor is reserved for the
real `SourceOwnershipChecker`, which still needs a source/HIR `Ref<T>` and
single-`state {}` path from actual parsed programs. Until that frontend path
exists, production source-to-compressed32 evidence issuance remains disabled.

The helper intentionally rejects `suspend` and `ffi` callbacks even where
the more general state contract could otherwise admit them. Compact reference
lifetime segmentation across continuation readmission and native-pointer
boundaries is not yet proven. Synthetic evidence remains isolated behind
`ORESLANG_COMPRESSED32_TEST_PROVENANCE` in MIR/backend regression binaries.

`ManagedRefMirLowering.hpp` accepts a verified plan and emits `i32`
publication and runtime-checked `i64` payload accesses through those C
symbols. It never widens a stored reference into an `i64` pointer, and
it never bypasses the C runtime by trusting a guest-supplied liveness bit.

## Verification architecture

- `managed_ref_mir_test.cpp` checks positive actor-private cases and a
  fail-closed matrix of origin, escape, loan, target/layout and recycling.
- `managed_ref_mir_llvm_test.cpp` builds and verifies an LLVM module and
  tests the actual C runtime symbol declarations and `i32` signatures.
- `native_actor_compact_arena_test.cpp` exercises the real C scalar
  ABI alongside forgery, carrier/epoch, bounds, loan and quarantine cases.
- `native_actor_compressed32_llvm_aot.py` obtains verified emitted LLVM IR,
  compiles it to native object code with Clang, compiles the *real* ActorArena.c,
  links a C driver, and executes two actor heaps whose first compact offsets
  collide but whose domains and payloads remain distinct.

The last test is **backend IR-to-runtime AOT integration**, not a claim that
the Oreslang source compiler now emits these references. GitHub Actions
jobs that fail before running any steps provide no compiler or sanitizer
test evidence. Do not mark this draft ready until exact-head full CMake,
CTest, Clang AOT runtime, and sanitizers execute.

## Remaining native source/compiler work

1. Introduce a logical `Ref<T, Domain>` or existing `Pointer<T>` owner in
   HIR with sealed actor-domain and single-`state {}` semantics; the compiler
   owns physical storage choice, not the source programmer.
2. Lower verified `critical handle_state(callback)` loans to actor runtime
   admission. Capture the active actor context after each continuation resume,
   not a permanent OS-thread-local heap base.
3. Encode actor-owned class/struct/array field references as `i32` only once
   the entire reference lifetime and incoming-link invalidation is proven.
   Until then use permanent slot quarantine or an explicit generational
   handle, not unchecked slot reuse.
4. Maintain full-width native pointers for OS, TCP, PostgreSQL, FFI, DMA and
   other external resources. Message-passing actor capabilities are not
   compressed heap-local references.
5. Evaluate selective heap choices and SoA/AoSoA/ECS integer row indices
   against 64-bit managed references on memory RSS, LLC misses, throughput
   and p95/p99 latency. Compression is not guaranteed to be a speedup.

Related base PR: LLVM #750. This PR must be reviewed as a stacked dependency
and retested after any semantic resolution with main.
