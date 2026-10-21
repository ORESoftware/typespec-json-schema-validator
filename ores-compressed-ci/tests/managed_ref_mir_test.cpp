#include "oreslang/backend/ManagedRefMir.hpp"

#include <cstdint>
#include <initializer_list>
#include <limits>
#include <stdexcept>
#include <type_traits>

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
    m.native64_target = true;
    return m;
}

int main() {
    auto read = valid_actor_ref(ManagedRefAccess::Read);
    auto write = valid_actor_ref(ManagedRefAccess::Write);
    require(verify_actor_compressed32(make_test_actor_ref_evidence(read)).access() == ManagedRefAccess::Read);
    require(verify_actor_compressed32(make_test_actor_ref_evidence(write)).access() == ManagedRefAccess::Write);
    static_assert(VerifiedActorCompressed32::storage_bytes == 4, "ref width regression");
    for (std::uint8_t unknown : {std::uint8_t{2}, std::uint8_t{127}, std::uint8_t{255}}) {
        auto invalid_access = read;
        invalid_access.access = static_cast<ManagedRefAccess>(unknown);
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(invalid_access)); });
    }

    for (auto forbidden_origin : {ManagedRefOrigin::FrozenShared,
                                  ManagedRefOrigin::ForeignActor,
                                  ManagedRefOrigin::ActorCapability,
                                  ManagedRefOrigin::NativePointer,
                                  ManagedRefOrigin::GuestInteger,
                                  ManagedRefOrigin::Unknown}) {
        auto trial = read;
        trial.origin = forbidden_origin;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    for (auto forbidden_escape : {ManagedRefEscape::Mailbox,
                                  ManagedRefEscape::Ffi,
                                  ManagedRefEscape::Global,
                                  ManagedRefEscape::YieldedBorrow,
                                  ManagedRefEscape::Unknown}) {
        auto trial = read;
        trial.escape = forbidden_escape;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    static_assert(!std::is_reference<
                      decltype(std::declval<const ActorRefOwnershipEvidence&>().claims())>::value,
                  "ownership evidence getter must not expose an aliased claim");
    {
        const auto evidence = make_test_actor_ref_evidence(read);
        auto detached = evidence.claims();
        detached.origin = ManagedRefOrigin::GuestInteger;
        detached.access = ManagedRefAccess::Write;
        detached.mutable_loan = true;
        require(verify_actor_compressed32(evidence).access() == ManagedRefAccess::Read);
    }
    static_assert(!std::is_default_constructible<ActorRefOwnershipEvidence>::value,
                  "guest code cannot manufacture compiler ownership evidence");
    static_assert(!std::is_constructible<ActorRefOwnershipEvidence,
                                        ActorManagedRefMir>::value,
                  "public MIR data must not authorize compressed references");
    {
        auto mutable_claims = read;
        const auto admitted = make_test_actor_ref_evidence(mutable_claims);
        mutable_claims.origin = ManagedRefOrigin::GuestInteger;
        require(verify_actor_compressed32(admitted).access() == ManagedRefAccess::Read);
        must_reject([&] {
            (void)verify_actor_compressed32(make_test_actor_ref_evidence(mutable_claims));
        });
    }
    {
        auto trial = read;
        trial.allocation_is_actor_private = false;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    {
        auto trial = read;
        trial.inside_actor_critical_state_loan = false;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    {
        auto trial = write;
        trial.mutable_loan = false;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    {
        auto trial = read;
        trial.loan_crosses_await = true;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    {
        auto trial = read;
        trial.untrusted_actor_has_native_ffi = true;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    {
        auto trial = read;
        trial.layout = ManagedRefStorage::Native64;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    {
        auto trial = read;
        trial.native64_target = false;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    {
        auto trial = read;
        trial.actor_region_capacity_bytes = 0;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
        trial.actor_region_capacity_bytes = std::numeric_limits<std::uint64_t>::max();
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
    for (auto unsafe_recycle : {ManagedRefRecycle::ProvenNoIncoming,
                                ManagedRefRecycle::UncheckedReuse}) {
        auto trial = write;
        trial.recycle = unsafe_recycle;
        must_reject([&] { (void)verify_actor_compressed32(make_test_actor_ref_evidence(trial)); });
    }
}
