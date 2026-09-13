import "../src/typespec-behavior.mjs";

using TypeSpec.Reflection;

namespace Ores.Behavior;

/** Portable input description used by the behavioral authority. */
model BehaviorInput {
  name: string;
  type: string;
  required: boolean;
}

/** Portable result description used by the behavioral authority. */
model BehaviorOutput {
  type: string;
  nullable: boolean;
}

/** Declared side effect. Pure operations must provide an empty list. */
model BehaviorEffect {
  kind: "read" | "write" | "emit" | "network" | "clock" | "random" | "storage" | "authz" | "external";
  resource: string;
}

/** Stable error code plus the condition under which it may occur. */
model BehaviorError {
  code: string;
  when: string;
}

/**
 * Typed TypeSpec view of `behavior-contract/v1` payloads.
 *
 * Runtime semantic invariants (for example pure => no effects) are enforced by
 * TJSV's behavior-contract normalizer in addition to this structural typing.
 */
model BehaviorMetadata {
  kind: "expression" | "predicate" | "validator" | "transform" | "policy" | "state_machine" | "algorithm" | "procedure" | "external";
  language: "cel" | "cue" | "rego" | "dafny" | "pseudocode" | "none";
  executable: boolean;
  inputs: BehaviorInput[];
  output: BehaviorOutput | null;
  requires: string[];
  ensures: string[];
  invariants: string[];
  expression: string | null;
  algorithm: string | null;
  effects: BehaviorEffect[];
  errors: BehaviorError[];
  deterministic: boolean;
  idempotent: boolean;
  pure: boolean;
}

/**
 * Attach the normalized behavioral payload directly to an operation.
 * Emitters may project this as OpenAPI `x-ores-behavior`; other transports may
 * carry only `@behaviorRef` and resolve the canonical body separately.
 */
extern dec behavior(target: Operation, contract: valueof BehaviorMetadata);

/**
 * Bind an operation to a separately authored behavioral authority by stable ID.
 * This is the preferred shape for Protobuf custom method options so CEL/Dafny
 * source is not duplicated into every transport projection.
 */
extern dec behaviorRef(target: Operation, operationId: valueof string);
