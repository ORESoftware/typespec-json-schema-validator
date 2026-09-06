import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseStructured } from '@oresoftware/f2e';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(PACKAGE_ROOT, '.cli-flags.toml');

export class CliUsageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CliUsageError';
    this.details = details;
  }
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new CliUsageError(`expected boolean value, received ${value}`);
}

function integerValue(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new CliUsageError(`expected safe integer value, received ${value}`);
  }
  return parsed;
}

function required(env, key, label) {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CliUsageError(`${label} is required`);
  }
  return value;
}

function mergedEnvironment(parsed) {
  return {
    ...parsed.flags,
    ...parsed.dotenv,
    ...process.env,
    ...parsed.dotenvOverrides,
    ...parsed.providedFlags,
  };
}

function validateEmitterOptions(options) {
  if (!['string', 'number'].includes(options.int64Strategy)) {
    throw new CliUsageError('--int64-strategy must be string or number');
  }
  if (!['ignore', 'oneOf', 'anyOf'].includes(options.polymorphicModelsStrategy)) {
    throw new CliUsageError('--polymorphic-models-strategy must be ignore, oneOf, or anyOf');
  }
  return options;
}

export function loadCliConfiguration(argv = process.argv) {
  const parsed = parseStructured(argv, { configPath: CONFIG_PATH });
  if (parsed.isHelpMenu) {
    return {
      help: true,
      printHelp: () => parsed.printTable(),
      command: parsed.command,
    };
  }
  const env = mergedEnvironment(parsed);
  if (parsed.unknownOptions.length > 0 || parsed.errors.length > 0) {
    throw new CliUsageError('flags-2-env rejected the command line', {
      unknownOptions: parsed.unknownOptions,
      errors: parsed.errors,
      // Preserve requested artifact destinations even when normal command construction fails.
      report: env.TSJSV_REPORT || undefined,
      sarif: env.TSJSV_SARIF || undefined,
    });
  }
  const command = parsed.command || env.TSJSV_COMMAND || '';
  const common = {
    command,
    report: env.TSJSV_REPORT || '.typespec-json-schema-validator/report.json',
    sarif: env.TSJSV_SARIF || undefined,
    mapping: env.TSJSV_MAPPING || undefined,
    maxFindings: integerValue(env.TSJSV_MAX_FINDINGS, 250),
    tspBin: env.TSJSV_TSP_BIN || undefined,
    quiet: booleanValue(env.TSJSV_QUIET, false),
    instances: env.TSJSV_INSTANCES || undefined,
    probes: booleanValue(env.TSJSV_PROBES, true),
    maxProbes: integerValue(env.TSJSV_MAX_PROBES, 64),
    formatAssertion: booleanValue(env.TSJSV_FORMAT_ASSERTION, false),
  };
  if (common.maxFindings < 1 || common.maxFindings > 10_000) {
    throw new CliUsageError('--max-findings must be between 1 and 10000');
  }
  if (common.maxProbes < 1 || common.maxProbes > 10_000) {
    throw new CliUsageError('--max-probes must be between 1 and 10000');
  }

  switch (command) {
    case 'check':
      return validateEmitterOptions({
        ...common,
        typespec: required(env, 'TSJSV_TYPESPEC', '--typespec'),
        authoredSchema: required(env, 'TSJSV_AUTHORED_SCHEMA', '--schema'),
        outputDir: env.TSJSV_OUTPUT_DIR || '.typespec-json-schema-validator/generated',
        bundleId: env.TSJSV_BUNDLE_ID || 'typespec.generated.schema.json',
        int64Strategy: env.TSJSV_INT64_STRATEGY || 'string',
        sealObjectSchemas: booleanValue(env.TSJSV_SEAL_OBJECT_SCHEMAS, true),
        polymorphicModelsStrategy: env.TSJSV_POLYMORPHIC_MODELS_STRATEGY || 'oneOf',
      });
    case 'compare':
      return {
        ...common,
        typespec: required(env, 'TSJSV_TYPESPEC', '--typespec'),
        authoredSchema: required(env, 'TSJSV_AUTHORED_SCHEMA', '--schema'),
        generatedSchema: required(env, 'TSJSV_GENERATED_SCHEMA', '--generated-schema'),
      };
    case 'validate':
      return {
        ...common,
        authoredSchema: required(env, 'TSJSV_AUTHORED_SCHEMA', '--schema'),
        generatedSchema: required(env, 'TSJSV_GENERATED_SCHEMA', '--generated-schema'),
      };
    case 'inventory':
      return {
        ...common,
        typespec: required(env, 'TSJSV_TYPESPEC', '--typespec'),
      };
    case 'generate':
      return validateEmitterOptions({
        ...common,
        typespec: required(env, 'TSJSV_TYPESPEC', '--typespec'),
        outputDir: env.TSJSV_OUTPUT_DIR || '.typespec-json-schema-validator/generated',
        bundleId: env.TSJSV_BUNDLE_ID || 'typespec.generated.schema.json',
        int64Strategy: env.TSJSV_INT64_STRATEGY || 'string',
        sealObjectSchemas: booleanValue(env.TSJSV_SEAL_OBJECT_SCHEMAS, true),
        polymorphicModelsStrategy: env.TSJSV_POLYMORPHIC_MODELS_STRATEGY || 'oneOf',
      });
    case 'doctor':
      return common;
    case '':
      return {
        ...common,
        help: true,
        printHelp: () => parsed.printTable(),
      };
    default:
      throw new CliUsageError(`unsupported command: ${command}`);
  }
}
