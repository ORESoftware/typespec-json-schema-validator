#include "oreslang/backend/ActorRefOwnershipVerifier.hpp"

#include <cstdint>
#include <stdexcept>

using namespace oreslang;
using namespace oreslang::backend;

#define CHECK(cond) do { if (!(cond)) throw std::runtime_error("failed: " #cond); } while (false)

static constexpr std::uint32_t READ =
    static_cast<std::uint32_t>(FunctionEffect::StateRead);
static constexpr std::uint32_t WRITE =
    static_cast<std::uint32_t>(FunctionEffect::StateWrite);
static constexpr std::uint32_t SUSPEND =
    static_cast<std::uint32_t>(FunctionEffect::Suspend);
static constexpr std::uint32_t FFI =
    static_cast<std::uint32_t>(FunctionEffect::Ffi);

static ownership::Graph loan_graph(bool exclusive) {
    ownership::Graph graph;
    graph.entry.emplace("state.root",
        ownership::PlaceState{ownership::kOwned});
    ownership::BasicBlock acquire;
    acquire.operations.emplace_back(
        exclusive ? ownership::Operation::Kind::BorrowExclusive
                  : ownership::Operation::Kind::BorrowShared,
        "state.root", UINT64_C(77));
    acquire.successors.push_back(1);
    ownership::BasicBlock release;
    release.operations.emplace_back(
        exclusive ? ownership::Operation::Kind::ReleaseExclusive
                  : ownership::Operation::Kind::ReleaseShared,
        "state.root", UINT64_C(77));
    graph.blocks.push_back(std::move(acquire));
    graph.blocks.push_back(std::move(release));
    return graph;
}

static ownership::Graph no_loan_graph() {
    ownership::Graph graph;
    graph.entry.emplace("state.root",
        ownership::PlaceState{ownership::kOwned});
    ownership::BasicBlock first;
    first.successors.push_back(1);
    graph.blocks.push_back(std::move(first));
    graph.blocks.emplace_back();
    return graph;
}

static CriticalStateCallback callback(std::uint32_t effects) {
    CriticalStateCallback c{};
    c.callback_critical = true;
    c.one_state_parameter = true;
    c.inferred = FunctionEffects{effects};
    return c;
}

template <typename F>
static void rejects(F&& fn) {
    bool rejected = false;
    try {
        fn();
    } catch (const std::exception&) {
        rejected = true;
    }
    CHECK(rejected);
}

int main() {
    constexpr std::uint64_t REGION = UINT64_C(64) * 1024 * 1024;

    {
        const auto graph = loan_graph(false);
        const auto c = callback(READ);
        const auto evidence =
            ActorRefOwnershipVerifier::issue_from_verified_state_loan(
                graph, 1, "state.root", c, FunctionEffects{READ},
                ManagedRefAccess::Read, REGION, true);
        CHECK(verify_actor_compressed32(evidence).access()
              == ManagedRefAccess::Read);
        const auto claims = evidence.claims();
        CHECK(claims.origin == ManagedRefOrigin::ActorOwned);
        CHECK(claims.escape == ManagedRefEscape::ActorLocal);
        CHECK(claims.inside_actor_critical_state_loan);
        CHECK(!claims.mutable_loan);
        CHECK(claims.recycle == ManagedRefRecycle::QuarantinePublished);
    }

    {
        const auto graph = loan_graph(true);
        const auto c = callback(READ | WRITE);
        const auto evidence =
            ActorRefOwnershipVerifier::issue_from_verified_state_loan(
                graph, 1, "state.root", c, FunctionEffects{READ | WRITE},
                ManagedRefAccess::Write, REGION, true);
        CHECK(verify_actor_compressed32(evidence).access()
              == ManagedRefAccess::Write);
        CHECK(evidence.claims().mutable_loan);
    }

    // A shared read loan cannot be upgraded into compact write authority.
    rejects([&] {
        const auto graph = loan_graph(false);
        const auto c = callback(READ | WRITE);
        (void)ActorRefOwnershipVerifier::issue_from_verified_state_loan(
            graph, 1, "state.root", c, FunctionEffects{READ | WRITE},
            ManagedRefAccess::Write, REGION, true);
    });

    // Ownership must be live at the exact CFG point where authority is issued.
    rejects([&] {
        const auto graph = no_loan_graph();
        const auto c = callback(READ);
        (void)ActorRefOwnershipVerifier::issue_from_verified_state_loan(
            graph, 1, "state.root", c, FunctionEffects{READ},
            ManagedRefAccess::Read, REGION, true);
    });

    // Generic handle_state admission rejects escaped state capabilities.
    rejects([&] {
        const auto graph = loan_graph(false);
        auto c = callback(READ);
        c.escapes = true;
        (void)ActorRefOwnershipVerifier::issue_from_verified_state_loan(
            graph, 1, "state.root", c, FunctionEffects{READ},
            ManagedRefAccess::Read, REGION, true);
    });

    // Even a generation-fenced suspendable callback is too broad for the
    // current compact-reference lifetime proof.
    rejects([&] {
        const auto graph = loan_graph(false);
        auto c = callback(READ | SUSPEND);
        c.continuation_generation_fenced = true;
        (void)ActorRefOwnershipVerifier::issue_from_verified_state_loan(
            graph, 1, "state.root", c, FunctionEffects{READ | SUSPEND},
            ManagedRefAccess::Read, REGION, true);
    });

    // FFI is a native-pointer escape boundary and cannot mint compact refs.
    rejects([&] {
        const auto graph = loan_graph(false);
        const auto c = callback(READ | FFI);
        (void)ActorRefOwnershipVerifier::issue_from_verified_state_loan(
            graph, 1, "state.root", c, FunctionEffects{READ | FFI},
            ManagedRefAccess::Read, REGION, true);
    });

    // Physical-layout preconditions remain enforced by final MIR admission.
    rejects([&] {
        const auto graph = loan_graph(false);
        const auto c = callback(READ);
        (void)ActorRefOwnershipVerifier::issue_from_verified_state_loan(
            graph, 1, "state.root", c, FunctionEffects{READ},
            ManagedRefAccess::Read, 0, true);
    });
    rejects([&] {
        const auto graph = loan_graph(false);
        const auto c = callback(READ);
        (void)ActorRefOwnershipVerifier::issue_from_verified_state_loan(
            graph, 1, "state.root", c, FunctionEffects{READ},
            ManagedRefAccess::Read, REGION, false);
    });

    return 0;
}
