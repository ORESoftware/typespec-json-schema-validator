// Consumer policy around the canonical verifier, not a second schema validator.
const IR_SCHEMA = 'ores.typespec-json-schema-validator.contract-ir/v1';
const VERIFICATION_SCHEMA = 'ores.typespec-json-schema-validator.contract-ir-verification/v1';
const HEX_256 = /^[a-f0-9]{64}$/u;

function requireCondition(condition, message) {
  if (!condition) throw new Error(`STOPPED_FOR_EVALUATION: ${message}`);
}

function denseArray(values, label) {
  requireCondition(Array.isArray(values) && values.length > 0, `${label} must be a nonempty array`);
  // Array.every/map skip holes and can read inherited numeric properties.
  // In-process callers must provide the same explicit inventory as JSON callers.
  for (let index = 0; index < values.length; index++) {
    requireCondition(Object.hasOwn(values, index), `${label} contains a missing own element`);
  }
}

function identities(values, label) {
  denseArray(values, label);
  requireCondition(values.every((value) => typeof value === 'string' && value.trim() === value && value !== ''), `${label} contains an invalid identity`);
  requireCondition(new Set(values).size === values.length, `${label} contains duplicate identities`);
  return [...values].sort();
}

/** Verify an artifact against caller-owned paths and a complete, explicit scope.
 * The optional verifier is a test seam; the action always uses the canonical implementation.
 */
export async function verifyConsumerContract(options, verifier) {
  const { contractIr, report, typespec, generatedSchema, authoredSchema, expectedDeclarations } = options;
  for (const [name, value] of Object.entries({ typespec, generatedSchema, authoredSchema })) {
    requireCondition(typeof value === 'string' && value.trim() !== '', `explicit ${name} path is required`);
  }
  const expected = identities(expectedDeclarations, 'expectedDeclarations');
  requireCondition(contractIr?.schema === IR_SCHEMA, 'unrecognized Contract IR schema');
  requireCondition(contractIr?.status === 'passed' && contractIr.admissible === true, 'Contract IR is not admissible');
  requireCondition(contractIr.admission?.scope?.complete === true, 'incomplete declaration scope');
  requireCondition(Array.isArray(contractIr.excludedDeclarations) && contractIr.excludedDeclarations.length === 0, 'excluded declarations are not admitted');
  requireCondition(Array.isArray(contractIr.outOfScopeDeclarations) && contractIr.outOfScopeDeclarations.length === 0, 'out-of-scope declarations are not admitted');
  requireCondition(Array.isArray(contractIr.declarations), 'declarations are missing');
  denseArray(contractIr.declarations, 'admitted declarations');
  const actual = identities(contractIr.declarations.map((entry) => entry?.id), 'admitted declarations');
  requireCondition(JSON.stringify(actual) === JSON.stringify(expected), 'declaration inventory does not match the consumer scope');
  requireCondition(contractIr.admission.scope.admittedDeclarations === actual.length, 'admitted declaration count is inconsistent');
  if (verifier === undefined) ({ verifyContractIr: verifier } = await import('./contract-ir.mjs'));
  requireCondition(typeof verifier === 'function', 'canonical verifier is unavailable');
  // Never allow report-controlled fallback paths to select the checked-out input closure.
  const result = await verifier({ contractIr, report, typespec, generatedSchema, authoredSchema });
  requireCondition(result?.schema === VERIFICATION_SCHEMA && result.status === 'passed' && result.admissible === true, 'canonical evidence verification failed');
  requireCondition(typeof contractIr.irId === 'string' && HEX_256.test(contractIr.irId), 'invalid IR identity');
  for (const key of ['suppliedIrId', 'computedIrId', 'expectedIrId']) {
    requireCondition(result[key] === contractIr.irId, `verification ${key} is not bound to this artifact`);
  }
  requireCondition(typeof report?.runId === 'string' && HEX_256.test(report.runId) && result.receiptRunId === report.runId, 'verification is not bound to this receipt');
  return Object.freeze({ ...result, declarationIds: Object.freeze(actual) });
}
