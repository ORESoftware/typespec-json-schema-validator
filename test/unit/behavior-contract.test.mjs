import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BEHAVIOR_AUTHORITY,
  BEHAVIOR_CONTRACT_SCHEMA,
  BehaviorContractError,
  behaviorByOperation,
  behaviorContractDigest,
  normalizeBehaviorContract,
  normalizeEmbeddedBehavior,
} from '../../src/behavior-contract.mjs';

function discountBehavior(overrides = {}) {
  return {
    kind: 'expression',
    language: 'cel',
    executable: true,
    inputs: [
      { name: 'age', type: 'int32', required: true },
      { name: 'loyalty_years', type: 'int32', required: true },
    ],
    output: { type: 'float32', nullable: false },
    requires: ['age >= 0', 'loyalty_years >= 0'],
    ensures: ['result >= 0.0', 'result <= 1.0'],
    invariants: [],
    expression: 'age >= 65 ? 0.20 : loyalty_years > 5 ? 0.10 : 0.0',
    algorithm: null,
    effects: [],
    errors: [],
    deterministic: true,
    idempotent: true,
    pure: true,
    ...overrides,
  };
}

function contract(operations) {
  return {
    schema: BEHAVIOR_CONTRACT_SCHEMA,
    authority: BEHAVIOR_AUTHORITY,
    operations,
  };
}

test('normalizes a CEL behavior contract and indexes operations deterministically', () => {
  const normalized = normalizeBehaviorContract(contract([
    { operationId: 'zeta', ...discountBehavior() },
    { operationId: 'calculate_discount', ...discountBehavior() },
  ]));

  assert.deepEqual(normalized.operations.map((item) => item.operationId), [
    'calculate_discount',
    'zeta',
  ]);
  assert.equal(behaviorByOperation(normalized).get('calculate_discount')?.pure, true);
  assert.match(behaviorContractDigest(normalized), /^[a-f0-9]{64}$/u);
});

test('normalizes the payload form used by TypeSpec/OpenAPI/Protobuf adapters', () => {
  const normalized = normalizeEmbeddedBehavior(discountBehavior());
  assert.equal(normalized.language, 'cel');
  assert.equal(normalized.expression, 'age >= 65 ? 0.20 : loyalty_years > 5 ? 0.10 : 0.0');
});

test('rejects duplicate operation IDs', () => {
  assert.throws(
    () => normalizeBehaviorContract(contract([
      { operationId: 'calculate_discount', ...discountBehavior() },
      { operationId: 'calculate_discount', ...discountBehavior() },
    ])),
    BehaviorContractError,
  );
});

test('rejects pure behavior with side effects', () => {
  assert.throws(
    () => normalizeBehaviorContract(contract([
      {
        operationId: 'calculate_discount',
        ...discountBehavior({ effects: [{ kind: 'network', resource: 'pricing-api' }] }),
      },
    ])),
    /pure behavior cannot declare effects/u,
  );
});

test('rejects non-executable languages that claim executable behavior', () => {
  assert.throws(
    () => normalizeEmbeddedBehavior(discountBehavior({ language: 'pseudocode' })),
    /executable cannot be true for pseudocode/u,
  );
});

test('requires expression bodies for expression-like behavior', () => {
  assert.throws(
    () => normalizeEmbeddedBehavior(discountBehavior({ expression: null })),
    /expression is required for expression/u,
  );
});

test('requires algorithm bodies for procedures and state machines', () => {
  const procedure = discountBehavior({
    kind: 'procedure',
    language: 'dafny',
    expression: null,
    algorithm: 'if age >= 65 { return 0.20; } return 0.0;',
    pure: false,
    effects: [{ kind: 'read', resource: 'request.age' }],
  });
  assert.equal(normalizeEmbeddedBehavior(procedure).kind, 'procedure');
  assert.throws(
    () => normalizeEmbeddedBehavior({ ...procedure, algorithm: null }),
    /algorithm is required for procedure/u,
  );
});

test('rejects unexpected metadata so behavior cannot silently drift', () => {
  assert.throws(
    () => normalizeEmbeddedBehavior({ ...discountBehavior(), implementation: 'trust me' }),
    /must contain exactly/u,
  );
});
