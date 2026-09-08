# Fail-closed library finding budgets

Recovery follow-up to issue #20 and DEN-3828.

`maxFindings` is an evidence-display budget, not permission to skip validation
and return an empty result. `deepDiff`, `compareParity`, and `crossValidate`
now reject invalid explicit budgets with `RangeError` before their comparison
loops. This protects JavaScript library consumers as well as CLI users; the
CLI already required an integer from 1 through 10000.

## Contract

- A supplied budget must be a JavaScript number, a safe integer, and between
  1 and 10000 inclusive. No string, boolean, object, bigint, or symbol coercion
  is performed. Zero, negative values, fractions, NaN and infinities are errors.
- An omitted or undefined budget retains the existing default of 250.
- `deepDiff` retains its existing nullish-default behavior: explicit null means
  250 there. `compareParity` and `crossValidate` reject explicit null, which
  previously became a zero-like limit rather than their default.
- A valid positive budget still retains mismatch evidence and does not alter
  either authored input. The cap does not imply universal equivalence or
  replace the exact-input receipt and Contract IR admission checks.

Before this fix, zero-like limits could prevent a real type mismatch from
being compared, or truncate emitted diagnostics to an empty array. Non-finite
limits could also bypass intended bounds. Callers must treat argument errors
as failed evaluation, never synthesize a passed receipt after catching one.

Tests cover each affected entry point, actual schema and behavioral drift,
corpus-only expectation failures, positive boundaries, default compatibility,
input immutability, deterministic results and refusal to execute coercion hooks.
The finite regression corpus is not proof that the entire compiler or resource
graph implementation is complete. Remaining issue #20 work stays independent.
