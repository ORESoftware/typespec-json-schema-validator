import type { Operation, Program } from '@typespec/compiler';
import type { EmbeddedBehavior } from './behavior-contract.mjs';

/** TypeSpec decorator implementation symbol for `@Ores.Behavior.behavior`. */
export declare function $behavior(context: unknown, target: Operation, contract: EmbeddedBehavior): void;

/** TypeSpec decorator implementation symbol for `@Ores.Behavior.behaviorRef`. */
export declare function $behaviorRef(context: unknown, target: Operation, operationId: string): void;

/** Return behavior metadata attached to a TypeSpec operation, if any. */
export declare function getTypeSpecBehavior(
  program: Program,
  operation: Operation,
): EmbeddedBehavior | undefined;

/** Return the stable behavioral-authority operation ID attached to a TypeSpec operation, if any. */
export declare function getTypeSpecBehaviorRef(
  program: Program,
  operation: Operation,
): string | undefined;
