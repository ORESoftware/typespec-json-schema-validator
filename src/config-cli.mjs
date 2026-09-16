import { canonicalStringify } from './canonical.mjs';
import { CliUsageError, loadCliConfiguration } from './cli-config.mjs';
import {
  validateConfigJsonFile,
  validateConfigValueWithSchemaFile,
} from './config-instance.mjs';
import { EXIT_CODES } from './run.mjs';

const MAX_STDIN_BYTES = 2 * 1024 * 1024;

async function readStdinJson() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_STDIN_BYTES) {
      throw new Error(`configuration stdin exceeds the ${MAX_STDIN_BYTES}-byte limit`);
    }
    chunks.push(bytes);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  return JSON.parse(text);
}

function writeReceipt(receipt) {
  process.stdout.write(`${canonicalStringify(receipt, 2)}\n`);
  if (receipt.status === 'warning') {
    process.stderr.write(
      `[tjsv-config][warning] configuration shape did not satisfy ${receipt.input.schema}; runtime continues\n`,
    );
  }
}

export async function runConfigCommand(argv = process.argv) {
  let configuration;
  try {
    configuration = loadCliConfiguration(argv);
    if (configuration.help) {
      configuration.printHelp();
      return EXIT_CODES.passed;
    }
    if (configuration.command !== 'config') {
      throw new CliUsageError('config runner requires the config command', {
        command: configuration.command,
      });
    }

    const common = {
      schemaPath: configuration.authoredSchema,
      mode: configuration.configMode,
      formatAssertion: configuration.formatAssertion,
      maxErrors: configuration.maxErrors,
    };
    const receipt = configuration.configInstance === '-'
      ? await validateConfigValueWithSchemaFile({
        ...common,
        instance: await readStdinJson(),
        instanceSource: '<stdin-json>',
      })
      : await validateConfigJsonFile({
        ...common,
        instancePath: configuration.configInstance,
      });
    writeReceipt(receipt);
    return receipt.status === 'failed' ? EXIT_CODES.stopped_for_evaluation : EXIT_CODES.passed;
  } catch (error) {
    const mode = configuration?.configMode
      ?? (argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : undefined)
      ?? argv.find((value) => typeof value === 'string' && value.startsWith('--mode='))?.slice(7)
      ?? process.env.TSJSV_CONFIG_MODE
      ?? 'build';
    const prefix = mode === 'runtime' ? '[tjsv-config][warning]' : '[tjsv-config][error]';
    process.stderr.write(`${prefix} configuration shape check could not run: ${error?.name ?? 'Error'}\n`);
    if (error instanceof CliUsageError && error.details) {
      process.stderr.write(`${canonicalStringify(error.details, 2)}\n`);
    }
    return mode === 'runtime' ? EXIT_CODES.passed : EXIT_CODES.stopped_for_evaluation;
  }
}
