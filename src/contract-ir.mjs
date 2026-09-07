import { relative, resolve } from 'node:path';
import {
  canonicalStringify,
  normalizeSchemaNodeForComparison,
  sha256,
} from './canonical.mjs';
import { loadSchemaCollection } from './json-schema.mjs';
import { declarationKindFamily, inventoryTypeSpec } from './typespec-inventory.mjs';
import { writeContractIrFile } from './contract-ir-file.mjs';

export const CONTRACT_IR_SCHEMA = 'ores.typespec-json-schema-validator.contract-ir/v1';
export const CONTRACT_IR_VERIFICATION_SCHEMA =
  'ores.typespec-json-schema-validator.contract-ir-verification/v1';
const REPORT_SCHEMA = 'ores.typespec-json-schema-validator.report/v1';
const HEX_256 = /^[a-f0-9]{64}$/u;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(`cannot build admissible Contract IR: ${message}`);
  }
}

function digestJson(value) {
  return sha256(canonicalStringify(value));
}

function reportDigest(report) {
  return digestJson(report);
}

function normalizeFile(path, root) {
  const rendered = relative(resolve(root), resolve(path)).replaceAll('\\', '/');
  return rendered && !rendered.startsWith('../') ? rendered : resolve(path).replaceAll('\\', '/');
}

function schemaSource(collection, declaration) {
  const document = collection.documents.find((item) => resolve(item.path) === resolve(declaration.source));
  return {
    file: document?.relativePath ?? normalizeFile(declaration.source, collection.input),
    pointer: declaration.pointer,
  };
}

function schemaKindFamily(kind) {
  return kind === 'scalar' || kind === 'scalar-like' || kind === 'alias' ? 'scalar-like' : kind;
}

function assertPassedReceipt(report) {
  requireCondition(isObject(report), 'receipt must be an object');
  requireCondition(report.schema === REPORT_SCHEMA, `receipt schema must be ${REPORT_SCHEMA}`);
  requireCondition(typeof report.runId === 'string' && HEX_256.test(report.runId), 'receipt runId is invalid');
  requireCondition(report.status === 'passed', 'receipt status must be passed');
  requireCondition(report.zeroUnexplainedFindings === true, 'receipt must have zero unexplained findings');
  requireCondition(Array.isArray(report.findings) && report.findings.length === 0, 'receipt findings must be empty');
  requireCondition(isObject(report.coverage), 'receipt coverage is missing');
  requireCondition(report.coverage.directDeclarationInventory === true, 'direct TypeSpec declaration inventory was not executed');
  requireCondition(
    report.coverage.typespecGeneratedJsonSchemaComparison === true,
    'TypeSpec-generated JSON Schema comparison was not executed',
  );
  requireCondition(
    report.coverage.differentialInstanceValidation === true,
    'differential instance validation was not executed',
  );
  requireCondition(isObject(report.inputs), 'receipt inputs are missing');
  for (const [lane, input] of [
    ['TypeSpec', report.inputs.typespec],
    ['authored JSON Schema', report.inputs.authoredJsonSchema],
    ['generated JSON Schema', report.inputs.generatedJsonSchema],
  ]) {
    requireCondition(isObject(input), `${lane} input evidence is missing`);
    requireCondition(typeof input.digest === 'string' && HEX_256.test(input.digest), `${lane} digest is invalid`);
    requireCondition(Array.isArray(input.files), `${lane} file evidence is missing`);
  }
  requireCondition(Array.isArray(report.declarationMap), 'receipt declarationMap is missing');
}

function assertCurrentInputs(report, typespecInventory, generatedCollection, authoredCollection) {
  requireCondition(typespecInventory.digest === report.inputs.typespec.digest, 'TypeSpec input digest no longer matches the receipt');
  requireCondition(
    generatedCollection.digest === report.inputs.generatedJsonSchema.digest,
    'generated JSON Schema digest no longer matches the receipt',
  );
  requireCondition(
    authoredCollection.digest === report.inputs.authoredJsonSchema.digest,
    'authored JSON Schema digest no longer matches the receipt',
  );
  requireCondition(
    Array.isArray(typespecInventory.errors) && typespecInventory.errors.length === 0,
    'TypeSpec inventory contains errors',
  );
  requireCondition(
    Array.isArray(typespecInventory.ambiguities) && typespecInventory.ambiguities.length === 0,
    'TypeSpec inventory contains ambiguous declaration names',
  );
  requireCondition(
    Array.isArray(generatedCollection.findings) && generatedCollection.findings.length === 0,
    'generated JSON Schema now has structural findings',
  );
  requireCondition(
    Array.isArray(authoredCollection.findings) && authoredCollection.findings.length === 0,
    'authored JSON Schema now has structural findings',
  );
}

function declarationMaps(typespecInventory, generatedCollection, authoredCollection) {
  return {
    typespec: new Map(typespecInventory.declarations.map((item) => [item.qualifiedName, item])),
    generated: new Map(generatedCollection.declarations.map((item) => [item.name, item])),
    authored: new Map(authoredCollection.declarations.map((item) => [item.name, item])),
  };
}

function buildDeclaration(pair, maps, inputs) {
  requireCondition(isObject(pair), 'declarationMap entries must be objects');
  requireCondition(typeof pair.typespec === 'string' && pair.typespec !== '', 'mapped TypeSpec name is invalid');
  requireCondition(typeof pair.generated === 'string' && pair.generated !== '', `generated name for ${pair.typespec} is invalid`);
  requireCondition(typeof pair.authored === 'string' && pair.authored !== '', `authored name for ${pair.typespec} is invalid`);

  const typespec = maps.typespec.get(pair.typespec);
  const generated = maps.generated.get(pair.generated);
  const authored = maps.authored.get(pair.authored);
  requireCondition(typespec, `mapped TypeSpec declaration is missing: ${pair.typespec}`);
  requireCondition(generated, `mapped generated declaration is missing: ${pair.generated}`);
  requireCondition(authored, `mapped authored declaration is missing: ${pair.authored}`);

  const family = declarationKindFamily(typespec.kind);
  requireCondition(
    declarationKindFamily(pair.kind) === family,
    `receipt kind for ${pair.typespec} no longer matches the TypeSpec declaration`,
  );
  requireCondition(
    schemaKindFamily(generated.kind) === family,
    `generated declaration kind for ${pair.typespec} no longer matches`,
  );
  requireCondition(
    schemaKindFamily(authored.kind) === family,
    `authored declaration kind for ${pair.typespec} no longer matches`,
  );

  const generatedAssertionSchema = normalizeSchemaNodeForComparison(generated.schema);
  const authoredAssertionSchema = normalizeSchemaNodeForComparison(authored.schema);
  requireCondition(
    canonicalStringify(generatedAssertionSchema) === canonicalStringify(authoredAssertionSchema),
    `generated and authored assertion schemas no longer converge for ${pair.typespec}`,
  );

  const assertionDigest = digestJson(generatedAssertionSchema);
  return {
    id: pair.typespec,
    kind: family,
    names: {
      typespec: pair.typespec,
      generatedJsonSchema: pair.generated,
      authoredJsonSchema: pair.authored,
    },
    sources: {
      typespec: {
        file: normalizeFile(typespec.file, inputs.typespec.projectRoot),
        line: typespec.line,
        column: typespec.column,
      },
      generatedJsonSchema: schemaSource(inputs.generated, generated),
      authoredJsonSchema: schemaSource(inputs.authored, authored),
    },
    assertionSchema: generatedAssertionSchema,
    assertionDigest,
    lanes: {
      typespecGeneratedJsonSchema: {
        role: 'comparison-evidence-only',
        name: generated.name,
        kind: schemaKindFamily(generated.kind),
        schemaDigest: digestJson(generated.schema),
        normalizedSchema: generated.schema,
      },
      authoredJsonSchema: {
        role: 'independently-authored-authority',
        name: authored.name,
        kind: schemaKindFamily(authored.kind),
        schemaDigest: digestJson(authored.schema),
        normalizedSchema: authored.schema,
      },
    },
  };
}

function excludedDeclarations(report, inventories) {
  const admittedTypeSpec = new Set(report.declarationMap.map((item) => item.typespec));
  const admittedGenerated = new Set(report.declarationMap.map((item) => item.generated));
  const admittedAuthored = new Set(report.declarationMap.map((item) => item.authored));
  const excluded = [];

  for (const item of inventories.typespec.declarations) {
    if (!admittedTypeSpec.has(item.qualifiedName)) {
      excluded.push({
        authority: 'typespec',
        id: item.qualifiedName,
        kind: declarationKindFamily(item.kind),
        source: {
          file: normalizeFile(item.file, inventories.typespec.projectRoot),
          line: item.line,
          column: item.column,
        },
      });
    }
  }
  for (const [authority, collection, admitted] of [
    ['typespec-generated-json-schema', inventories.generated, admittedGenerated],
    ['authored-json-schema', inventories.authored, admittedAuthored],
  ]) {
    for (const item of collection.declarations) {
      if (!admitted.has(item.name)) {
        excluded.push({
          authority,
          id: item.name,
          kind: schemaKindFamily(item.kind),
          source: schemaSource(collection, item),
        });
      }
    }
  }
  return excluded.sort((left, right) =>
    canonicalStringify([left.authority, left.id]).localeCompare(canonicalStringify([right.authority, right.id])),
  );
}

function outOfScopeDeclarations(typespecInventory) {
  return (typespecInventory.outOfScopeDeclarations ?? [])
    .map((item) => ({
      authority: 'typespec',
      id: item.qualifiedName,
      kind: item.kind,
      reason: item.reason,
      source: {
        file: normalizeFile(item.file, typespecInventory.projectRoot),
        line: item.line,
        column: item.column,
      },
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function provenanceFiles(files) {
  return [...files]
    .map((item) => ({ path: item.relativePath ?? item.path, sha256: item.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Build a deterministic downstream Contract IR from already loaded evidence.
 * The two authored source lanes remain authorities; this object is derived,
 * immutable comparison output and never a source that may overwrite them.
 */
export function createContractIr({ report, typespecInventory, generatedCollection, authoredCollection }) {
  assertPassedReceipt(report);
  assertCurrentInputs(report, typespecInventory, generatedCollection, authoredCollection);

  const seen = { typespec: new Set(), generated: new Set(), authored: new Set() };
  for (const pair of report.declarationMap) {
    for (const lane of ['typespec', 'generated', 'authored']) {
      requireCondition(
        typeof pair?.[lane] === 'string' && pair[lane] !== '',
        `declarationMap ${lane} identity is invalid`,
      );
      requireCondition(
        !seen[lane].has(pair[lane]),
        `declarationMap repeats ${lane} identity ${pair[lane]}`,
      );
      seen[lane].add(pair[lane]);
    }
  }

  const maps = declarationMaps(typespecInventory, generatedCollection, authoredCollection);
  const inputs = {
    typespec: typespecInventory,
    generated: generatedCollection,
    authored: authoredCollection,
  };
  const declarations = [...report.declarationMap]
    .sort((left, right) => left.typespec.localeCompare(right.typespec))
    .map((pair) => buildDeclaration(pair, maps, inputs));
  const excluded = excludedDeclarations(report, inputs);
  const outOfScope = outOfScopeDeclarations(typespecInventory);
  const receipt = {
    schema: report.schema,
    runId: report.runId,
    digest: reportDigest(report),
    status: report.status,
    zeroUnexplainedFindings: report.zeroUnexplainedFindings,
  };

  const body = {
    schema: CONTRACT_IR_SCHEMA,
    status: 'passed',
    admissible: true,
    role: 'downstream-derived-parity-artifact',
    editableAuthority: false,
    authorities: {
      typespec: 'independently-authored',
      jsonSchema: 'independently-authored',
      generatedJsonSchema: 'comparison-evidence-only',
      precedence: 'none',
    },
    admission: {
      receipt,
      requirements: {
        exactInputDigests: true,
        directDeclarationInventory: true,
        generatedSchemaComparison: true,
        differentialInstanceValidation: true,
        zeroUnexplainedFindings: true,
      },
      scope: {
        admittedDeclarations: declarations.length,
        excludedDeclarations: excluded.length,
        outOfScopeDeclarations: outOfScope.length,
        complete: excluded.length === 0 && outOfScope.length === 0,
      },
    },
    provenance: {
      typespec: {
        role: 'independently-authored-authority',
        digest: typespecInventory.digest,
        files: provenanceFiles(typespecInventory.files),
      },
      generatedJsonSchema: {
        role: 'comparison-evidence-only',
        digest: generatedCollection.digest,
        files: provenanceFiles(generatedCollection.documents),
      },
      authoredJsonSchema: {
        role: 'independently-authored-authority',
        digest: authoredCollection.digest,
        files: provenanceFiles(authoredCollection.documents),
      },
    },
    toolchain: report.toolchain ?? null,
    configuration: report.configuration ?? null,
    coverage: report.coverage,
    differential: report.differential?.summary ?? null,
    declarations,
    excludedDeclarations: excluded,
    outOfScopeDeclarations: outOfScope,
  };
  return { ...body, irId: digestJson(body) };
}

export async function buildContractIr({ report, typespec, generatedSchema, authoredSchema }) {
  const typespecInput = typespec ?? report?.inputs?.typespec?.input;
  const generatedInput = generatedSchema ?? report?.inputs?.generatedJsonSchema?.input;
  const authoredInput = authoredSchema ?? report?.inputs?.authoredJsonSchema?.input;
  requireCondition(typeof typespecInput === 'string' && typespecInput !== '', 'TypeSpec input path is missing');
  requireCondition(typeof generatedInput === 'string' && generatedInput !== '', 'generated JSON Schema path is missing');
  requireCondition(typeof authoredInput === 'string' && authoredInput !== '', 'authored JSON Schema path is missing');
  const [typespecInventory, generatedCollection, authoredCollection] = await Promise.all([
    inventoryTypeSpec(typespecInput),
    loadSchemaCollection(generatedInput, { requireDialect: true }),
    loadSchemaCollection(authoredInput, { requireDialect: true }),
  ]);
  return createContractIr({ report, typespecInventory, generatedCollection, authoredCollection });
}

export function buildContractIrTombstone(report, reason = 'parity-receipt-not-admissible') {
  requireCondition(isObject(report), 'receipt must be an object');
  requireCondition(report.schema === REPORT_SCHEMA, `receipt schema must be ${REPORT_SCHEMA}`);
  requireCondition(typeof report.runId === 'string' && HEX_256.test(report.runId), 'receipt runId is invalid');
  requireCondition(['passed', 'stopped_for_evaluation', 'failed'].includes(report.status), 'receipt status is invalid');
  const body = {
    schema: CONTRACT_IR_SCHEMA,
    status: report.status === 'passed' ? 'failed' : report.status,
    admissible: false,
    role: 'downstream-derived-parity-artifact',
    editableAuthority: false,
    authorities: {
      typespec: 'independently-authored',
      jsonSchema: 'independently-authored',
      generatedJsonSchema: 'comparison-evidence-only',
      precedence: 'none',
    },
    admission: {
      receipt: {
        schema: report.schema,
        runId: report.runId,
        digest: reportDigest(report),
        status: report.status,
        zeroUnexplainedFindings: report.zeroUnexplainedFindings === true,
      },
      reason,
    },
    declarations: [],
    excludedDeclarations: [],
    outOfScopeDeclarations: [],
  };
  return { ...body, irId: digestJson(body) };
}

function verificationResult({ contractIr, report, expected, error = null }) {
  const suppliedBody = isObject(contractIr) ? { ...contractIr } : null;
  const suppliedIrId = suppliedBody?.irId;
  if (suppliedBody) delete suppliedBody.irId;
  const selfDigest = suppliedBody ? digestJson(suppliedBody) : null;
  const matchesSelf = typeof suppliedIrId === 'string' && HEX_256.test(suppliedIrId) && suppliedIrId === selfDigest;
  const matchesCurrent = expected !== undefined && canonicalStringify(contractIr) === canonicalStringify(expected);
  const status = matchesSelf && matchesCurrent ? 'passed' : 'failed';
  return {
    schema: CONTRACT_IR_VERIFICATION_SCHEMA,
    status,
    admissible: status === 'passed',
    suppliedIrId: typeof suppliedIrId === 'string' ? suppliedIrId : null,
    computedIrId: selfDigest,
    expectedIrId: expected?.irId ?? null,
    receiptRunId: report?.runId ?? null,
    error,
  };
}

export function verifyContractIrEvidence({
  contractIr,
  report,
  typespecInventory,
  generatedCollection,
  authoredCollection,
}) {
  try {
    const expected = createContractIr({ report, typespecInventory, generatedCollection, authoredCollection });
    return verificationResult({ contractIr, report, expected });
  } catch (caught) {
    return verificationResult({
      contractIr,
      report,
      expected: undefined,
      error: caught instanceof Error ? caught.message : String(caught),
    });
  }
}

export async function verifyContractIr({ contractIr, report, typespec, generatedSchema, authoredSchema }) {
  try {
    const typespecInput = typespec ?? report?.inputs?.typespec?.input;
    const generatedInput = generatedSchema ?? report?.inputs?.generatedJsonSchema?.input;
    const authoredInput = authoredSchema ?? report?.inputs?.authoredJsonSchema?.input;
    requireCondition(typeof typespecInput === 'string' && typespecInput !== '', 'TypeSpec input path is missing');
    requireCondition(typeof generatedInput === 'string' && generatedInput !== '', 'generated JSON Schema path is missing');
    requireCondition(typeof authoredInput === 'string' && authoredInput !== '', 'authored JSON Schema path is missing');
    const [typespecInventory, generatedCollection, authoredCollection] = await Promise.all([
      inventoryTypeSpec(typespecInput),
      loadSchemaCollection(generatedInput, { requireDialect: true }),
      loadSchemaCollection(authoredInput, { requireDialect: true }),
    ]);
    return verifyContractIrEvidence({
      contractIr,
      report,
      typespecInventory,
      generatedCollection,
      authoredCollection,
    });
  } catch (caught) {
    return verificationResult({
      contractIr,
      report,
      expected: undefined,
      error: caught instanceof Error ? caught.message : String(caught),
    });
  }
}

export async function writeContractIr(path, contractIr) {
  return writeContractIrFile(path, `${canonicalStringify(contractIr, 2)}\n`, CONTRACT_IR_SCHEMA);
}
