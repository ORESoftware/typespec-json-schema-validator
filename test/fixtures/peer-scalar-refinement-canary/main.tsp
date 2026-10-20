// Entirely independently authored PUBLIC, synthetic TypeSpec canary.
import "@typespec/json-schema";
using TypeSpec.JsonSchema;
namespace Canary.Refinement;

@id("RetryLimit")
@minValue(2)
@maxValue(500)
scalar RetryLimit extends int32;

@id("AliasLabel")
@minLength(2)
@maxLength(48)
scalar AliasLabel extends string;
