#pragma once

#include "oreslang/backend/ManagedRefMir.hpp"
#include "oreslang/types/CriticalHandleStateContract.hpp"
#include "oreslang/types/OwnershipCfg.hpp"

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>

namespace oreslang::backend {

/*
 * Production compiler authority for compact actor-local references.
 *
 * Callers do not submit ActorManagedRefMir claims. Instead this verifier
 * consumes the compiler's ownership CFG and the sealed critical-state
 * callback contract, re-runs both analyses, and derives the exact MIR claims
 * that are permitted to cross into compressed32 codegen.
 *
 * This is intentionally narrower than the general handle_state contract:
 * compact references cannot survive suspension or FFI in this milestone.
 * Source Ref<T> parsing/lowering remains a separate frontend integration gate.
 */
class ActorRefOwnershipVerifier final {
public:
    static ActorRefOwnershipEvidence issue_from_verified_state_loan(
            const ownership::Graph& graph,
            std::size_t loan_block,
            const std::string& place,
            const CriticalStateCallback& callback,
            FunctionEffects declared_effects,
            ManagedRefAccess access,
            std::uint64_t actor_region_capacity_bytes,
            bool native64_target,
            bool verified_serial_actor = false) {
        const auto admission = admit_critical_handle_state(
            callback, declared_effects, verified_serial_actor);
        if (admission != CriticalStateAdmission::Accept)
            throw std::invalid_argument(
                "compact32 ownership evidence requires admitted critical state callback");

        // The generic state contract can segment and reacquire across suspend,
        // but compact Ref<T> lifetime lowering has not proved that boundary yet.
        // Likewise, FFI is a native-pointer escape boundary.
        if (callback.inferred.has(FunctionEffect::Suspend) ||
                callback.inferred.has(FunctionEffect::Ffi))
            throw std::invalid_argument(
                "compact32 ownership evidence forbids suspension and FFI");

        if (access == ManagedRefAccess::Read) {
            if (!callback.inferred.has(FunctionEffect::StateRead))
                throw std::invalid_argument(
                    "compact32 read evidence requires state.read effect");
        } else if (access == ManagedRefAccess::Write) {
            if (!callback.inferred.has(FunctionEffect::StateWrite))
                throw std::invalid_argument(
                    "compact32 write evidence requires state.write effect");
        } else {
            throw std::invalid_argument("unsupported compact32 access mode");
        }

        const auto analysis = ownership::verify(graph);
        if (loan_block >= analysis.incoming.size() ||
                !analysis.incoming[loan_block])
            throw std::invalid_argument(
                "compact32 ownership evidence requires reachable loan block");

        const auto found = analysis.incoming[loan_block]->find(place);
        if (found == analysis.incoming[loan_block]->end() ||
                found->second.possible != ownership::kOwned)
            throw std::invalid_argument(
                "compact32 ownership evidence requires definitely owned place");

        const auto& state = found->second;
        if (access == ManagedRefAccess::Write) {
            if (!state.exclusive_loan || state.shared_loans != 0 ||
                    !state.exclusive_loan_id.has_value())
                throw std::invalid_argument(
                    "compact32 write evidence requires live exclusive state loan");
        } else {
            const bool shared =
                state.shared_loans != 0 &&
                state.shared_loans == state.shared_loan_ids.size();
            const bool exclusive =
                state.exclusive_loan && state.exclusive_loan_id.has_value();
            if (!shared && !exclusive)
                throw std::invalid_argument(
                    "compact32 read evidence requires live state loan");
        }

        ActorManagedRefMir claims;
        claims.origin = ManagedRefOrigin::ActorOwned;
        claims.escape = ManagedRefEscape::ActorLocal;
        claims.access = access;
        claims.layout = ManagedRefStorage::Compressed32;
        claims.recycle = ManagedRefRecycle::QuarantinePublished;
        claims.actor_region_capacity_bytes = actor_region_capacity_bytes;
        claims.inside_actor_critical_state_loan = true;
        claims.mutable_loan = access == ManagedRefAccess::Write;
        claims.loan_crosses_await = false;
        claims.untrusted_actor_has_native_ffi = false;
        claims.allocation_is_actor_private = true;
        claims.native64_target = native64_target;

        ActorRefOwnershipEvidence evidence(claims);
        // Keep the final backend admission check authoritative as invariants
        // evolve; the issuer cannot accidentally bypass a newer MIR rule.
        (void)verify_actor_compressed32(evidence);
        return evidence;
    }
};

} // namespace oreslang::backend
