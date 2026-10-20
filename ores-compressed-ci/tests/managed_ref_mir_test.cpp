#include "oreslang/backend/ManagedRefMir.hpp"

#include <cstdint>
#include <initializer_list>
#include <limits>
#include <stdexcept>

using namespace oreslang::backend;

static void require(bool condition) {
    if (!condition) throw std::runtime_error("managed reference MIR regression failed");
}

template<class F>
static void must_reject(F&& fn) {
    bool rejected = false;
    try { fn(); } catch (const std::invalid_argument&) { rejected = true; }
    require(rejected);
}

static ActorManagedRefMir valid_actor_ref(ManagedRefAccess access) {
    ActorManagedRefMir m{};
    m.origin = ManagedRefOrigin::ActorOwned;
    m.escape = ManagedRefEscape::ActorLocal;
    m.access = access;
    m.layout = ManagedRefStorage::Compressed32;
    m.recycle = ManagedRefRecycle::QuarantinePublished;
    m.actor_region_capacity_bytes = 64 * 1024;
    m.inside_actor_critical_state_loan = true;
    m.mutable_loan = access == ManagedRefAccess::Write;
    m.loan_crosses_await = false;
    m.untrusted_actor_has_native_ffi = false;
    m.allocation_is_actor_private = true;
    m.typed_provenance_verified = true;
    m.native64_target = true;
    return m;
}

int main() {
    auto read = valid_actor_ref(ManagedRefAccess::Read);
    auto write = valid_actor_ref(ManagedRefAccess::Write);
    require(verify_actor_compressed32(read).access() == ManagedRefAccess::Read);
    require(verify_actor_compressed32(write).access() == ManagedRefAccess::Write);
    static_assert(VerifiedActorCompressed32::storage_bytes == 4, "ref width regression");

    for (auto forbidden_origin : {ManagedRefOrigin::FrozenShared,
                                  ManagedRefOrigin::ForeignActor,
                                  ManagedRefOrigin::ActorCapability,
                                  ManagedRefOrigin::NativePointer,
                                  ManagedRefOrigin::GuestInteger,
                                  ManagedRefOrigin::Unknown}) {
        auto trial = read;
        trial.origin = forbidden_origin;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    for (auto forbidden_escape : {ManagedRefEscape::Mailbox,
                                  ManagedRefEscape::Ffi,
                                  ManagedRefEscape::Global,
                                  ManagedRefEscape::YieldedBorrow,
                                  ManagedRefEscape::Unknown}) {
        auto trial = read;
        trial.escape = forbidden_escape;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    {
        auto trial = read;
        trial.typed_provenance_verified = false;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    {
        auto trial = read;
        trial.allocation_is_actor_private = false;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    {
        auto trial = read;
        trial.inside_actor_critical_state_loan = false;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    {
        auto trial = write;
        trial.mutable_loan = false;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    {
        auto trial = read;
        trial.loan_crosses_await = true;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    {
        auto trial = read;
        trial.untrusted_actor_has_native_ffi = true;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    {
        auto trial = read;
        trial.layout = ManagedRefStorage::Native64;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    {
        auto trial = read;
        trial.native64_target = false;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    {
        auto trial = read;
        trial.actor_region_capacity_bytes = 0;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
        trial.actor_region_capacity_bytes = std::numeric_limits<std::uint64_t>::max();
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
    for (auto unsafe_recycle : {ManagedRefRecycle::ProvenNoIncoming,
                                ManagedRefRecycle::UncheckedReuse}) {
        auto trial = write;
        trial.recycle = unsafe_recycle;
        must_reject([&] { (void)verify_actor_compressed32(trial); });
    }
}
