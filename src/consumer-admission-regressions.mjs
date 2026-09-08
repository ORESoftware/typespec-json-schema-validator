// Regression evidence around the canonical consumer verifier, never a second validator.
import { verifyConsumerContract } from './consumer-verification.mjs';

function changedDigest(value) {
  return value === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
}

/** Fresh positive admission must succeed before any rejection is counted.
 * The injected verifier is a unit-test seam; action callers cannot configure it.
 * Mutation cases operate on copies and never edit either authored authority.
 */
export async function testConsumerAdmission(options, verify = verifyConsumerContract) {
  if (typeof verify !== 'function') throw new TypeError('verifier must be a function');
  const positive = await verify(structuredClone(options));
  if (positive?.status !== 'passed' || positive.admissible !== true) {
    throw new Error('positive consumer admission did not pass');
  }
  const cases = [
    ['tampered-ir-digest', (o) => { o.contractIr.irId = changedDigest(o.contractIr.irId); }],
    ['stale-receipt-identity', (o) => { o.report.runId = changedDigest(o.report.runId); }],
    ['disabled-differential-evidence', (o) => { o.report.differential = { ...o.report.differential, disabled: true }; }],
    ['incomplete-ir-scope', (o) => { o.contractIr.admission.scope.complete = false; }],
    ['empty-consumer-scope', (o) => { o.expectedDeclarations = []; }],
    ['duplicate-consumer-scope', (o) => { o.expectedDeclarations.push(o.expectedDeclarations[0]); }],
    ['mismatched-consumer-scope', (o) => {
      let id = 'TjsvRegression.NotAnAdmittedDeclaration';
      while (o.expectedDeclarations.includes(id)) id += '_';
      o.expectedDeclarations.push(id);
    }],
  ];
  const rejected = [];
  for (const [name, mutate] of cases) {
    const copy = structuredClone(options);
    mutate(copy);
    let refused = false;
    try {
      // A returned failure object is not the canonical throwing contract.
      // Fail closed if the verifier stops enforcing that API as well.
      await verify(copy);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('STOPPED_FOR_EVALUATION:')) {
        throw new Error(`unexpected verifier failure in ${name}`, { cause: error });
      }
      refused = true;
    }
    if (!refused) throw new Error(`consumer verifier accepted ${name}`);
    rejected.push(name);
  }
  // Repeat positive admission to detect mutable state leaked by negative cases.
  const final = await verify(structuredClone(options));
  if (final?.status !== 'passed' || final.admissible !== true ||
      final.expectedIrId !== positive.expectedIrId || final.receiptRunId !== positive.receiptRunId) {
    throw new Error('positive admission changed after negative regressions');
  }
  return Object.freeze({ verification: final, rejected: Object.freeze(rejected) });
}
