import { resolve } from 'node:path';
import { verifyConsumerContract } from '../consumer-verification.mjs';
import { verifyProjectionManifestWithCurrentFiles } from '../projection-admission/index.mjs';
import { ProjectionVerificationPolicyError, validRelativePath } from './constants.mjs';
import { normalizeProjectionVerificationPolicy } from './policy.mjs';
import { createProjectionVerificationReceipt } from './receipt.mjs';

function sourcePath(root, value, label) {
  if (!validRelativePath(value)) {
    throw new ProjectionVerificationPolicyError(`${label} must be a normalized relative POSIX path`);
  }
  return resolve(root, value);
}

export async function verifyProjectionWorkspace({
  root,
  manifest,
  contractIr,
  parityReceipt,
  typespec,
  generatedSchema,
  authoredSchema,
  policy,
}) {
  const normalizedPolicy = normalizeProjectionVerificationPolicy(policy);
  let contractIrVerification = null;
  try {
    contractIrVerification = await verifyConsumerContract({
      contractIr,
      report: parityReceipt,
      typespec: sourcePath(root, typespec, 'TypeSpec input'),
      generatedSchema: sourcePath(root, generatedSchema, 'generated JSON Schema input'),
      authoredSchema: sourcePath(root, authoredSchema, 'authored JSON Schema input'),
      expectedDeclarations: normalizedPolicy.expectedDeclarations,
    });
  } catch {
    // The preferred current-files API below emits the bounded stage-specific
    // refusal. The compact receipt never copies arbitrary verifier errors.
  }

  const report = await verifyProjectionManifestWithCurrentFiles({
    root,
    manifest,
    contractIr,
    parityReceipt,
    typespec,
    generatedSchema,
    authoredSchema,
    expectedDeclarations: normalizedPolicy.expectedDeclarations,
    inputPaths: Object.fromEntries(
      Object.entries(normalizedPolicy.inputs).map(([key, descriptor]) => [key, descriptor.path]),
    ),
    outputFiles: normalizedPolicy.outputs,
    requiredToolchains: normalizedPolicy.toolchains,
    requiredProjections: normalizedPolicy.requiredProjections,
    approvedDeltas: normalizedPolicy.approvedDeltas,
    expectedRuntimeValidators: normalizedPolicy.runtimeValidators,
  });
  const receipt = createProjectionVerificationReceipt({
    report,
    contractIrVerification,
    contractIr,
  });
  return Object.freeze({ contractIrVerification, report, receipt });
}
