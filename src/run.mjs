import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify, sha256, stableFindingFingerprint } from './canonical.mjs';
import { emitTypeSpecJsonSchema, resolveTspBinary, toolVersion } from './emitter.mjs';
import { crossValidate, loadInstanceCorpus } from './differential.mjs';
import { loadSchemaCollection } from './json-schema.mjs';
import { compareParity, loadMapping, sortFindings } from './parity.mjs';
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

function summaryCounts(typespecInventory, generatedCollection, authoredCollection, parity, differential, emitted) {
  const differentialFindingCount = differential ? differential.findings.length : 0;
  return {
    typespecDeclarations: typespecInventory ? typespecInventory.declarations.length : null,
    typespecOutOfScopeDeclarations: typespecInventory ? typespecInventory.outOfScopeDeclarations.length : null,
    generatedDeclarations: generatedCollection.declarations.length,
    authoredDeclarations: authoredCollection.declarations.length,
    structuralFindings: parity.findingCount,
    differentialFindings: differentialFindingCount,
    findings: parity.findingCount + differentialFindingCount,
    emittedFindings: emitted.length,
    findingsTruncated: parity.truncated || parity.findingCount + differentialFindingCount > emitted.length,
  };
}

/**
 * Derive the differential lane's declaration pairs when no TypeSpec inventory is available
 * (the standalone `validate` command). Only names present in both authorities can be compared.
 */
function intersectDeclarations(generatedCollection, authoredCollection, mapping) {
  const ignoredGenerated = new Set(mapping.ignore.generated);
  const ignoredAuthored = new Set(mapping.ignore.authored);
  const explicit = new Map();
  for (const entry of mapping.declarations) {
    explicit.set(entry.generated ?? entry.typespec, entry);
  }
  const authoredNames = new Set(authoredCollection.declarations.map((item) => item.name));
  const pairs = [];
  for (const declaration of generatedCollection.declarations) {
    if (ignoredGenerated.has(declaration.name)) {
      continue;
    }
    const entry = explicit.get(declaration.name);
    const authoredName = entry?.authored ?? declaration.name;
    if (ignoredAuthored.has(authoredName) || !authoredNames.has(authoredName)) {
      continue;
    }
    pairs.push({ typespec: entry?.typespec ?? declaration.name, generated: declaration.name, authored: authoredName });
  }
  return pairs.sort((left, right) => left.generated.localeCompare(right.generated));
}

/**
 * Run the differential lane unless it has been explicitly disabled.
 *
 * @returns {Promise<object|null>} `null` when the lane is switched off.
 */
async function runDifferentialLane(options, generatedCollection, authoredCollection, declarationMap) {
  if (options.probes === false) {
    return null;
  }
  const corpus = await loadInstanceCorpus(options.instances);
  return crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap,
    corpus,
    maxProbes: options.maxProbes ?? 64,
    maxFindings: options.maxFindings,
    formatAssertion: options.formatAssertion === true,
  });
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
  differential,
  emitter,
  tspVersion,
}) {
  const version = await packageVersion();
  const emittedFindings = sortFindings([...parity.findings, ...(differential?.findings ?? [])]).slice(
    0,
    options.maxFindings,
  );
  const totalFindings = parity.findingCount + (differential?.findings.length ?? 0);
  const status = totalFindings === 0 ? 'passed' : 'stopped_for_evaluation';
  const configuration = {
    mode,
    maxFindings: options.maxFindings,
    bundleId: emitter?.bundleId ?? null,
    emitter: emitter?.emitter ?? null,
    emitterOptions: emitter?.emitterOptions ?? null,
    executionMode: emitter?.executionMode ?? null,
    mappingSchema: mapping.schema,
    differential: {
      enabled: differential !== null && differential !== undefined,
      maxProbesPerDeclarationPerLane: options.maxProbes ?? 64,
      formatAssertion: options.formatAssertion === true,
      instanceCorpus: options.instances ? relativeDisplay(options.instances) : null,
    },
  };
  const inputs = {
    typespec: typespecInventory
      ? {
        input: relativeDisplay(typespecInventory.input),
        digest: typespecInventory.digest,
        files: typespecInventory.files,
      }
      : null,
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
      typespec: typespecInventory?.digest ?? null,
      authored: authoredCollection.digest,
      generated: generatedCollection.digest,
    },
    toolchain,
    findings: emittedFindings.map((finding) => finding.fingerprint),
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
      directDeclarationInventory: typespecInventory !== null && typespecInventory !== undefined,
      typespecGeneratedJsonSchemaComparison: true,
      differentialInstanceValidation: differential !== null && differential !== undefined,
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
        'instance-level verdict agreement over a synthesized probe corpus',
      ],
      outOfScopeTypeSpecDeclarations: (typespecInventory?.outOfScopeDeclarations ?? []).map((declaration) => ({
        qualifiedName: declaration.qualifiedName,
        kind: declaration.kind,
        reason: declaration.reason,
      })),
    },
    counts: summaryCounts(typespecInventory, generatedCollection, authoredCollection, parity, differential, emittedFindings),
    declarationMap: parity.expectedDeclarations,
    differential: differential
      ? { summary: differential.summary, declarations: differential.declarations }
      : { summary: null, declarations: [], disabled: true },
    zeroUnexplainedFindings: totalFindings === 0,
    findings: emittedFindings,
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
      `declarations: TypeSpec=${report.counts.typespecDeclarations ?? 'n/a'}, generated=${report.counts.generatedDeclarations}, authored=${report.counts.authoredDeclarations}`,
      `findings: ${report.counts.findings} (structural ${report.counts.structuralFindings ?? 0}, differential ${
        report.counts.differentialFindings ?? 0
      })${report.counts.findingsTruncated ? ' — report truncated' : ''}`,
    );
  }
  if (report.differential?.summary) {
    const { probesEvaluated, agreements, divergences, refusals, comparedDeclarations } = report.differential.summary;
    lines.push(
      `differential: ${comparedDeclarations} declarations, ${probesEvaluated} probes, ${agreements} agreements, ${divergences} divergences, ${refusals} refusals`,
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
  const differential = await runDifferentialLane(options, generated, authoredBefore, parity.expectedDeclarations);
  const tspVersion = await toolVersion(emitter.tspBin);
  return buildPassedOrStoppedReport({
    mode: 'check',
    options,
    typespecInventory: typespecBefore,
    generatedCollection: generated,
    authoredCollection: authoredBefore,
    mapping,
    parity,
    differential,
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
  const differential = await runDifferentialLane(options, generated, authored, parity.expectedDeclarations);
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
    differential,
    emitter: null,
    tspVersion,
  });
}

/**
 * Execute only the differential lane.
 *
 * `validate` is the direct expression of "schema A validates B": the independently authored
 * JSON Schema is run as a validator over instances drawn from the TypeSpec-generated schema
 * (and vice versa), with no TypeSpec compiler required. It is the lane to reach for when the
 * generated witness already exists — in CI, downstream of a `generate` step, or when checking a
 * recorded payload corpus against both authorities.
 */
export async function runValidate(options) {
  const mapping = await loadMapping(options.mapping);
  const generated = await loadSchemaCollection(options.generatedSchema, { requireDialect: true });
  const authored = await loadSchemaCollection(options.authoredSchema, { requireDialect: true });
  const declarationMap = intersectDeclarations(generated, authored, mapping);
  const structuralFindings = sortFindings([...generated.findings, ...authored.findings].map((item) => ({
    ...item,
    resolutionState: 'unexplained',
    fingerprint: stableFindingFingerprint(item),
  })));
  const parity = {
    findings: structuralFindings,
    findingCount: structuralFindings.length,
    truncated: false,
    expectedDeclarations: declarationMap,
  };
  const differential = await runDifferentialLane(options, generated, authored, declarationMap);
  return buildPassedOrStoppedReport({
    mode: 'validate',
    options,
    typespecInventory: null,
    generatedCollection: generated,
    authoredCollection: authored,
    mapping,
    parity,
    differential,
    emitter: null,
    tspVersion: { command: null, available: null, version: null },
  });
}
