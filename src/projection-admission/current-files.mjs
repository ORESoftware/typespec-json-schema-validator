import { isAbsolute, relative, resolve } from 'node:path';
import { canonicalStringify, sha256 } from '../canonical.mjs';
import { verifyConsumerContract } from '../consumer-verification.mjs';
import { isPlainObject, PROJECTION_ADMISSION_REPORT_SCHEMA, validRelativePath } from './constants.mjs';
import { makeProjectionFinding } from './findings.mjs';
import { hashProjectionFiles } from './io.mjs';
import { verifyProjectionManifest } from './verify.mjs';

const INPUTS = ['operationInventory', 'projectionMetadata', 'emitterConfiguration'];
const SOURCES = ['typespec', 'generatedSchema', 'authoredSchema'];
const OPTIONS = new Set([
  'root', 'manifest', 'contractIr', 'parityReceipt', ...SOURCES,
  'expectedDeclarations', 'inputPaths', 'outputFiles', 'requiredToolchains',
  'requiredProjections', 'approvedDeltas', 'expectedRuntimeValidators', 'limits', 'fileLimits',
]);
const REFUSALS = Object.freeze({
  configuration: 'explicit current-file configuration is missing or invalid',
  contract: 'current source evidence or the required declaration scope is not admissible',
  files: 'current projection files could not be safely observed within the configured limits',
  manifest: 'projection evidence could not be evaluated',
});

function stopped(stage) {
  const finding = makeProjectionFinding({
    ruleId: `projection-current-files-${stage}-invalid`,
    pointer: '#',
    message: REFUSALS[stage],
  });
  // Do not copy filesystem exceptions, source text, or attacker-controlled
  // malformed evidence into deterministic failure reports.
  const body = {
    schema: PROJECTION_ADMISSION_REPORT_SCHEMA,
    status: 'stopped_for_evaluation',
    admissible: false,
    manifestId: null,
    contractIrId: null,
    receiptRunId: null,
    summary: Object.freeze({ declarations: 0, projections: 0, outputs: 0, representationDeltas: 0, runtimeValidators: 0 }),
    findings: Object.freeze([finding]),
  };
  return Object.freeze({ ...body, evidenceDigest: sha256(canonicalStringify(body)) });
}

function currentPath(root, path) {
  if (!validRelativePath(path)) throw new Error('explicit relative path required');
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === '' || rel === '..' || isAbsolute(rel) || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error('current input path is outside the configured root');
  }
  return absolute;
}

/** Preferred admission API for a trusted, quiescent checkout.
 * Observations cannot be supplied by the manifest or a copied verifier result.
 * This verifies evidence bindings, not emitter execution or arbitrary imports.
 */
export async function verifyProjectionManifestWithCurrentFiles(options) {
  let stage = 'configuration';
  try {
    if (!isPlainObject(options) || Object.keys(options).some((key) => !OPTIONS.has(key))) {
      throw new Error('invalid current-file options');
    }
    // Own the complete request snapshot before the first asynchronous read.
    const args = structuredClone(options);
    if (typeof args.root !== 'string' || args.root.trim() === '' || args.root.includes('\0')) {
      throw new Error('explicit root required');
    }
    const root = resolve(args.root);
    const sourcePaths = Object.fromEntries(SOURCES.map((key) => [key, currentPath(root, args[key])]));
    if (!isPlainObject(args.inputPaths) || Object.keys(args.inputPaths).length !== INPUTS.length
      || INPUTS.some((key) => !Object.hasOwn(args.inputPaths, key))) {
      throw new Error('exact projection input roles required');
    }
    for (const key of INPUTS) currentPath(root, args.inputPaths[key]);
    if (!Array.isArray(args.outputFiles) || args.outputFiles.length === 0) throw new Error('explicit output inventory required');
    const contractOptions = {
      contractIr: args.contractIr,
      report: args.parityReceipt,
      expectedDeclarations: args.expectedDeclarations,
      ...sourcePaths,
    };
    stage = 'contract';
    await verifyConsumerContract(contractOptions);
    stage = 'files';
    const observed = await hashProjectionFiles(root, [
      ...INPUTS.map((key) => ({ path: args.inputPaths[key] })),
      ...args.outputFiles,
    ], args.fileLimits);
    const byPath = new Map(observed.map((file) => [file.path, file]));
    const expectedInputs = Object.fromEntries(INPUTS.map((key) => [key, byPath.get(args.inputPaths[key])]));
    const actualOutputs = args.outputFiles.map((file) => byPath.get(file.path));
    // Recheck sources after reading projection files; no old verification token
    // can authorize evidence after a source change observed during this call.
    stage = 'contract';
    await verifyConsumerContract(contractOptions);
    const expectedSourceDigests = Object.fromEntries(
      ['typespec', 'generatedJsonSchema', 'authoredJsonSchema']
        .map((lane) => [lane, args.contractIr.provenance[lane].digest]),
    );
    stage = 'manifest';
    return verifyProjectionManifest({
      manifest: args.manifest,
      contractIr: args.contractIr,
      parityReceipt: args.parityReceipt,
      expectedSourceDigests,
      expectedInputs,
      actualOutputs,
      requiredToolchains: args.requiredToolchains,
      requiredProjections: args.requiredProjections,
      approvedDeltas: args.approvedDeltas,
      expectedRuntimeValidators: args.expectedRuntimeValidators,
      limits: args.limits,
    });
  } catch {
    return stopped(stage);
  }
}
