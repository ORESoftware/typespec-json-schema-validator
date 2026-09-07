import { canonicalStringify } from './canonical.mjs';
import { loadCliConfiguration, CliUsageError } from './cli-config.mjs';
import {
  buildContractIr,
  buildContractIrTombstone,
  writeContractIr,
} from './contract-ir.mjs';
import { emitTypeSpecJsonSchema, resolveTspBinary, toolVersion } from './emitter.mjs';
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

export async function main(argv = process.argv) {
  let configuration;
  try {
    configuration = loadCliConfiguration(argv);
    if (configuration.help) {
      configuration.printHelp();
      return EXIT_CODES.passed;
    }

    if (configuration.command === 'doctor') {
      return doctor(configuration);
    }

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

    const runners = {
      check: runCheck,
      compare: runCompare,
      validate: runValidate,
    };
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
    const report = await failedReport(error, {
      command: configuration?.command ?? null,
      usageError: error instanceof CliUsageError,
      details: error instanceof CliUsageError ? error.details : undefined,
    });
    const reportPath =
      configuration?.report ??
      (error instanceof CliUsageError ? error.details?.report : undefined) ??
      process.env.TSJSV_REPORT ??
      '.typespec-json-schema-validator/report.json';
    const sarifPath =
      configuration?.sarif ??
      (error instanceof CliUsageError ? error.details?.sarif : undefined) ??
      process.env.TSJSV_SARIF ??
      undefined;
    const contractIrPath =
      configuration?.contractIr ??
      (error instanceof CliUsageError ? error.details?.contractIr : undefined) ??
      process.env.TSJSV_CONTRACT_IR ??
      undefined;
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
