#include "oreslang/backend/ManagedRefMirLowering.hpp"

#include <initializer_list>
#include <stdexcept>
#include <string>

#include "llvm/IR/Constants.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"
#include "llvm/Support/raw_ostream.h"

using namespace oreslang::backend;

static void require(bool ok, const char* error) {
    if (!ok) throw std::runtime_error(error);
}
template<class F>
static void rejects(F&& fn, const char* why) {
    bool refused = false;
    try { fn(); } catch (const std::invalid_argument&) { refused = true; }
    require(refused, why);
}

static ActorManagedRefMir checked_mir(ManagedRefAccess access) {
    ActorManagedRefMir mir{};
    mir.origin = ManagedRefOrigin::ActorOwned;
    mir.escape = ManagedRefEscape::ActorLocal;
    mir.access = access;
    mir.layout = ManagedRefStorage::Compressed32;
    mir.recycle = ManagedRefRecycle::QuarantinePublished;
    mir.actor_region_capacity_bytes = 1024 * 1024;
    mir.inside_actor_critical_state_loan = true;
    mir.mutable_loan = access == ManagedRefAccess::Write;
    mir.allocation_is_actor_private = true;
    mir.native64_target = true;
    return mir;
}

int main(int argc, char** argv) {
    const bool emit_ir = argc == 2 && std::string(argv[1]) == "--emit-ir";
    if (argc > 1 && !emit_ir)
        throw std::invalid_argument("only --emit-ir is supported");

    llvm::LLVMContext context;
    llvm::Module module("oreslang.compact32.verified.actor.mir", context);
    module.setDataLayout("e-m:e-p:64:64-i64:64-n8:16:32:64-S128");
    auto* i8 = llvm::Type::getInt8Ty(context);
    auto* i32 = llvm::Type::getInt32Ty(context);
    auto* i64 = llvm::Type::getInt64Ty(context);
    auto* ptr = llvm::PointerType::get(i8, 0);

    // An actor compiler-generated handler: arena/domain/epoch come from the
    // runtime's admitted actor turn, not arbitrary mailbox arguments.
    auto* read = llvm::Function::Create(llvm::FunctionType::get(
        i64, {ptr, i64, i64, i32}, false),
        llvm::GlobalValue::ExternalLinkage, "checked_actor_read", module);
    auto args = read->arg_begin();
    ActorCompactRuntimeContext actor_context{
        &*args++, &*args++, &*args++
    };
    llvm::Value* compact32 = &*args++;
    llvm::IRBuilder<> ir(llvm::BasicBlock::Create(context, "entry", read));
    const auto read_plan = verify_actor_compressed32(make_test_actor_ref_evidence(checked_mir(ManagedRefAccess::Read)));
    llvm::Value* value = lower_actor_compact_i64_read(
        ir, read_plan, actor_context, compact32, 0);
    ir.CreateRet(value);
    require(!llvm::verifyFunction(*read, &llvm::errs()), "read LLVM verifier failed");

    // A mutable critical loan publishes a new actor-owned offset, then uses
    // the resulting i32 for checked field access. No C aggregate ABI or raw
    // native pointer can be smuggled through the generated signature.
    auto* write = llvm::Function::Create(llvm::FunctionType::get(
        i32, {ptr, i64, i64, i64, i64, i64}, false),
        llvm::GlobalValue::ExternalLinkage, "checked_actor_publish_write", module);
    args = write->arg_begin();
    ActorCompactRuntimeContext mutable_context{
        &*args++, &*args++, &*args++
    };
    auto* index = &*args++;
    auto* generation = &*args++;
    auto* next_value = &*args++;
    llvm::IRBuilder<> mutable_ir(llvm::BasicBlock::Create(context, "entry", write));
    const auto write_plan = verify_actor_compressed32(make_test_actor_ref_evidence(checked_mir(ManagedRefAccess::Write)));
    auto* stored = lower_actor_compact_i64_publish(
        mutable_ir, write_plan, mutable_context, index, generation);
    lower_actor_compact_i64_write(
        mutable_ir, write_plan, mutable_context, stored, 0, next_value);
    mutable_ir.CreateRet(stored);
    require(!llvm::verifyFunction(*write, &llvm::errs()), "write LLVM verifier failed");

    rejects([&] {
        lower_actor_compact_i64_publish(
            mutable_ir, read_plan, mutable_context, index, generation);
    }, "read-only loan published compact slot");
    rejects([&] {
        lower_actor_compact_i64_write(
            mutable_ir, read_plan, mutable_context, stored, 0, next_value);
    }, "read-only loan wrote compact object");
    rejects([&] {
        (void)lower_actor_compact_i64_read(
            mutable_ir, write_plan, mutable_context, next_value, 0);
    }, "i64 data integer silently became an i32 actor reference");

    require(!llvm::verifyModule(module, &llvm::errs()), "actor MIR module verifier failed");
    std::string output;
    llvm::raw_string_ostream rendered(output);
    module.print(rendered, nullptr);
    rendered.flush();
    require(output.find("@ores_actor_arena_compact_publish_i32") != std::string::npos,
            "LLVM publish function not linked to checked C actor runtime");
    require(output.find("@ores_actor_arena_compact_load_i64") != std::string::npos,
            "LLVM load function not linked to checked C actor runtime");
    require(output.find("@ores_actor_arena_compact_store_i64") != std::string::npos,
            "LLVM store function not linked to checked C actor runtime");
    require(output.find("actor.compact32.published") != std::string::npos,
            "LLVM storage type was not compiler-generated i32");
    require(output.find("getelementptr") == std::string::npos &&
            output.find("ptrtoint") == std::string::npos &&
            output.find("inttoptr") == std::string::npos,
            "LLVM bypassed runtime-mediated actor-provenance access");
    // The compiler may encounter a user or dependency symbol before it
    // declares its own runtime ABI. Refuse incompatible signatures, and
    // refuse same-signature preexisting non-compiler declarations.
    for (const char* symbol : {
            "ores_actor_arena_compact_publish_i32",
            "ores_actor_arena_compact_load_i64",
            "ores_actor_arena_compact_store_i64"}) {
        llvm::Module collision("actor.runtime.declaration.collision", context);
        auto* bad_sig = llvm::FunctionType::get(i64, {}, false);
        llvm::Function::Create(bad_sig, llvm::GlobalValue::ExternalLinkage,
                               symbol, collision);
        rejects([&] {
            (void) actor_checked_runtime_decl(
                &collision, symbol, llvm::FunctionType::get(i32, {ptr}, false));
        }, "existing invalid compact32 ABI was admitted");

        llvm::Module same_sig("actor.runtime.existing.external", context);
        auto* signature = llvm::FunctionType::get(i32, {ptr, i64}, false);
        llvm::Function::Create(signature, llvm::GlobalValue::ExternalLinkage,
                               symbol, same_sig);
        rejects([&] {
            (void) actor_checked_runtime_decl(&same_sig, symbol, signature);
        }, "external function declaration impersonated compiler runtime declaration");

        llvm::Module correct("actor.runtime.checked", context);
        (void) actor_checked_runtime_decl(&correct, symbol, signature);
        (void) actor_checked_runtime_decl(&correct, symbol, signature);
        auto* marked = correct.getFunction(symbol);
        marked->addFnAttr(llvm::Attribute::NoUnwind);
        rejects([&] { (void) actor_checked_runtime_decl(&correct, symbol, signature); }, "extra function attribute permitted");
        marked->removeFnAttr(llvm::Attribute::NoUnwind);
        marked->addRetAttr(llvm::Attribute::NoUndef);
        rejects([&] { (void) actor_checked_runtime_decl(&correct, symbol, signature); }, "extra return attribute permitted");
        marked->removeRetAttr(llvm::Attribute::NoUndef);
        marked->addParamAttr(0, llvm::Attribute::NonNull);
        rejects([&] { (void) actor_checked_runtime_decl(&correct, symbol, signature); }, "extra parameter attribute permitted");
        marked->removeParamAttr(0, llvm::Attribute::NonNull);
        marked->addParamAttr(1, llvm::Attribute::NoUndef);
        rejects([&] { (void) actor_checked_runtime_decl(&correct, symbol, signature); }, "scalar parameter attribute accepted");
        marked->removeParamAttr(1, llvm::Attribute::NoUndef);
        auto* body = llvm::BasicBlock::Create(context, "entry", marked);
        llvm::IRBuilder<> define(body);
        define.CreateRet(llvm::ConstantInt::get(i32, 0));
        rejects([&] {
            (void) actor_checked_runtime_decl(&correct, symbol, signature);
        }, "function body replaced a protected external runtime declaration");
    }

    if (emit_ir)
        module.print(llvm::outs(), nullptr); // clang compiles this checked IR against REAL ActorArena.c
}
