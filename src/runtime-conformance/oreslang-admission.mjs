import { RUNTIME_EVIDENCE_SCHEMA_V2 } from './constants.mjs';
import { verifyRuntimeEvidenceAgainstCurrentInputs } from './current-inputs.mjs';

function pinnedValidatorIdentity(value, label, expectedName) {
  // An identity is a label, not an artifact digest or proof that a job ran.
  // Require an exact backend-specific package and complete SemVer version.
  const semver = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)'
    + '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?'
    + '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
  const pattern = new RegExp('^' + expectedName + '@' + semver + '$', 'u');
  if (typeof value !== 'string'
    || value.length > 128
    || value.trim() !== value
    || !pattern.test(value)) {
    throw new TypeError(label + ' must be an exact ' + expectedName + '@major.minor.patch validator identity');
  }
  return value;
}
/**
 * Oreslang runtime admission policy, using the canonical current-source TJSV
 * verifier. Static generator/Java-parser success is not a runtime adapter.
 *
 * This function does not execute an adapter and must only receive evidence
 * from separately executed and reviewed GraalVM and LLVM validator jobs.
 */
export async function verifyOreslangRuntimeAdmission({
  graalvmValidator,
  llvmValidator,
  ...currentInputs
}) {
  const requiredAdapters = [
    Object.freeze({
      id: 'oreslang-graalvm',
      language: 'oreslang',
      validator: pinnedValidatorIdentity(graalvmValidator, 'graalvmValidator', 'oreslang-graalvm'),
    }),
    Object.freeze({
      id: 'oreslang-llvm',
      language: 'oreslang',
      validator: pinnedValidatorIdentity(llvmValidator, 'llvmValidator', 'oreslang-llvm'),
    }),
  ];
  return verifyRuntimeEvidenceAgainstCurrentInputs({
    ...currentInputs,
    requiredAdapters,
    requiredEvidenceSchema: RUNTIME_EVIDENCE_SCHEMA_V2,
  });
}
