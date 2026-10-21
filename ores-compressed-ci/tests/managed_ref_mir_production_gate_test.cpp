#include "oreslang/backend/ManagedRefMir.hpp"

#include <type_traits>

using namespace oreslang::backend;

// Compiled without ORESLANG_COMPRESSED32_TEST_PROVENANCE. Public guest/MIR
// data cannot manufacture the codegen capability; a future verified actor
// ownership pass must issue it before backend lowering becomes reachable.
static_assert(!std::is_default_constructible<ActorRefOwnershipEvidence>::value,
              "compact references require ownership evidence");
static_assert(!std::is_constructible<ActorRefOwnershipEvidence,
                                     ActorManagedRefMir>::value,
              "source MIR is not an ownership proof");
static_assert(!std::is_convertible<ActorManagedRefMir,
                                   ActorRefOwnershipEvidence>::value,
              "source claims cannot implicitly authorize compact references");
static_assert(!std::is_constructible<VerifiedActorCompressed32,
                                     ManagedRefAccess>::value,
              "backend compressed reference must only follow verification");
int main() {}
