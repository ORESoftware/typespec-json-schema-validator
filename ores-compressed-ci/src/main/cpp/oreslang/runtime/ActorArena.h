#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Host-only, bounded native actor arena. No guest-visible raw pointers.
 * Persistent fixed-size slab slots survive mailbox turns; scratch allocations
 * are bump-allocated and invalidated/zeroed on each leave. */
typedef struct OresActorArena OresActorArena;
typedef struct { uint64_t domain, epoch; } OresArenaTurn;
typedef struct { uint64_t domain, index, generation; } OresArenaHandle;
/* Trusted host-side descriptor; ONLY .bits (four bytes) may be stored in an
 * actor-local field. The domain stays in the actor context, not on the wire. */
typedef struct { uint64_t domain; uint32_t bits; } OresArenaCompactHandle;
typedef struct { uint64_t domain, nonce, index, generation; } OresArenaLoan;
typedef struct { uint64_t domain, epoch, offset, length; } OresArenaScratch;
OresActorArena* ores_actor_arena_open(uint64_t owner, uint64_t incarnation,
                                       size_t slots, size_t slot_bytes, size_t scratch_bytes);
OresArenaTurn ores_actor_arena_enter(OresActorArena*, uint64_t owner, uint64_t incarnation);
void ores_actor_arena_leave(OresActorArena*, OresArenaTurn);
OresArenaHandle ores_actor_arena_alloc(OresActorArena*, OresArenaTurn, size_t bytes);
void ores_actor_arena_read(OresActorArena*, OresArenaTurn, OresArenaHandle, size_t offset,
                           void* out, size_t bytes);
void ores_actor_arena_write(OresActorArena*, OresArenaTurn, OresArenaHandle, size_t offset,
                            const void* src, size_t bytes);
void ores_actor_arena_drop(OresActorArena*, OresArenaTurn, OresArenaHandle);
/* Opt-in compact32 bridge for ALREADY validated actor-local handles.
 * 0 is null. Nonzero bits encode a slab byte offset divided by 8, plus 1.
 * An exported compact slot is quarantined after drop until arena retirement:
 * no stale 32-bit value may alias a newly allocated object at that offset.
 * No guest API can mint a host descriptor from arbitrary 32-bit payload.
 * These calls require the current actor's authenticated physical carrier turn.
 * They deliberately never return a raw T* or accept untrusted cross-actor
 * compact values. Object-graph and compiler provenance remain separate gates. */
OresArenaCompactHandle ores_actor_arena_compact_encode(
    OresActorArena*, OresArenaTurn, OresArenaHandle);
void ores_actor_arena_compact_read(
    OresActorArena*, OresArenaTurn, OresArenaCompactHandle,
    size_t offset, void* out, size_t bytes);
void ores_actor_arena_compact_write(
    OresActorArena*, OresArenaTurn, OresArenaCompactHandle,
    size_t offset, const void* src, size_t bytes);

/* Compiler-owned, scalar-only bridge for checked LLVM MIR. Host supplies an
 * authenticated physical actor turn; the stored managed reference stays i32.
 * These are trusted runtime symbols, not Oreslang user-callable functions.
 * LLVM must NEVER pass an untyped guest integer here as a reference.
 * No C aggregate-by-value or raw pointer-return ABI is exposed. */
uint32_t ores_actor_arena_compact_publish_i32(
    OresActorArena*, uint64_t domain, uint64_t epoch,
    uint64_t slot_index, uint64_t generation);
uint64_t ores_actor_arena_compact_load_i64(
    OresActorArena*, uint64_t domain, uint64_t epoch,
    uint32_t bits, uint64_t byte_offset);
void ores_actor_arena_compact_store_i64(
    OresActorArena*, uint64_t domain, uint64_t epoch,
    uint32_t bits, uint64_t byte_offset, uint64_t value);

OresArenaLoan ores_actor_arena_borrow(OresActorArena*, OresArenaTurn, OresArenaHandle);
void ores_actor_arena_release(OresActorArena*, OresArenaLoan);
OresArenaScratch ores_actor_arena_scratch_alloc(OresActorArena*, OresArenaTurn,
                                                size_t bytes, size_t alignment);
void ores_actor_arena_scratch_write(OresActorArena*, OresArenaTurn, OresArenaScratch,
                                    size_t offset, const void* src, size_t bytes);
void ores_actor_arena_scratch_read(OresActorArena*, OresArenaTurn, OresArenaScratch,
                                   size_t offset, void* out, size_t bytes);
void ores_actor_arena_retire(OresActorArena*);
/* Returns 0 while a turn or persistent loan exists; otherwise zeroizes and
 * frees storage and returns 1. Host must fence external callbacks first. */
int ores_actor_arena_try_destroy(OresActorArena*);
#ifdef ORESLANG_NATIVE_TEST_DOMAIN_EXHAUSTION
/* Test-only process-global counter override. Never compile into production. */
void ores_actor_arena_test_set_next_domain(uint64_t next);
#endif
#ifdef __cplusplus
}
#endif
