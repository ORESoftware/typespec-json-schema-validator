import { setTypeSpecNamespace } from '@typespec/compiler';

const BEHAVIOR_STATE = Symbol.for('ores.tjsv.typespec.behavior/v1');
const BEHAVIOR_REF_STATE = Symbol.for('ores.tjsv.typespec.behavior-ref/v1');

/**
 * TypeSpec decorator implementation for `@Ores.Behavior.behavior`.
 * The TypeSpec signature performs structural type checking before this function
 * is called. TJSV's runtime normalizer performs the stronger semantic checks.
 */
export function $behavior(context, target, contract) {
  context.program.stateMap(BEHAVIOR_STATE).set(target, contract);
}

/** Bind a TypeSpec operation to a separately authored behavioral operation ID. */
export function $behaviorRef(context, target, operationId) {
  context.program.stateMap(BEHAVIOR_REF_STATE).set(target, operationId);
}

setTypeSpecNamespace('Ores.Behavior', $behavior, $behaviorRef);

/** Read behavior metadata attached to a TypeSpec operation. */
export function getTypeSpecBehavior(program, operation) {
  return program.stateMap(BEHAVIOR_STATE).get(operation);
}

/** Read the stable behavior authority operation ID attached to a TypeSpec operation. */
export function getTypeSpecBehaviorRef(program, operation) {
  return program.stateMap(BEHAVIOR_REF_STATE).get(operation);
}
