#include "oreslang/runtime/ActorArena.h"

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <thread>
#include <type_traits>
#if defined(__unix__) || defined(__APPLE__)
#include <csignal>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

#define CHECK(x) do { if (!(x)) { std::fprintf(stderr, "compact actor arena test failed at %d\n", __LINE__); return 1; } } while (0)

static_assert(sizeof(std::uint32_t) == 4, "compact stored representation must be 4 bytes");
static_assert(std::is_standard_layout<OresArenaCompactHandle>::value,
              "host descriptor must have a stable C ABI");

static int happy_path() {
    OresActorArena* a = ores_actor_arena_open(101, 11, 2, 64, 64);
    OresArenaTurn turn = ores_actor_arena_enter(a, 101, 11);
    OresArenaHandle h = ores_actor_arena_alloc(a, turn, 16);
    OresArenaCompactHandle ref = ores_actor_arena_compact_encode(a, turn, h);
    CHECK(ref.bits == 1);
    // Actual scalar ABI consumed by LLVM's verified managed-ref MIR.
    // Host carries the authenticated actor-domain/epoch; i32 is storage only.
    const uint32_t published = ores_actor_arena_compact_publish_i32(
        a, turn.domain, turn.epoch, h.index, h.generation);
    CHECK(published == ref.bits);
    const uint64_t big = UINT64_C(0xFEDCBA9876543210);
    ores_actor_arena_compact_store_i64(
        a, turn.domain, turn.epoch, published, 8, big);
    CHECK(ores_actor_arena_compact_load_i64(
        a, turn.domain, turn.epoch, published, 8) == big);
    const std::uint32_t value = 0x12AB78EFu;
    ores_actor_arena_compact_write(a, turn, ref, 0, &value, sizeof(value));
    std::uint32_t restored = 0;
    ores_actor_arena_compact_read(a, turn, ref, 0, &restored, sizeof(restored));
    CHECK(restored == value);
    ores_actor_arena_leave(a, turn);
    // Actor turn is allowed to migrate to another carrier; never bake a
    // physical thread pointer into the compact representation.
    int outcome = -1;
    std::thread next([&] {
        OresArenaTurn later = ores_actor_arena_enter(a, 101, 11);
        restored = 0;
        ores_actor_arena_compact_read(a, later, ref, 0, &restored, sizeof(restored));
        ores_actor_arena_leave(a, later);
        outcome = restored == value ? 0 : 1;
    });
    next.join();
    CHECK(outcome == 0);
    turn = ores_actor_arena_enter(a, 101, 11);
    ores_actor_arena_drop(a, turn, h);
    // A published offset is *permanently quarantined* after drop. Reuse
    // would resurrect a dangling compact field without generation bits.
    OresArenaHandle remaining = ores_actor_arena_alloc(a, turn, 16);
    CHECK(remaining.index != h.index);
    OresArenaCompactHandle other = ores_actor_arena_compact_encode(a, turn, remaining);
    CHECK(other.bits == 9);
    ores_actor_arena_drop(a, turn, remaining);
    ores_actor_arena_leave(a, turn);
    ores_actor_arena_retire(a);
    CHECK(ores_actor_arena_try_destroy(a) == 1);
    return 0;
}

enum class Violation {
    StaleAfterDrop, CrossDomain, ForgedInterior, ForgedNull,
    UnpublishedSlot, BorrowedWrite, WrongCarrier, UnalignedSlot,
    QuarantinedExhaustion, OutOfBounds, StaleTurn,
    ScalarForgedDomain, ScalarForgedInterior, ScalarForgedGeneration,
    ScalarInvalidOffset, ScalarReadWrongCarrier, PublishWhileLoaned
};

static void invalid(Violation violation) {
    OresActorArena* a = ores_actor_arena_open(91, 6, 2, 64, 64);
    OresArenaTurn turn = ores_actor_arena_enter(a, 91, 6);
    OresArenaHandle h = ores_actor_arena_alloc(a, turn, 16);
    OresArenaCompactHandle r = ores_actor_arena_compact_encode(a, turn, h);
    std::uint32_t value = 0;
    switch (violation) {
        case Violation::StaleAfterDrop:
            ores_actor_arena_drop(a, turn, h);
            ores_actor_arena_compact_read(a, turn, r, 0, &value, sizeof(value));
            break;
        case Violation::CrossDomain: {
            ores_actor_arena_leave(a, turn);
            OresActorArena* other = ores_actor_arena_open(92, 6, 2, 64, 64);
            OresArenaTurn foreign = ores_actor_arena_enter(other, 92, 6);
            (void) ores_actor_arena_alloc(other, foreign, 16);
            ores_actor_arena_compact_read(other, foreign, r, 0, &value, sizeof(value));
            break;
        }
        case Violation::ForgedInterior:
            ++r.bits;
            ores_actor_arena_compact_read(a, turn, r, 0, &value, sizeof(value));
            break;
        case Violation::ForgedNull:
            r.bits = 0;
            ores_actor_arena_compact_read(a, turn, r, 0, &value, sizeof(value));
            break;
        case Violation::UnpublishedSlot:
            (void) ores_actor_arena_alloc(a, turn, 16);
            r.bits = 9; // slot 1 has no compact-published proof
            ores_actor_arena_compact_read(a, turn, r, 0, &value, sizeof(value));
            break;
        case Violation::BorrowedWrite: {
            OresArenaLoan loan = ores_actor_arena_borrow(a, turn, h);
            (void) loan;
            ores_actor_arena_compact_write(a, turn, r, 0, &value, sizeof(value));
            break;
        }
        case Violation::WrongCarrier: {
            std::thread other([&] {
                ores_actor_arena_compact_read(a, turn, r, 0, &value, sizeof(value));
            });
            other.join();
            break;
        }
        case Violation::UnalignedSlot: {
            ores_actor_arena_leave(a, turn);
            OresActorArena* unaligned = ores_actor_arena_open(91, 7, 2, 17, 64);
            OresArenaTurn t2 = ores_actor_arena_enter(unaligned, 91, 7);
            OresArenaHandle h2 = ores_actor_arena_alloc(unaligned, t2, 16);
            (void) ores_actor_arena_compact_encode(unaligned, t2, h2);
            break;
        }
        case Violation::QuarantinedExhaustion: {
            ores_actor_arena_drop(a, turn, h);
            OresArenaHandle second = ores_actor_arena_alloc(a, turn, 16);
            (void) ores_actor_arena_compact_encode(a, turn, second);
            ores_actor_arena_drop(a, turn, second);
            (void) ores_actor_arena_alloc(a, turn, 16);
            break;
        }
        case Violation::OutOfBounds:
            ores_actor_arena_compact_read(a, turn, r, 15, &value, sizeof(value));
            break;
        case Violation::StaleTurn:
            ores_actor_arena_leave(a, turn);
            (void) ores_actor_arena_enter(a, 91, 6);
            ores_actor_arena_compact_read(a, turn, r, 0, &value, sizeof(value));
            break;
        case Violation::ScalarForgedDomain:
            (void) ores_actor_arena_compact_load_i64(
                a, turn.domain + 1, turn.epoch, r.bits, 0);
            break;
        case Violation::ScalarForgedInterior:
            (void) ores_actor_arena_compact_load_i64(
                a, turn.domain, turn.epoch, r.bits + 1, 0);
            break;
        case Violation::ScalarForgedGeneration:
            (void) ores_actor_arena_compact_publish_i32(
                a, turn.domain, turn.epoch, h.index, h.generation + 1);
            break;
        case Violation::ScalarInvalidOffset:
            ores_actor_arena_compact_store_i64(
                a, turn.domain, turn.epoch, r.bits, UINT64_MAX, 1);
            break;
        case Violation::ScalarReadWrongCarrier: {
            std::thread other([&] {
                (void) ores_actor_arena_compact_load_i64(
                    a, turn.domain, turn.epoch, r.bits, 0);
            });
            other.join();
            break;
        }
        case Violation::PublishWhileLoaned: {
            const OresArenaLoan hold = ores_actor_arena_borrow(a, turn, h);
            (void) hold;
            (void) ores_actor_arena_compact_publish_i32(
                a, turn.domain, turn.epoch, h.index, h.generation);
            break;
        }
    }
}

#if defined(__unix__) || defined(__APPLE__)
static bool must_abort(Violation bad) {
    pid_t pid = fork();
    if (pid < 0) return false;
    if (pid == 0) {
        struct rlimit no_core = {0,0};
        (void) setrlimit(RLIMIT_CORE, &no_core);
        invalid(bad);
        _exit(99);
    }
    int status = 0;
    return waitpid(pid, &status, 0) == pid &&
           WIFSIGNALED(status) && WTERMSIG(status) == SIGABRT;
}
#endif

#ifdef ORESLANG_NATIVE_TEST_DOMAIN_EXHAUSTION
static int domain_counter_never_wraps() {
    ores_actor_arena_test_set_next_domain(UINT64_MAX - 2);
    OresActorArena* a = ores_actor_arena_open(121, 1, 1, 64, 64);
    OresActorArena* b = ores_actor_arena_open(122, 1, 1, 64, 64);
    OresArenaTurn ta = ores_actor_arena_enter(a, 121, 1);
    CHECK(ta.domain == UINT64_MAX - 2);
    ores_actor_arena_leave(a, ta);
    OresArenaTurn tb = ores_actor_arena_enter(b, 122, 1);
    CHECK(tb.domain == UINT64_MAX - 1);
    ores_actor_arena_leave(b, tb);
    ores_actor_arena_retire(a);
    ores_actor_arena_retire(b);
    CHECK(ores_actor_arena_try_destroy(a) == 1);
    CHECK(ores_actor_arena_try_destroy(b) == 1);
#if defined(__unix__) || defined(__APPLE__)
    const pid_t pid = fork();
    CHECK(pid >= 0);
    if (pid == 0) {
        struct rlimit no_core = {0,0};
        (void) setrlimit(RLIMIT_CORE, &no_core);
        (void) ores_actor_arena_open(123, 1, 1, 64, 64);
        _exit(99); // Saturated domain allocator MUST abort, never reissue 0/1.
    }
    int status = 0;
    CHECK(waitpid(pid, &status, 0) == pid);
    CHECK(WIFSIGNALED(status) && WTERMSIG(status) == SIGABRT);
#endif
    return 0;
}
#endif

int main() {
    CHECK(happy_path() == 0);
#if defined(__unix__) || defined(__APPLE__)
    for (int n = static_cast<int>(Violation::StaleAfterDrop);
         n <= static_cast<int>(Violation::PublishWhileLoaned); ++n)
        CHECK(must_abort(static_cast<Violation>(n)));
#endif
#ifdef ORESLANG_NATIVE_TEST_DOMAIN_EXHAUSTION
    CHECK(domain_counter_never_wraps() == 0);
#endif
    return 0;
}
