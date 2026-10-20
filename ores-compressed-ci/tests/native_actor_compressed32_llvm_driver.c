#include "oreslang/runtime/ActorArena.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#if defined(__unix__) || defined(__APPLE__)
#include <signal.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

/* These symbols are defined in the LLVM verifier-produced .ll module, then
 * compiled by clang and linked against the REAL production ActorArena.c. */
extern uint64_t checked_actor_read(
    OresActorArena*, uint64_t actor_domain, uint64_t actor_epoch, uint32_t ref32);
extern uint32_t checked_actor_publish_write(
    OresActorArena*, uint64_t actor_domain, uint64_t actor_epoch,
    uint64_t allocation_index, uint64_t allocation_generation, uint64_t value);

static void check(int ok, const char* diagnostic) {
    if (!ok) {
        fprintf(stderr, "compressed32 LLVM native AOT: %s\n", diagnostic);
        exit(1);
    }
}

#if defined(__unix__) || defined(__APPLE__)
typedef enum { BAD_DOMAIN, BAD_EPOCH, NULL_REF, INTERIOR_REF, STALE_DROPPED } InvalidRead;
static void require_compiled_read_abort(
        OresActorArena* arena, OresArenaTurn turn, uint32_t bits,
        InvalidRead mode) {
    pid_t child = fork();
    check(child >= 0, "could not create negative AOT child");
    if (child == 0) {
        struct rlimit core = {0, 0};
        (void)setrlimit(RLIMIT_CORE, &core);
        if (mode == BAD_DOMAIN) ++turn.domain;
        if (mode == BAD_EPOCH) ++turn.epoch;
        if (mode == NULL_REF) bits = 0;
        if (mode == INTERIOR_REF) ++bits;
        (void) checked_actor_read(arena, turn.domain, turn.epoch, bits);
        _exit(95);
    }
    int status = 0;
    check(waitpid(child, &status, 0) == child &&
          WIFSIGNALED(status) && WTERMSIG(status) == SIGABRT,
          "LLVM-generated read did not fail closed on invalid reference");
}
#endif

int main(void) {
    OresActorArena* first = ores_actor_arena_open(202, 1, 2, 64, 64);
    OresActorArena* second = ores_actor_arena_open(203, 1, 2, 64, 64);
    check(first != NULL && second != NULL, "could not open distinct actor arenas");

    OresArenaTurn t1 = ores_actor_arena_enter(first, 202, 1);
    OresArenaHandle h1 = ores_actor_arena_alloc(first, t1, 16);
    const uint64_t x = UINT64_C(0x8899aabbccddeeff);
    const uint32_t ref1 = checked_actor_publish_write(
        first, t1.domain, t1.epoch, h1.index, h1.generation, x);
    check(ref1 == 1u && checked_actor_read(first, t1.domain, t1.epoch, ref1) == x,
          "compiled actor-private compressed32 round trip failed");
#if defined(__unix__) || defined(__APPLE__)
    require_compiled_read_abort(first, t1, ref1, BAD_DOMAIN);
    require_compiled_read_abort(first, t1, ref1, BAD_EPOCH);
    require_compiled_read_abort(first, t1, ref1, NULL_REF);
    require_compiled_read_abort(first, t1, ref1, INTERIOR_REF);
#endif
    ores_actor_arena_leave(first, t1);

    OresArenaTurn t2 = ores_actor_arena_enter(second, 203, 1);
    OresArenaHandle h2 = ores_actor_arena_alloc(second, t2, 16);
    const uint64_t y = UINT64_C(0x123456789abcdef0);
    const uint32_t ref2 = checked_actor_publish_write(
        second, t2.domain, t2.epoch, h2.index, h2.generation, y);
    // Same 32-bit bits in different actor heaps are EXPECTED: the runtime
    // base and domain, not the guest field, disambiguate them.
    check(ref1 == ref2 && t1.domain != t2.domain,
          "independent actor arenas did not produce a colliding local offset");
    check(checked_actor_read(second, t2.domain, t2.epoch, ref2) == y,
          "compiled second actor's compact reference resolved incorrectly");
    ores_actor_arena_leave(second, t2);

    // Each new actor turn obtains its own epoch. A logical actor reference
    // persists, but a prior turn token is invalid after carrier handoff.
    t1 = ores_actor_arena_enter(first, 202, 1);
    check(checked_actor_read(first, t1.domain, t1.epoch, ref1) == x,
          "persisted compact reference failed a new actor turn");
    ores_actor_arena_drop(first, t1, h1);
#if defined(__unix__) || defined(__APPLE__)
    require_compiled_read_abort(first, t1, ref1, STALE_DROPPED);
#endif
    OresArenaHandle unreferenced = ores_actor_arena_alloc(first, t1, 16);
    check(unreferenced.index != h1.index,
          "published reference's freed slot was incorrectly recycled");
    ores_actor_arena_leave(first, t1);

    ores_actor_arena_retire(first);
    ores_actor_arena_retire(second);
    check(ores_actor_arena_try_destroy(first), "actor A failed quiesced retirement");
    check(ores_actor_arena_try_destroy(second), "actor B failed quiesced retirement");
    puts("LLVM_MANAGED_COMPRESSED32_ACTOR_RUNTIME_PASS");
    return 0;
}
