import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SchemaResolver, validateInstance } from './instance-validator.mjs';
import { validateJsonSchemaDocument } from './json-schema.mjs';

export const CONFIG_INSTANCE_RECEIPT_SCHEMA = 'ores.tjsv.config-instance/v1';

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

async function readRegularJson(path, label, maxBytes = 2 * 1024 * 1024) {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  if (info.nlink !== 1) {
    throw new Error(`${label} must not have multiple hard links`);
  }
  if (info.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  }
  const text = await readFile(absolute, 'utf8');
  return { absolute, value: JSON.parse(text) };
}

function sanitizedSchemaFinding(finding) {
  return {
    code: String(finding?.code ?? 'json-schema-invalid'),
    pointer: String(finding?.pointer ?? '#'),
  };
}

function sanitizedValidationError(error) {
  const result = {};
  for (const key of ['keyword', 'instancePointer', 'schemaPointer']) {
    if (typeof error?.[key] === 'string') result[key] = error[key];
  }
  return result;
}

function receipt({ mode, schema, instanceSource, status, schemaFindings = [], errors = [], refusal = null }) {
  return {
    schema: CONFIG_INSTANCE_RECEIPT_SCHEMA,
    mode,
    status,
    authority: 'authored-json-schema',
    peerAuthorityAssumption:
      'TypeSpec and authored JSON Schema parity is admitted separately by tjsv check',
    input: {
      schema,
      instance: instanceSource,
    },
    schemaFindings,
    errors,
    ...(refusal ? { refusal } : {}),
  };
}

/**
 * Validate an already parsed configuration value against one authored JSON
 * Schema authority. This does not replace TypeSpec/JSON-Schema parity; callers
 * must run `tjsv check` at build/admission time to establish that peer closure.
 *
 * Runtime mode is observation-only: invalid configuration produces a warning
 * receipt rather than an exception. Build mode remains fail-closed.
 */
export function validateConfigValue({
  schema,
  instance,
  schemaSource = '<memory>',
  instanceSource = '<memory>',
  mode = 'build',
  formatAssertion = false,
  maxErrors = 32,
}) {
  if (!['build', 'runtime'].includes(mode)) {
    throw new TypeError('mode must be build or runtime');
  }
  const retainedErrors = boundedInteger(maxErrors, 32, 1, 256);
  const schemaFindings = validateJsonSchemaDocument(schema, schemaSource)
    .map(sanitizedSchemaFinding);
  if (schemaFindings.length > 0) {
    return receipt({
      mode,
      schema: schemaSource,
      instanceSource,
      status: mode === 'runtime' ? 'warning' : 'failed',
      schemaFindings,
      refusal: 'authored JSON Schema is not admissible for instance evaluation',
    });
  }

  try {
    const resolver = new SchemaResolver();
    const record = resolver.addDocument(schema, schemaSource);
    const result = validateInstance({
      schema,
      instance,
      resolver,
      base: record.base,
      formatAssertion: Boolean(formatAssertion),
      maxErrors: retainedErrors,
    });
    return receipt({
      mode,
      schema: schemaSource,
      instanceSource,
      status: result.valid ? 'passed' : mode === 'runtime' ? 'warning' : 'failed',
      errors: result.errors.map(sanitizedValidationError),
    });
  } catch (error) {
    return receipt({
      mode,
      schema: schemaSource,
      instanceSource,
      status: mode === 'runtime' ? 'warning' : 'failed',
      refusal: String(error?.name ?? 'SchemaEvaluationError'),
    });
  }
}

export async function validateConfigJsonFile({
  schemaPath,
  instancePath,
  mode = 'build',
  formatAssertion = false,
  maxErrors = 32,
}) {
  const [{ absolute: schemaSource, value: schema }, { absolute: instanceSource, value: instance }] =
    await Promise.all([
      readRegularJson(schemaPath, 'authored JSON Schema'),
      readRegularJson(instancePath, 'configuration JSON'),
    ]);
  return validateConfigValue({
    schema,
    instance,
    schemaSource,
    instanceSource,
    mode,
    formatAssertion,
    maxErrors,
  });
}
