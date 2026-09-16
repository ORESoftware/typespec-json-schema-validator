#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { canonicalStringify } from '../src/canonical.mjs';
import { validateConfigValue, validateConfigJsonFile } from '../src/config-instance.mjs';

function option(argv, name, fallback) {
  const equals = `${name}=`;
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith(equals)) return token.slice(equals.length);
    if (token === name) return argv[index + 1] ?? fallback;
  }
  return fallback;
}

function flag(argv, name) {
  return argv.slice(2).includes(name);
}

function usage() {
  process.stderr.write(
    'usage: tjsv-config --schema <authored.schema.json> [--instance <config.json|->] [--mode build|runtime] [--format-assertion] [--max-errors N]\n',
  );
}

async function readStdinJson() {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

async function main(argv = process.argv) {
  const schemaPath = option(argv, '--schema');
  const instancePath = option(argv, '--instance', '-');
  const mode = option(argv, '--mode', 'build');
  const maxErrors = option(argv, '--max-errors', '32');
  const formatAssertion = flag(argv, '--format-assertion');
  if (!schemaPath || !['build', 'runtime'].includes(mode)) {
    usage();
    return mode === 'runtime' ? 0 : 2;
  }

  try {
    let receipt;
    if (instancePath === '-') {
      const [schemaText, instance] = await Promise.all([
        readFile(schemaPath, 'utf8'),
        readStdinJson(),
      ]);
      receipt = validateConfigValue({
        schema: JSON.parse(schemaText),
        instance,
        schemaSource: schemaPath,
        instanceSource: '<stdin-json>',
        mode,
        formatAssertion,
        maxErrors,
      });
    } else {
      receipt = await validateConfigJsonFile({
        schemaPath,
        instancePath,
        mode,
        formatAssertion,
        maxErrors,
      });
    }
    process.stdout.write(`${canonicalStringify(receipt, 2)}\n`);
    if (receipt.status === 'warning') {
      process.stderr.write(
        `[tjsv-config][warning] configuration shape did not satisfy ${schemaPath}; runtime continues\n`,
      );
    }
    return receipt.status === 'failed' ? 2 : 0;
  } catch (error) {
    const prefix = mode === 'runtime' ? '[tjsv-config][warning]' : '[tjsv-config][error]';
    process.stderr.write(`${prefix} configuration shape check could not run: ${error?.name ?? 'Error'}\n`);
    return mode === 'runtime' ? 0 : 2;
  }
}

process.exitCode = await main();
