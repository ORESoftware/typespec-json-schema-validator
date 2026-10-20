#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace oreslang::backend {

/*
 * Compiler-internal logical reference and physical layout decision.
 *
 * Guest source never supplies these enums, which are minted by the ownership
 * / actor-isolation verifier. The codegen bridge consumes a verified plan;
 * it cannot reinterpret a guest i64, ActorRef, FFI pointer or serializable
 * message as a compact actor reference.
 *
 * IMPORTANT: The current LLVM frontend does not yet mint this MIR from
 * source-level Ref<T>. Until that pass exists, this is an internal, guarded
 * codegen contract, NOT guest Ref<T> support.
 */
enum class ManagedRefOrigin : std::uint8_t {
    ActorOwned, FrozenShared, ForeignActor, ActorCapability, NativePointer,
    GuestInteger, Unknown
};
enum class ManagedRefEscape : std::uint8_t {
    ActorLocal, Mailbox, Ffi, Global, YieldedBorrow, Unknown
};
enum class ManagedRefAccess : std::uint8_t { Read, Write };
enum class ManagedRefStorage : std::uint8_t { Compressed32, Native64 };
enum class ManagedRefRecycle : std::uint8_t {
    QuarantinePublished, ProvenNoIncoming, UncheckedReuse
};

struct ActorManagedRefMir final {
    ManagedRefOrigin origin = ManagedRefOrigin::Unknown;
    ManagedRefEscape escape = ManagedRefEscape::Unknown;
    ManagedRefAccess access = ManagedRefAccess::Read;
    ManagedRefStorage layout = ManagedRefStorage::Compressed32;
    ManagedRefRecycle recycle = ManagedRefRecycle::UncheckedReuse;
    std::uint64_t actor_region_capacity_bytes = 0;

    // Set by the compiler's ownership/actor-state analysis, not guest code.
    bool inside_actor_critical_state_loan = false;
    bool mutable_loan = false;
    bool loan_crosses_await = false;
    bool untrusted_actor_has_native_ffi = false;
    bool allocation_is_actor_private = false;
    bool typed_provenance_verified = false;
    bool native64_target = false;
};

class VerifiedActorCompressed32 final {
    explicit constexpr VerifiedActorCompressed32(ManagedRefAccess access)
        : access_(access) {}
    ManagedRefAccess access_;
    friend VerifiedActorCompressed32 verify_actor_compressed32(
        const ActorManagedRefMir&);
public:
    ManagedRefAccess access() const noexcept { return access_; }
    static constexpr std::uint32_t storage_bytes = 4;
    static constexpr std::uint32_t alignment_bytes = 8;
};

inline VerifiedActorCompressed32 verify_actor_compressed32(
        const ActorManagedRefMir& source) {
    if (source.access != ManagedRefAccess::Read &&
            source.access != ManagedRefAccess::Write)
        throw std::invalid_argument("unsupported managed reference access mode");
    if (source.origin != ManagedRefOrigin::ActorOwned ||
            !source.allocation_is_actor_private ||
            !source.typed_provenance_verified)
        throw std::invalid_argument(
            "compressed32 requires verified actor-owned reference provenance");
    if (source.escape != ManagedRefEscape::ActorLocal ||
            source.loan_crosses_await || source.untrusted_actor_has_native_ffi)
        throw std::invalid_argument(
            "compressed32 reference may not escape actor turn, await or FFI");
    if (!source.inside_actor_critical_state_loan ||
            (source.access == ManagedRefAccess::Write && !source.mutable_loan))
        throw std::invalid_argument(
            "compressed32 actor state access requires checked critical loan");
    if (source.layout != ManagedRefStorage::Compressed32 || !source.native64_target)
        throw std::invalid_argument(
            "compressed32 scalar ABI requires native64 target and fixed physical layout");
    // Arena capacity is a bounded physical extent, not a 32-GiB reservation.
    // 0 and unrepresentable spans cannot be lowered. The existing actor
    // C slab enforces a stricter 64 MiB admission budget at allocation.
    constexpr std::uint64_t kMaximumSpan = UINT64_C(0xffffffff) * 8;
    if (source.actor_region_capacity_bytes == 0 ||
            source.actor_region_capacity_bytes > kMaximumSpan)
        throw std::invalid_argument("compressed32 actor region exceeds offset span");
    // The current C slab *guarantees* a published compact offset cannot
    // alias another object until arena destruction. Do not accept an
    // aspirational no-incoming-edges proof from an unimplemented pass.
    if (source.recycle != ManagedRefRecycle::QuarantinePublished)
        throw std::invalid_argument(
            "compressed32 requires published-slot quarantine until proof-based recycling exists");
    return VerifiedActorCompressed32(source.access);
}

} // namespace oreslang::backend
