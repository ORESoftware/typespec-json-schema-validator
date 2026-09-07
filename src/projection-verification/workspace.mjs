import { canonicalStringify, sha256 } from '../canonical.mjs';
import {
  CONTRACT_IR_VERIFICATION_SCHEMA,
  verifyContractIr,
} from '../contract-ir.mjs';
import {
  PROJECTION_ADMISSION_REPORT_SCHEMA,
  hashProjectionFiles,
  verifyProjectionManifest,
} from '../projection-admission/index.mjs';
import { ProjectionVerificationPolicyError, validDigest } from './constants.mjs';
import { normalizeProjectionVerificationPolicy } from './policy.mjs';
import {
  createProjectionVerificationReceipt,
  sourceDigestsFromContractIr,
} from './receipt.mjs';

function currentVerificationFailureReport({ manifest, contractIr, parityReceipt, contractIrVerification }) {
  const body = {
    contractIrVerification: {
      schema: contractIrVerification?.schema === CONTRACT_IR_VERIFICATION_SCHEMA
        ? contractIrVerification.schema
        : null,
      status: contractIrVerification?.status ?? null,
      admissible: contractIrVerification?.admissible === true,
      suppliedIrId: validDigest(contractIrVerification?.suppliedIrId)
        ? contractIrVerification.suppliedIrId
        : null,
      computedIrId: validDigest(contractIrVerification?.computedIrId)
        ? contractIrVerification.computedIrId
        : null,
      expectedIrId: validDigest(contractIrVerification?.expectedIrId)
        ? contractIrVerification.expectedIrId
        : null,
      receiptRunId: validDigest(contractIrVerification?.receiptRunId)
        ? contractIrVerification.receiptRunId
        : null,
    },
    manifestId: validDigest(manifest?.manifestId) ? manifest.manifestId : null,
    contractIrId: validDigest(contractIr?.irId) ? contractIr.irId : null,
    receiptRunId: validDigest(parityReceipt?.runId) ? parityReceipt.runId : null,
  };
  return Object.freeze({
    schema: PROJECTION_ADMISSION_REPORT_SCHEMA,
    status: 'stopped_for_evaluation',
    admissible: false,
    zeroUnexplainedFindings: false,
    manifestId: body.manifestId,
    contractIrId: body.contractIrId,
    receiptRunId: body.receiptRunId,
    findings: Object.freeze([Object.freeze({
      ruleId: 'projection-current-contract-ir-verification-failed',
      severity: 'error',
      resolutionState: 'unexplained',
      comparison: 'projection-admission',
      pointer: '#/contractIr',
      message: 'current Contract IR verification must pass before projection evidence can be admitted',
      fingerprint: sha256(canonicalStringify(body)),
    })]),
    findingCount: 1,
    truncated: false,
    evidenceDigest: sha256(canonicalStringify(body)),
    summary: Object.freeze({
      declarations: 0,
      projections: 0,
      outputs: 0,
      representationDeltas: 0,
      runtimeValidators: 0,
    }),
  });
}

export async function verifyProjectionWorkspace({
  manifest,
  contractIr,
  parityReceipt,
  typespec,
  generatedSchema,
  authoredSchema,
  policy,
  inputRoot = '.',
  outputRoot = '.',
}) {
  const normalizedPolicy = normalizeProjectionVerificationPolicy(policy);
  const contractIrVerification = await verifyContractIr({
    contractIr,
    report: parityReceipt,
    typespec,
    generatedSchema,
    authoredSchema,
  });
  if (contractIrVerification.status !== 'passed' || contractIrVerification.admissible !== true) {
    const report = currentVerificationFailureReport({
      manifest,
      contractIr,
      parityReceipt,
      contractIrVerification,
    });
    return Object.freeze({
      contractIrVerification,
      report,
      receipt: createProjectionVerificationReceipt({ report, contractIrVerification, contractIr }),
    });
  }

  const expectedSourceDigests = sourceDigestsFromContractIr(contractIr);
  if (!expectedSourceDigests) {
    throw new ProjectionVerificationPolicyError('verified Contract IR is missing complete source digests');
  }

  const inputEntries = Object.entries(normalizedPolicy.inputs);
  const hashedInputs = await hashProjectionFiles(
    inputRoot,
    inputEntries.map(([, descriptor]) => descriptor),
  );
  const inputsByPath = new Map(hashedInputs.map((descriptor) => [descriptor.path, descriptor]));
  const expectedInputs = Object.fromEntries(
    inputEntries.map(([key, descriptor]) => [key, inputsByPath.get(descriptor.path)]),
  );
  if (Object.values(expectedInputs).some((descriptor) => !descriptor)) {
    throw new ProjectionVerificationPolicyError(
      'projection verification could not hash every required input',
    );
  }
  const actualOutputs = await hashProjectionFiles(outputRoot, normalizedPolicy.outputs);

  const report = verifyProjectionManifest({
    manifest,
    contractIr,
    parityReceipt,
    expectedSourceDigests,
    expectedInputs,
    requiredToolchains: normalizedPolicy.toolchains,
    actualOutputs,
    requiredProjections: normalizedPolicy.requiredProjections,
    approvedDeltas: normalizedPolicy.approvedDeltas,
    expectedRuntimeValidators: normalizedPolicy.runtimeValidators,
  });
  const receipt = createProjectionVerificationReceipt({ report, contractIrVerification, contractIr });
  return Object.freeze({ contractIrVerification, report, receipt });
}
