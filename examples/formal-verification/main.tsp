import "@oresoftware/typespec-json-schema-validator";
using Ores.Behavior;

@behaviorRef("locks.check_ttl")
op check_ttl(ttl_ms: uint64): boolean;
