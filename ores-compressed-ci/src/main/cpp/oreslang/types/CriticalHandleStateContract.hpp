#pragma once

#include "oreslang/types/FunctionEffects.hpp"

#include <cstdint>

namespace oreslang {

/**
 * Native admission ABI for the sealed critical handle_state intrinsic.
 * LLVM has no full guest actor-state codegen yet. This is a shared semantic
 * contract, not a claim that actor-state guest source compiles to LLVM.
 */
enum class CriticalStateAdmission : std::uint8_t {
    Accept,
    MissingIntrinsicCritical,
    MissingCallbackCritical,
    InvalidStateCallback,
    CallbackEscape,
    EffectExceedsUsing,
    LoanAcrossSuspension,
    MissingContinuationFence,
    ScopeDenied
};

struct CriticalStateCallback {
    bool intrinsic_critical = true;  // sealed runtime intrinsic
    bool callback_critical = false;
    bool lexical = true;
    bool one_state_parameter = false;
    bool escapes = false;
    bool state_loan_live_across_suspend = false;
    bool continuation_generation_fenced = false;
    FunctionEffects inferred{};
};

inline CriticalStateAdmission admit_critical_handle_state(
        const CriticalStateCallback& callback,
        FunctionEffects using_effects,
        bool verified_serial_actor = false) noexcept {
    if (!callback.intrinsic_critical) return CriticalStateAdmission::MissingIntrinsicCritical;
    // The serial privilege comes from a trusted actor declaration + scheduler,
    // never from callback metadata supplied by guest code.
    if (!callback.callback_critical && !verified_serial_actor)
        return CriticalStateAdmission::MissingCallbackCritical;
    if (!callback.lexical || !callback.one_state_parameter) {
        return CriticalStateAdmission::InvalidStateCallback;
    }
    if (callback.escapes) return CriticalStateAdmission::CallbackEscape;
    if (!using_effects.permits(callback.inferred)) {
        return CriticalStateAdmission::EffectExceedsUsing;
    }
    if (callback.inferred.has(FunctionEffect::Suspend)) {
        // A state-backed loan may not cross a yielding reduction boundary.
        // The callback resumes only on a generation-fenced re-admitted turn.
        if (callback.state_loan_live_across_suspend) {
            return CriticalStateAdmission::LoanAcrossSuspension;
        }
        if (!callback.continuation_generation_fenced) {
            return CriticalStateAdmission::MissingContinuationFence;
        }
    }
    return CriticalStateAdmission::Accept;
}

} // namespace oreslang
