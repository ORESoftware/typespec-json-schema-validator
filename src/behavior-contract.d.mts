export type BehaviorKind =
  | 'expression'
  | 'predicate'
  | 'validator'
  | 'transform'
  | 'policy'
  | 'state_machine'
  | 'algorithm'
  | 'procedure'
  | 'external';

export type BehaviorLanguage = 'cel' | 'cue' | 'rego' | 'dafny' | 'pseudocode' | 'none';
export type BehaviorEffectKind =
  | 'read'
  | 'write'
  | 'emit'
  | 'network'
  | 'clock'
  | 'random'
  | 'storage'
  | 'authz'
  | 'external';

export interface BehaviorInput {
  name: string;
  type: string;
  required: boolean;
}

export interface BehaviorOutput {
  type: string;
  nullable: boolean;
}

export interface BehaviorEffect {
  kind: BehaviorEffectKind;
  resource: string;
}

export interface BehaviorError {
  code: string;
  when: string;
}

export interface EmbeddedBehavior {
  kind: BehaviorKind;
  language: BehaviorLanguage;
  executable: boolean;
  inputs: readonly BehaviorInput[];
  output: Readonly<BehaviorOutput> | null;
  requires: readonly string[];
  ensures: readonly string[];
  invariants: readonly string[];
  expression: string | null;
  algorithm: string | null;
  effects: readonly BehaviorEffect[];
  errors: readonly BehaviorError[];
  deterministic: boolean;
  idempotent: boolean;
  pure: boolean;
}

export interface BehaviorOperation extends EmbeddedBehavior {
  operationId: string;
}

export interface BehaviorContract {
  schema: 'ores.typespec-json-schema-validator.behavior-contract/v1';
  authority: 'independently-authored-behavioral-authority';
  operations: readonly BehaviorOperation[];
}

export declare const BEHAVIOR_CONTRACT_SCHEMA: 'ores.typespec-json-schema-validator.behavior-contract/v1';
export declare const BEHAVIOR_AUTHORITY: 'independently-authored-behavioral-authority';

export declare class BehaviorContractError extends Error {}

export declare function normalizeEmbeddedBehavior(value: unknown): Readonly<EmbeddedBehavior>;
export declare function normalizeBehaviorOperation(value: unknown): Readonly<BehaviorOperation>;
export declare function normalizeBehaviorContract(value: unknown): Readonly<BehaviorContract>;
export declare function behaviorContractDigest(value: unknown): string;
export declare function behaviorByOperation(value: unknown): Map<string, Readonly<BehaviorOperation>>;
