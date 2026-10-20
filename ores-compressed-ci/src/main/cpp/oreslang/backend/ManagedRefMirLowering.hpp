#pragma once

#include "oreslang/backend/ManagedRefMir.hpp"

#include <cstdint>
#include <stdexcept>

#include "llvm/IR/BasicBlock.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Type.h"

namespace oreslang::backend {

/*
 * Scalar C ABI bridge. Unlike a GEP with a caller-supplied "trusted live" i1,
 * these operations authenticate the actor turn, heap domain, publication,
 * allocation-start/liveness and bounds INSIDE the real ActorArena.c runtime.
 * Codegen must also pass a verified MIR from the ownership checker.
 *
 * No LLVM struct-by-value ABI assumptions, guest native pointer casts,
 * inttoptr, ptrtoint or FFI pointer conversions are involved.
 */
struct ActorCompactRuntimeContext {
    llvm::Value* actor_arena = nullptr; // authenticated host-internal pointer
    llvm::Value* actor_domain = nullptr; // runtime-issued domain
    llvm::Value* actor_epoch = nullptr; // physical carrier turn
};

inline llvm::Module* validate_actor_compact_context(
        llvm::IRBuilder<>& ir, const ActorCompactRuntimeContext& context) {
    if (!ir.GetInsertBlock() || !ir.GetInsertBlock()->getParent())
        throw std::invalid_argument("compact32 lowering requires a function and insert block");
    llvm::Module* module = ir.GetInsertBlock()->getModule();
    if (!module || module->getDataLayout().getPointerSizeInBits(0) != 64)
        throw std::invalid_argument("compact32 native C ABI requires 64-bit pointers");
    auto* i64 = llvm::Type::getInt64Ty(ir.getContext());
    if (!context.actor_arena || !context.actor_arena->getType()->isPointerTy() ||
            context.actor_arena->getType()->getPointerAddressSpace() != 0 ||
            !context.actor_domain || context.actor_domain->getType() != i64 ||
            !context.actor_epoch || context.actor_epoch->getType() != i64)
        throw std::invalid_argument("compact32 runtime context has invalid LLVM types");
    return module;
}

inline llvm::Value* lower_actor_compact_i64_publish(
        llvm::IRBuilder<>& ir, VerifiedActorCompressed32 verified,
        const ActorCompactRuntimeContext& context,
        llvm::Value* slot_index, llvm::Value* allocation_generation) {
    // Ref publication is a lifetime change: it must be performed under a
    // verified mutating state loan, before writing the resulting bits into
    // any guest-visible heap field. The C runtime permanently quarantines
    // that slot after drop to prevent ABA reuse.
    if (verified.access() != ManagedRefAccess::Write)
        throw std::invalid_argument("publishing compact32 references requires mutable state loan");
    auto* module = validate_actor_compact_context(ir, context);
    auto* i64 = llvm::Type::getInt64Ty(ir.getContext());
    auto* i32 = llvm::Type::getInt32Ty(ir.getContext());
    if (!slot_index || slot_index->getType() != i64 ||
            !allocation_generation || allocation_generation->getType() != i64)
        throw std::invalid_argument("compact32 publication requires checked i64 slot identity");
    auto* ptr = context.actor_arena->getType();
    const auto callee = module->getOrInsertFunction(
        "ores_actor_arena_compact_publish_i32",
        llvm::FunctionType::get(i32, {ptr, i64, i64, i64, i64}, false));
    return ir.CreateCall(callee, {context.actor_arena, context.actor_domain,
                                  context.actor_epoch, slot_index, allocation_generation},
                         "actor.compact32.published");
}

inline llvm::Value* lower_actor_compact_i64_read(
        llvm::IRBuilder<>& ir, VerifiedActorCompressed32 /*verified*/,
        const ActorCompactRuntimeContext& context,
        llvm::Value* stored_ref32, std::uint64_t byte_offset) {
    auto* module = validate_actor_compact_context(ir, context);
    auto* i64 = llvm::Type::getInt64Ty(ir.getContext());
    auto* i32 = llvm::Type::getInt32Ty(ir.getContext());
    if (!stored_ref32 || stored_ref32->getType() != i32)
        throw std::invalid_argument("compact32 read requires exactly i32 storage, not native pointer/i64");
    if (byte_offset > UINT64_MAX - sizeof(std::uint64_t))
        throw std::invalid_argument("compact32 field access overflows uint64 range");
    auto* ptr = context.actor_arena->getType();
    const auto callee = module->getOrInsertFunction(
        "ores_actor_arena_compact_load_i64",
        llvm::FunctionType::get(i64, {ptr, i64, i64, i32, i64}, false));
    return ir.CreateCall(callee, {context.actor_arena, context.actor_domain,
                                  context.actor_epoch, stored_ref32,
                                  llvm::ConstantInt::get(i64, byte_offset)},
                         "actor.compact32.field");
}

inline void lower_actor_compact_i64_write(
        llvm::IRBuilder<>& ir, VerifiedActorCompressed32 verified,
        const ActorCompactRuntimeContext& context,
        llvm::Value* stored_ref32, std::uint64_t byte_offset,
        llvm::Value* new_value) {
    if (verified.access() != ManagedRefAccess::Write)
        throw std::invalid_argument("compact32 write requires verified mutable critical loan");
    auto* module = validate_actor_compact_context(ir, context);
    auto* i64 = llvm::Type::getInt64Ty(ir.getContext());
    auto* i32 = llvm::Type::getInt32Ty(ir.getContext());
    if (!stored_ref32 || stored_ref32->getType() != i32 ||
            !new_value || new_value->getType() != i64)
        throw std::invalid_argument("compact32 write requires i32 ref and i64 field value");
    if (byte_offset > UINT64_MAX - sizeof(std::uint64_t))
        throw std::invalid_argument("compact32 field write offset overflows uint64 range");
    auto* ptr = context.actor_arena->getType();
    const auto callee = module->getOrInsertFunction(
        "ores_actor_arena_compact_store_i64",
        llvm::FunctionType::get(llvm::Type::getVoidTy(ir.getContext()),
                                {ptr, i64, i64, i32, i64, i64}, false));
    ir.CreateCall(callee, {context.actor_arena, context.actor_domain,
                           context.actor_epoch, stored_ref32,
                           llvm::ConstantInt::get(i64, byte_offset), new_value});
}

} // namespace oreslang::backend
