import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { canonicalStringify } from './canonical.mjs';
import { loadCliConfiguration, CliUsageError } from './cli-config.mjs';
import {
  buildContractIr,
  buildContractIrTombstone,
  writeContractIr,
} from './contract-ir.mjs';
import {
  failedConsumerVerificationReceipt,
  verifyConsumerContractReceipt,
  writeConsumerVerificationReceipt,
} from './consumer-verification-receipt.mjs';
import { emitTypeSpecJsonSchema, resolveTspBinary, toolVersion } from './emitter.mjs';
import { loadProjectionManifest } from './projection-admission/index.mjs';
import { validRelativePath } from './projection-admission/constants.mjs';
import {
  failedProjectionVerificationReceipt,
  loadProjectionVerificationPolicy,
  verifyProjectionWorkspace,
  writeProjectionVerificationReceipt,
} from './projection-verification/index.mjs';
import {
  EXIT_CODES,
  failedReport,
  renderHumanSummary,
  runCheck,
  runCompare,
  runValidate,
  writeReport,
} from './run.mjs';
import { writeSarif } from './sarif.mjs';
import { inventoryTypeSpec } from './typespec-inventory.mjs';

function writeJson(value) {
  process.stdout.write(`${canonicalStringify(value, 2)}\n`);
}

function commandHint(argv, configuration, error) {
  if (typeof configuration?.command === 'string') return configuration.command;
  if (typeof error?.details?.command === 'string') return error.details.command;
  if (typeof argv?.[2] === 'string' && !argv[2].startsWith('-')) return argv[2];
  return process.env.TSJSV_COMMAND || null;
}

function optionHint(argv, name) {
  const prefix = `${name}=`;
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== 'string') continue;
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      return value === '' ? undefined : value;
    }
    if (token === name) {
      const value = argv[index + 1];
      return typeof value === 'string' && value !== '' && !value.startsWith('-')
        ? value
        : undefined;
    }
  }
  return undefined;
}

function expectedDeclarationScope(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('expected declaration scope is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('expected declaration scope must be a JSON array');
  }
  return parsed;
}

async function readJsonArtifact(path, label) {
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new Error(`${label} could not be read`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  if (info.nlink !== 1) {
    throw new Error(`${label} must not have multiple hard links`);
  }
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`${label} could not be read`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function workspacePath(root, value, label) {
  if (!validRelativePath(value)) {
    throw new Error(`${label} must be a normalized relative POSIX path`);
  }
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, value);
  const local = relative(absoluteRoot, candidate);
  if (local === '' || local === '..' || isAbsolute(local)
    || local.startsWith('../') || local.startsWith('..\\')) {
    throw new Error(`${label} must remain inside the configured root`);
  }
  return candidate;
}

async function doctor(configuration) {
  const tspBin = await resolveTspBinary(configuration.tspBin);
  const typespec = await toolVersion(tspBin);
  let emitter;
  try {
    const resolved = import.meta.resolve('@typespec/json-schema');
    emitter = { available: true, resolved };
  } catch (error) {
    emitter = { available: false, error: error.message };
  }
  const result = {
    schema: 'ores.typespec-json-schema-validator.doctor/v1',
    status: typespec.available && emitter.available ? 'passed' : 'failed',
    flags2env: { available: true, package: '@oresoftware/f2e' },
    typespec,
    jsonSchemaEmitter: emitter,
  };
  writeJson(result);
  return result.status === 'passed' ? EXIT_CODES.passed : EXIT_CODES.failed;
}

async function writeContractIrArtifact(configuration, report) {
  if (!configuration.contractIr) return null;
  const contractIr = report.status === 'passed'
    ? await buildContractIr({
      report,
      typespec: configuration.typespec,
      generatedSchema:
        configuration.command === 'check'
          ? report.inputs.generatedJsonSchema.input
          : configuration.generatedSchema,
      authoredSchema: configuration.authoredSchema,
    })
    : buildContractIrTombstone(report);
  return writeContractIr(configuration.contractIr, contractIr);
}

async function writeRunArtifacts(configuration, report) {
  const reportPath = await writeReport(configuration.report, report);
  const sarifPath = configuration.sarif ? await writeSarif(configuration.sarif, report) : null;
  const contractIrPath = await writeContractIrArtifact(configuration, report);
  return { reportPath, sarifPath, contractIrPath };
}

async function runConsumerVerification(configuration) {
  let contractIr = null;
  let report = null;
  let expectedDeclarations = null;
  let receipt;
  try {
    [contractIr, report] = await Promise.all([
      readJsonArtifact(configuration.contractIr, 'Contract IR input'),
      readJsonArtifact(configuration.parityReceipt, 'parity receipt input'),
    ]);
    expectedDeclarations = expectedDeclarationScope(configuration.expectedDeclarations);
    receipt = await verifyConsumerContractReceipt({
      contractIr,
      report,
      typespec: configuration.typespec,
      generatedSchema: configuration.generatedSchema,
      authoredSchema: configuration.authoredSchema,
      expectedDeclarations,
    });
  } catch {
    receipt = failedConsumerVerificationReceipt({ contractIr, report, expectedDeclarations });
  }

  const verificationPath = await writeConsumerVerificationReceipt(
    configuration.verification,
    receipt,
  );
  if (!configuration.quiet) {
    writeJson(receipt);
    process.stdout.write(`consumer-verification: ${verificationPath}\n`);
  }
  return receipt.status === 'passed' ? EXIT_CODES.passed : EXIT_CODES.failed;
}

async function runProjectionVerification(configuration) {
  const root = resolve(configuration.root);
  let manifest = null;
  let contractIr = null;
  let parityReceipt = null;
  let receipt;
  try {
    [manifest, contractIr, parityReceipt] = await Promise.all([
      loadProjectionManifest(workspacePath(
        root,
        configuration.projectionManifest,
        'projection manifest',
      )),
      loadProjectionManifest(workspacePath(root, configuration.contractIr, 'Contract IR')),
      loadProjectionManifest(workspacePath(
        root,
        configuration.parityReceipt,
        'parity receipt',
      )),
    ]);
    const policy = await loadProjectionVerificationPolicy(workspacePath(
      root,
      configuration.projectionPolicy,
      'projection verification policy',
    ));
    ({ receipt } = await verifyProjectionWorkspace({
      root,
      manifest,
      contractIr,
      parityReceipt,
      typespec: configuration.typespec,
      generatedSchema: configuration.generatedSchema,
      authoredSchema: configuration.authoredSchema,
      policy,
    }));
  } catch {
    receipt = failedProjectionVerificationReceipt({ manifest, contractIr, parityReceipt });
  }

  const verificationPath = workspacePath(
    root,
    configuration.projectionVerification,
    'projection verification receipt',
  );
  await writeProjectionVerificationReceipt(verificationPath, receipt);
  if (!configuration.quiet) {
    writeJson(receipt);
    process.stdout.write(`projection-verification: ${verificationPath}\n`);
  }
  return EXIT_CODES[receipt.status];
}

export async function main(argv = process.argv) {
  let configuration;
  try {
    configuration = loadCliConfiguration(argv);
    if (configuration.help) {
      configuration.printHelp();
      return EXIT_CODES.passed;
    }
    if (configuration.command === 'doctor') return doctor(configuration);

    if (configuration.command === 'inventory') {
      const inventory = await inventoryTypeSpec(configuration.typespec);
      const status = inventory.errors.length === 0 && inventory.ambiguities.length === 0
        ? 'passed'
        : 'stopped_for_evaluation';
      writeJson({
        schema: 'ores.typespec-json-schema-validator.inventory/v1',
        status,
        input: inventory.input,
        digest: inventory.digest,
        files: inventory.files,
        declarations: inventory.declarations,
        outOfScopeDeclarations: inventory.outOfScopeDeclarations,
        errors: inventory.errors,
        ambiguities: inventory.ambiguities,
      });
      return EXIT_CODES[status];
    }

    if (configuration.command === 'generate') {
      const emitted = await emitTypeSpecJsonSchema({
        entry: configuration.typespec,
        outputDir: configuration.outputDir,
        bundleId: configuration.bundleId,
        tspBin: configuration.tspBin,
        int64Strategy: configuration.int64Strategy,
        sealObjectSchemas: configuration.sealObjectSchemas,
        polymorphicModelsStrategy: configuration.polymorphicModelsStrategy,
      });
      writeJson({
        schema: 'ores.typespec-json-schema-validator.generation/v1',
        status: 'passed',
        role: 'comparison-evidence-only',
        generatedPath: emitted.generatedPath,
        emitter: emitted.emitter,
        emitterOptions: emitted.emitterOptions,
      });
      return EXIT_CODES.passed;
    }

    if (configuration.command === 'verify-ir') return runConsumerVerification(configuration);
    if (configuration.command === 'verify-projection') {
      return runProjectionVerification(configuration);
    }

    const runners = { check: runCheck, compare: runCompare, validate: runValidate };
    const report = await runners[configuration.command](configuration);
    const { reportPath, sarifPath, contractIrPath } = await writeRunArtifacts(configuration, report);
    if (!configuration.quiet) {
      process.stdout.write(renderHumanSummary(report));
      process.stdout.write(`report: ${reportPath}\n`);
      if (sarifPath) process.stdout.write(`sarif: ${sarifPath}\n`);
      if (contractIrPath) process.stdout.write(`contract-ir: ${contractIrPath}\n`);
    }
    return EXIT_CODES[report.status];
  } catch (error) {
    const command = commandHint(argv, configuration, error);
    if (command === 'verify-ir') {
      const verificationPath =
        configuration?.verification
        ?? error?.details?.verification
        ?? optionHint(argv, '--verification')
        ?? process.env.TSJSV_VERIFICATION
        ?? '.typespec-json-schema-validator/consumer-verification.json';
      try {
        await writeConsumerVerificationReceipt(
          verificationPath,
          failedConsumerVerificationReceipt(),
        );
      } catch (writeError) {
        process.stderr.write(
          `could not write failed consumer verification receipt: ${writeError.message}\n`,
        );
      }
      process.stderr.write(`Contract IR consumer verification failed: ${error.message}\n`);
      if (error instanceof CliUsageError && error.details) {
        process.stderr.write(`${canonicalStringify(error.details, 2)}\n`);
      }
      return EXIT_CODES.failed;
    }

    if (command === 'verify-projection') {
      const root = resolve(
        configuration?.root
        ?? error?.details?.projectionRoot
        ?? optionHint(argv, '--root')
        ?? process.env.TSJSV_PROJECTION_ROOT
        ?? '.',
      );
      const requested =
        configuration?.projectionVerification
        ?? error?.details?.projectionVerification
        ?? optionHint(argv, '--verification')
        ?? process.env.TSJSV_PROJECTION_VERIFICATION
        ?? '.typespec-json-schema-validator/projection-verification.json';
      try {
        const verificationPath = workspacePath(root, requested, 'projection verification receipt');
        await writeProjectionVerificationReceipt(
          verificationPath,
          failedProjectionVerificationReceipt(),
        );
      } catch (writeError) {
        process.stderr.write(
          `could not write failed projection verification receipt: ${writeError.message}\n`,
        );
      }
      process.stderr.write(`Projection verification failed: ${error.message}\n`);
      if (error instanceof CliUsageError && error.details) {
        process.stderr.write(`${canonicalStringify(error.details, 2)}\n`);
      }
      return EXIT_CODES.failed;
    }

    const report = await failedReport(error, {
      command: configuration?.command ?? command,
      usageError: error instanceof CliUsageError,
      details: error instanceof CliUsageError ? error.details : undefined,
    });
    const reportPath =
      configuration?.report
      ?? (error instanceof CliUsageError ? error.details?.report : undefined)
      ?? process.env.TSJSV_REPORT
      ?? '.typespec-json-schema-validator/report.json';
    const sarifPath =
      configuration?.sarif
      ?? (error instanceof CliUsageError ? error.details?.sarif : undefined)
      ?? process.env.TSJSV_SARIF
      ?? undefined;
    const contractIrPath = ['check', 'compare'].includes(command)
      ? configuration?.contractIr
        ?? (error instanceof CliUsageError ? error.details?.contractIr : undefined)
        ?? process.env.TSJSV_CONTRACT_IR
        ?? undefined
      : undefined;
    try {
      await writeReport(reportPath, report);
    } catch (writeError) {
      process.stderr.write(`could not write failure report: ${writeError.message}\n`);
    }
    if (sarifPath) {
      try {
        await writeSarif(sarifPath, report);
      } catch (writeError) {
        process.stderr.write(`could not write failure SARIF: ${writeError.message}\n`);
      }
    }
    if (contractIrPath) {
      try {
        await writeContractIr(
          contractIrPath,
          buildContractIrTombstone(report, 'validator-run-or-contract-ir-export-failed'),
        );
      } catch (writeError) {
        process.stderr.write(`could not write failure Contract IR tombstone: ${writeError.message}\n`);
      }
    }
    process.stderr.write(renderHumanSummary(report));
    if (error instanceof CliUsageError && error.details) {
      process.stderr.write(`${canonicalStringify(error.details, 2)}\n`);
    }
    return EXIT_CODES.failed;
  }
}
