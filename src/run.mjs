import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify, sha256 } from './canonical.mjs';
import { emitTypeSpecJsonSchema, resolveTspBinary, toolVersion } from './emitter.mjs';
import { loadSchemaCollection } from './json-schema.mjs';
import { compareParity, loadMapping } from './parity.mjs';
import { inventoryTypeSpec } from './typespec-inventory.mjs';

export const REPORT_SCHEMA = 'ores.typespec-json-schema-validator.report/v1';
export const EXIT_CODES = Object.freeze({
  passed: 0,
  stopped_for_evaluation: 2,
  failed: 3,
});

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function packageVersion() {
  const packageJson = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return packageJson.version;
}

function relativeDisplay(path, base = process.cwd()) {
  const rendered = relative(base, resolve(path)).replaceAll('\\', '/');
  return rendered && !rendered.startsWith('../') ? rendered : resolve(path).replaceAll('\\', '/');
}

function isInside(candidate, parent) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function assertOutputSeparation(authoredInput, outputDir) {
  const authored = resolve(authoredInput);
  const output = resolve(outputDir);
  const authoredStat = await stat(authored);
  if (authoredStat.isDirectory() && isInside(output, authored)) {
    throw new Error('generated output directory must not be inside the authored JSON Schema directory');
  }
  if (authoredStat.isFile() && isInside(authored, output)) {
    throw new Error('authored JSON Schema file must not be inside the generated output directory');
  }
}

function summaryCounts(typespecInventory, generatedCollection, authoredCollection, parity) {
  return {
    typespecDeclarations: typespecInventory.declarations.length,
    typespecOutOfScopeDeclarations: typespecInventory.outOfScopeDeclarations.length,
    generatedDeclarations: generatedCollection.declarations.length,
    authoredDeclarations: authoredCollection.declarations.length,
    findings: parity.findingCount,
    emittedFindings: parity.findings.length,
    findingsTruncated: parity.truncated,
  };
}

function buildRunId(material) {
  return sha256(canonicalStringify(material));
}

async function buildPassedOrStoppedReport({
  mode,
  options,
  typespecInventory,
  generatedCollection,
  authoredCollection,
  mapping,
  parity,
  emitter,
  tspVersion,
}) {
  const version = await packageVersion();
  const status = parity.findingCount === 0 ? 'passed' : 'stopped_for_evaluation';
  const configuration = {
    mode,
    maxFindings: options.maxFindings,
    bundleId: emitter?.bundleId ?? null,
    emitter: emitter?.emitter ?? null,
    emitterOptions: emitter?.emitterOptions ?? null,
    executionMode: emitter?.executionMode ?? null,
    mappingSchema: mapping.schema,
  };
  const inputs = {
    typespec: {
      input: relativeDisplay(typespecInventory.input),
      digest: typespecInventory.digest,
      files: typespecInventory.files,
    },
    authoredJsonSchema: {
      input: relativeDisplay(authoredCollection.input),
      digest: authoredCollection.digest,
      files: authoredCollection.documents.map(({ relativePath, sha256: digest }) => ({ relativePath, sha256: digest })),
    },
    generatedJsonSchema: {
      input: relativeDisplay(generatedCollection.input),
      digest: generatedCollection.digest,
      files: generatedCollection.documents.map(({ relativePath, sha256: digest }) => ({ relativePath, sha256: digest })),
    },
    mapping: mapping.source ? relativeDisplay(mapping.source) : null,
  };
  const toolchain = {
    validator: { name: '@oresoftware/typespec-json-schema-validator', version },
    typespecCompiler: tspVersion,
    jsonSchemaEmitter: '@typespec/json-schema',
  };
  const runId = buildRunId({
    schema: REPORT_SCHEMA,
    status,
    configuration,
    inputDigests: {
      typespec: typespecInventory.digest,
      authored: authoredCollection.digest,
      generated: generatedCollection.digest,
    },
    toolchain,
    findings: parity.findings.map((finding) => finding.fingerprint),
  });

  return {
    schema: REPORT_SCHEMA,
    runId,
    status,
    authorities: {
      typespec: {
        authority: 'independently-authored',
        generatedJsonSchemaRole: 'comparison-evidence-only',
      },
      jsonSchema: {
        authority: 'independently-authored',
        dialect: 'https://json-schema.org/draft/2020-12/schema',
      },
      precedence: 'none',
      onUnexplainedMismatch: 'STOPPED_FOR_EVALUATION',
    },
    configuration,
    inputs,
    toolchain,
    coverage: {
      directDeclarationInventory: true,
      typespecGeneratedJsonSchemaComparison: true,
      sourceMutationCheck: mode === 'check',
      comparedDimensions: [
        'top-level declaration names',
        'declaration kind families',
        'required and optional properties',
        'nullability',
        'scalar types and formats',
        'numeric and string constraints',
        'enums',
        'unions and composition',
        'references',
        'defaults and annotations',
        'additional and unevaluated property policy',
      ],
      outOfScopeTypeSpecDeclarations: typespecInventory.outOfScopeDeclarations.map((declaration) => ({
        qualifiedName: declaration.qualifiedName,
        kind: declaration.kind,
        reason: declaration.reason,
      })),
    },
    counts: summaryCounts(typespecInventory, generatedCollection, authoredCollection, parity),
    declarationMap: parity.expectedDeclarations,
    zeroUnexplainedFindings: parity.findingCount === 0,
    findings: parity.findings,
  };
}

export async function writeReport(path, report) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${canonicalStringify(report, 2)}\n`, 'utf8');
  return absolute;
}

export function renderHumanSummary(report) {
  const lines = [
    `TypeSpec/JSON Schema parity: ${report.status.toUpperCase()}`,
    `run: ${report.runId}`,
  ];
  if (report.counts) {
    lines.push(
      `declarations: TypeSpec=${report.counts.typespecDeclarations}, generated=${report.counts.generatedDeclarations}, authored=${report.counts.authoredDeclarations}`,
      `findings: ${report.counts.findings}${report.counts.findingsTruncated ? ' (report truncated)' : ''}`,
    );
  }
  for (const finding of report.findings?.slice(0, 20) ?? []) {
    lines.push(`- [${finding.ruleId}] ${finding.message}`);
  }
  if ((report.findings?.length ?? 0) > 20) {
    lines.push(`- … ${report.findings.length - 20} additional emitted findings`);
  }
  if (report.error) {
    lines.push(`error: ${report.error.message}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function failedReport(error, context = {}) {
  const version = await packageVersion();
  const errorObject = {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
  };
  const runId = buildRunId({
    schema: REPORT_SCHEMA,
    status: 'failed',
    version,
    error: errorObject,
    context,
  });
  return {
    schema: REPORT_SCHEMA,
    runId,
    status: 'failed',
    zeroUnexplainedFindings: false,
    authorities: {
      typespec: 'independently-authored',
      jsonSchema: 'independently-authored',
      precedence: 'none',
    },
    error: errorObject,
    context,
    findings: [],
  };
}

export async function runCheck(options) {
  await assertOutputSeparation(options.authoredSchema, options.outputDir);
  const mapping = await loadMapping(options.mapping);
  const typespecBefore = await inventoryTypeSpec(options.typespec);
  const authoredBefore = await loadSchemaCollection(options.authoredSchema, { requireDialect: true });

  const emitter = await emitTypeSpecJsonSchema({
    entry: options.typespec,
    outputDir: options.outputDir,
    bundleId: options.bundleId,
    tspBin: options.tspBin,
    int64Strategy: options.int64Strategy,
    sealObjectSchemas: options.sealObjectSchemas,
    polymorphicModelsStrategy: options.polymorphicModelsStrategy,
  });

  const typespecAfter = await inventoryTypeSpec(options.typespec);
  const authoredAfter = await loadSchemaCollection(options.authoredSchema, { requireDialect: true });
  if (typespecAfter.digest !== typespecBefore.digest) {
    throw new Error('TypeSpec source changed while generating comparison evidence');
  }
  if (authoredAfter.digest !== authoredBefore.digest) {
    throw new Error('authored JSON Schema changed while generating comparison evidence');
  }

  const generated = await loadSchemaCollection(emitter.generatedPath, { requireDialect: true });
  const parity = compareParity({
    typespecInventory: typespecBefore,
    generatedCollection: generated,
    authoredCollection: authoredBefore,
    mapping,
    maxFindings: options.maxFindings,
  });
  const tspVersion = await toolVersion(emitter.tspBin);
  return buildPassedOrStoppedReport({
    mode: 'check',
    options,
    typespecInventory: typespecBefore,
    generatedCollection: generated,
    authoredCollection: authoredBefore,
    mapping,
    parity,
    emitter,
    tspVersion,
  });
}

export async function runCompare(options) {
  const mapping = await loadMapping(options.mapping);
  const typespecInventory = await inventoryTypeSpec(options.typespec);
  const generated = await loadSchemaCollection(options.generatedSchema, { requireDialect: true });
  const authored = await loadSchemaCollection(options.authoredSchema, { requireDialect: true });
  const parity = compareParity({
    typespecInventory,
    generatedCollection: generated,
    authoredCollection: authored,
    mapping,
    maxFindings: options.maxFindings,
  });
  const tspBin = await resolveTspBinary(options.tspBin);
  const tspVersion = await toolVersion(tspBin);
  return buildPassedOrStoppedReport({
    mode: 'compare',
    options,
    typespecInventory,
    generatedCollection: generated,
    authoredCollection: authored,
    mapping,
    parity,
    emitter: null,
    tspVersion,
  });
}
