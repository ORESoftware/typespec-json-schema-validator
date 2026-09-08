import test from 'node:test';
import assert from 'node:assert/strict';
import { testConsumerAdmission } from '../../src/consumer-admission-regressions.mjs';

const seed = () => ({
  contractIr: { irId: 'a'.repeat(64), admission: { scope: { complete: true } } },
  report: { runId: 'b'.repeat(64), differential: { disabled: false } },
  expectedDeclarations: ['Domain.Item'],
  typespec: 'main.tsp', generatedSchema: 'generated.json', authoredSchema: 'authored.json',
});
const success = () => ({ status: 'passed', admissible: true,
  expectedIrId: 'a'.repeat(64), receiptRunId: 'b'.repeat(64) });
const refused = () => { throw new Error('STOPPED_FOR_EVALUATION: test refusal'); };
function strictVerifier(o) {
  if (JSON.stringify(o) !== JSON.stringify(seed())) return refused();
  return success();
}

test('positive admission, all seven negatives, and final positive; inputs untouched', async () => {
  const input = seed();
  let calls = 0;
  const result = await testConsumerAdmission(input, (o) => { calls++; return strictVerifier(o); });
  assert.equal(calls, 9);
  assert.equal(result.rejected.length, 7);
  assert.equal(new Set(result.rejected).size, 7);
  assert.deepEqual(input, seed());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.rejected));
});
for (let accepted = 1; accepted <= 7; accepted++) {
  test(`rejects a verifier accepting negative case ${accepted}`, async () => {
    let calls = 0;
    await assert.rejects(testConsumerAdmission(seed(), (o) => {
      calls++;
      if (calls === accepted + 1) return success();
      return strictVerifier(o);
    }), /consumer verifier accepted/);
  });
}
test('a failed baseline never counts as successful negative coverage', async () => {
  let calls = 0;
  await assert.rejects(testConsumerAdmission(seed(), () => { calls++; return refused(); }), /STOPPED/);
  assert.equal(calls, 1);
});
test('a non-passed positive result is rejected', async () => {
  await assert.rejects(testConsumerAdmission(seed(), () => ({status: 'failed'})), /positive/);
});
test('infrastructure errors are not evidence of semantic rejection', async () => {
  let calls = 0;
  await assert.rejects(testConsumerAdmission(seed(), () => {
    if (++calls === 1) return success();
    throw new Error('network or filesystem unavailable');
  }), /unexpected verifier failure/);
});
test('non-Error thrown values are not evidence', async () => {
  let calls = 0;
  await assert.rejects(testConsumerAdmission(seed(), () => {
    if (++calls === 1) return success();
    throw 'STOPPED_FOR_EVALUATION: not an Error';
  }), /unexpected verifier failure/);
});
test('returned failures cannot silently replace the canonical throwing API', async () => {
  let calls = 0;
  await assert.rejects(testConsumerAdmission(seed(), () => ++calls === 1 ? success() : {status: 'failed'}), /accepted/);
});
test('final positive detects leaked state or evidence identity changes', async () => {
  let calls = 0;
  await assert.rejects(testConsumerAdmission(seed(), (o) => {
    if (++calls === 9) return {...success(), receiptRunId: 'c'.repeat(64)};
    return strictVerifier(o);
  }), /changed after/);
});
test('invalid test seam is rejected', async () => {
  await assert.rejects(testConsumerAdmission(seed(), false), TypeError);
});
