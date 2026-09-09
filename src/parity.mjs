import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertFindingLimit } from './finding-limit.mjs';
import {
  canonicalStringify,
  deepDiff,
  escapeJsonPointerSegment,
  normalizeComparisonRef,
  normalizeSchemaNodeForComparison,
  stableFindingFingerprint,
} from './canonical.mjs';
import {
  auditMappingIntegrity,
  validateAndNormalizeMapping,
} from './mapping-integrity.mjs';
import { declarationKindFamily } from './typespec-inventory.mjs';

export const MAPPING_SCHEMA = 'ores.typespec-json-schema-validator.mapping/v1';

const SCHEMA_MAP_KEYS = new Set([
  '$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas',
]);
const SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_SINGLE_KEYS = new Set([
  'additionalItems', 'additionalProperties', 'contains', 'contentSchema', 'else',
  'if', 'items', 'not', 'propertyNames', 'then', 'unevaluatedItems',
  'unevaluatedProperties',
]);

function makeFinding(input) {
  const finding = {
    severity: 'error',
    resolutionState: 'unexplained',
    ...input,
  };
  finding.fingerprint = stableFindingFingerprint(finding);
  return finding;
}

export async function loadMapping(path) {
  if (!path) {
    return {
      schema: MAPPING_SCHEMA,
      declarations: [],
      ignore: { typespec: [], generated: [], authored: [] },
    };
  }
  const absolute = resolve(path);
  const raw = await readFile(absolute, 'utf8');
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid mapping JSON in ${absolute}: ${error.message}`, { cause: error });
  }
  const normalized = validateAndNormalizeMapping(value, {
    schema: MAPPING_SCHEMA,
    source: `mapping file ${absolute}`,
  });
  return {
    ...normalized,
    source: absolute,
  };
}

function mappingForTypeSpec(declaration, mapping) {
  return mapping.declarations.find(
    (entry) => entry.typespec === declaration.qualifiedName || entry.typespec === declaration.name,
  );
}

function buildExpectedDeclarations(typespecInventory, mapping, findings) {
  const ignored = new Set(mapping.ignore.typespec);
  const result = new Map();
  for (const declaration of typespecInventory.declarations) {
    if (ignored.has(declaration.qualifiedName) || ignored.has(declaration.name)) {
      continue;
    }
    const entry = mappingForTypeSpec(declaration, mapping);
    const generatedName = entry?.generated ?? declaration.name;
    const authoredName = entry?.authored ?? generatedName;
    const expected = { declaration, generatedName, authoredName };
    const key = declaration.qualifiedName;
    result.set(key, expected);
  }

  const generatedNames = new Map();
  const authoredNames = new Map();
  for (const expected of result.values()) {
    for (const [label, name, names] of [
      ['generated', expected.generatedName, generatedNames],
      ['authored', expected.authoredName, authoredNames],
    ]) {
      const previous = names.get(name);
      if (previous) {
        findings.push(
          makeFinding({
            ruleId: 'mapping-target-collision',
            comparison: 'declaration-inventory',
            declaration: name,
            pointer: '#',
            message: `${label} declaration name ${name} maps from both ${previous.declaration.qualifiedName} and ${expected.declaration.qualifiedName}`,
            left: previous.declaration.qualifiedName,
            right: expected.declaration.qualifiedName,
          }),
        );
      } else {
        names.set(name, expected);
      }
    }
  }
  return result;
}

function buildSchemaMap(collection, ignoredNames) {
  const ignored = new Set(ignoredNames);
  return new Map(collection.declarations.filter((declaration) => !ignored.has(declaration.name)).map((item) => [item.name, item]));
}

function schemaKindFamily(kind) {
  return kind === 'scalar' || kind === 'scalar-like' || kind === 'alias' ? 'scalar-like' : kind;
}

function compareExpectedToSchema(expectedDeclarations, schemaMap, lane, findings) {
  const expectedNames = new Set();
  for (const expected of expectedDeclarations.values()) {
    const schemaName = lane === 'generated' ? expected.generatedName : expected.authoredName;
    expectedNames.add(schemaName);
    const actual = schemaMap.get(schemaName);
    if (!actual) {
      findings.push(
        makeFinding({
          ruleId: `${lane}-declaration-missing`,
          comparison: 'declaration-inventory',
          declaration: schemaName,
          pointer: '#',
          message: `${lane} JSON Schema is missing TypeSpec declaration ${expected.declaration.qualifiedName} mapped to ${schemaName}`,
          left: {
            authority: 'typespec',
            kind: expected.declaration.kind,
            qualifiedName: expected.declaration.qualifiedName,
          },
          right: undefined,
        }),
      );
      continue;
    }
    const expectedKind = declarationKindFamily(expected.declaration.kind);
    const actualKind = schemaKindFamily(actual.kind);
    if (expectedKind !== actualKind) {
      findings.push(
        makeFinding({
          ruleId: `${lane}-declaration-kind-mismatch`,
          comparison: 'declaration-inventory',
          declaration: schemaName,
          pointer: actual.pointer,
          message: `${lane} declaration ${schemaName} has kind ${actualKind}; TypeSpec ${expected.declaration.qualifiedName} has kind ${expectedKind}`,
          left: expectedKind,
          right: actualKind,
        }),
      );
    }
  }

  for (const [name, actual] of [...schemaMap.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!expectedNames.has(name)) {
      findings.push(
        makeFinding({
          ruleId: `${lane}-declaration-extra`,
          comparison: 'declaration-inventory',
          declaration: name,
          pointer: actual.pointer,
          message: `${lane} JSON Schema declaration ${name} has no independently authored TypeSpec peer`,
          left: undefined,
          right: { authority: lane, kind: actual.kind, name },
        }),
      );
    }
  }
}

function compareSchemaInventories(generatedMap, authoredMap, expectedDeclarations, findings) {
  for (const expected of [...expectedDeclarations.values()].sort((left, right) =>
    left.declaration.qualifiedName.localeCompare(right.declaration.qualifiedName),
  )) {
    const generated = generatedMap.get(expected.generatedName);
    const authored = authoredMap.get(expected.authoredName);
    if (!generated || !authored) {
      if (generated || authored) {
        findings.push(
          makeFinding({
            ruleId: 'generated-authored-declaration-set-mismatch',
            comparison: 'generated-vs-authored-inventory',
            declaration: expected.declaration.qualifiedName,
            pointer: generated?.pointer ?? authored?.pointer ?? '#',
            message: `generated and authored JSON Schema lanes do not both contain ${expected.declaration.qualifiedName}`,
            left: generated
              ? { authority: 'typespec-generated-json-schema', name: expected.generatedName, kind: generated.kind }
              : undefined,
            right: authored
              ? { authority: 'authored-json-schema', name: expected.authoredName, kind: authored.kind }
              : undefined,
          }),
        );
      }
      continue;
    }
    if (schemaKindFamily(generated.kind) !== schemaKindFamily(authored.kind)) {
      findings.push(
        makeFinding({
          ruleId: 'generated-authored-kind-mismatch',
          comparison: 'generated-vs-authored-inventory',
          declaration: expected.declaration.qualifiedName,
          pointer: authored.pointer,
          message: `generated and authored JSON Schema declarations disagree on kind for ${expected.declaration.qualifiedName}`,
          left: generated.kind,
          right: authored.kind,
        }),
      );
    }
  }
}

function normalizedDeclarationRef(name) {
  return normalizeComparisonRef(`#/$defs/${escapeJsonPointerSegment(name)}`);
}

function buildReferenceAliases(expectedDeclarations, lane) {
  const aliases = new Map();
  const ambiguous = new Set();
  for (const expected of expectedDeclarations.values()) {
    const name = lane === 'generated' ? expected.generatedName : expected.authoredName;
    const source = normalizedDeclarationRef(name);
    const target = normalizedDeclarationRef(expected.declaration.qualifiedName);
    if (aliases.has(source) && aliases.get(source) !== target) {
      aliases.delete(source);
      ambiguous.add(source);
    } else if (!ambiguous.has(source)) {
      aliases.set(source, target);
    }
  }
  return aliases;
}

/**
 * Rewrite only comparison-normalized $refs that point at mapped top-level
 * declarations. Literal JSON under const/enum/default/extensions is opaque and
 * must never be interpreted as schema syntax. Executable schemas are untouched.
 */
function aliasMappedDeclarationRefs(value, aliases) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === '$ref' && typeof child === 'string') {
      return [key, aliases.get(child) ?? child];
    }
    if (SCHEMA_MAP_KEYS.has(key) && child !== null && typeof child === 'object' && !Array.isArray(child)) {
      return [key, Object.fromEntries(Object.entries(child).map(([name, schema]) =>
        [name, aliasMappedDeclarationRefs(schema, aliases)]))];
    }
    if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(child)) {
      return [key, child.map((schema) => aliasMappedDeclarationRefs(schema, aliases))];
    }
    if (SCHEMA_SINGLE_KEYS.has(key)) {
      if (key === 'items' && Array.isArray(child)) {
        return [key, child.map((schema) => aliasMappedDeclarationRefs(schema, aliases))];
      }
      return [key, aliasMappedDeclarationRefs(child, aliases)];
    }
    if (key === 'dependencies' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
      return [key, Object.fromEntries(Object.entries(child).map(([name, dependency]) => [
        name,
        Array.isArray(dependency) ? dependency : aliasMappedDeclarationRefs(dependency, aliases),
      ]))];
    }
    return [key, child];
  }));
}

function compareSemanticSchemas(generatedMap, authoredMap, expectedDeclarations, maxFindings, findings) {
  const expected = [...expectedDeclarations.values()].sort((left, right) =>
    left.declaration.qualifiedName.localeCompare(right.declaration.qualifiedName),
  );
  const generatedAliases = buildReferenceAliases(expectedDeclarations, 'generated');
  const authoredAliases = buildReferenceAliases(expectedDeclarations, 'authored');
  for (const pair of expected) {
    if (findings.length >= maxFindings) {
      break;
    }
    const generated = generatedMap.get(pair.generatedName);
    const authored = authoredMap.get(pair.authoredName);
    if (!generated || !authored) {
      continue;
    }
    // Comparison normalization may erase non-assertion presentation metadata
    // and unify declaration identities. Mapping aliases are applied only to
    // recognized top-level declaration $refs in this comparison-only copy.
    // Executable collections remain untouched so their $id resource graphs and
    // probe annotations continue to resolve using each authority's own names.
    const left = aliasMappedDeclarationRefs(
      normalizeSchemaNodeForComparison(generated.schema),
      generatedAliases,
    );
    const right = aliasMappedDeclarationRefs(
      normalizeSchemaNodeForComparison(authored.schema),
      authoredAliases,
    );
    const remaining = Math.max(1, maxFindings - findings.length);
    const { differences } = deepDiff(left, right, { maxFindings: remaining });
    for (const difference of differences) {
      findings.push(
        makeFinding({
          ruleId: 'generated-authored-semantic-mismatch',
          comparison: 'typespec-generated-vs-authored-json-schema',
          declaration: pair.declaration.qualifiedName,
          pointer: `${authored.pointer}${difference.pointer === '#' ? '' : difference.pointer.slice(1)}`,
          message: `TypeSpec-generated JSON Schema and independently authored JSON Schema differ for ${pair.declaration.qualifiedName} at ${difference.pointer}`,
          left: difference.left,
          right: difference.right,
        }),
      );
      if (findings.length >= maxFindings) {
        break;
      }
    }
  }
}

/**
 * Deterministic finding order. Receipts must be byte-identical across runs with identical
 * inputs, so findings are ordered by their content rather than by discovery order.
 *
 * @param {Array<object>} findings
 * @returns {Array<object>} A new, sorted array.
 */
export function sortFindings(findings) {
  return [...findings].sort((left, right) =>
    canonicalStringify([left.ruleId, left.declaration ?? '', left.pointer ?? '', left.fingerprint]).localeCompare(
      canonicalStringify([right.ruleId, right.declaration ?? '', right.pointer ?? '', right.fingerprint]),
    ),
  );
}

export function compareParity({
  typespecInventory,
  generatedCollection,
  authoredCollection,
  mapping,
  maxFindings = 250,
}) {
  assertFindingLimit(maxFindings);
  const findings = [];

  for (const error of typespecInventory.errors) {
    findings.push(
      makeFinding({
        ruleId: `typespec-source-${error.code}`,
        comparison: 'typespec-source-inventory',
        declaration: undefined,
        pointer: `${error.file}:${error.line}:${error.column}`,
        message: error.message,
      }),
    );
  }
  for (const ambiguity of typespecInventory.ambiguities) {
    findings.push(
      makeFinding({
        ruleId: 'typespec-ambiguous-simple-name',
        comparison: 'typespec-source-inventory',
        declaration: ambiguity.name,
        pointer: '#',
        message: ambiguity.message,
        left: ambiguity.qualifiedNames,
        right: undefined,
      }),
    );
  }
  for (const structural of [...generatedCollection.findings, ...authoredCollection.findings]) {
    findings.push(makeFinding(structural));
  }
  for (const integrity of auditMappingIntegrity({
    typespecInventory,
    generatedCollection,
    authoredCollection,
    mapping,
  })) {
    findings.push(makeFinding(integrity));
  }

  const expected = buildExpectedDeclarations(typespecInventory, mapping, findings);
  const generatedMap = buildSchemaMap(generatedCollection, mapping.ignore.generated);
  const authoredMap = buildSchemaMap(authoredCollection, mapping.ignore.authored);

  compareExpectedToSchema(expected, generatedMap, 'generated', findings);
  compareExpectedToSchema(expected, authoredMap, 'authored', findings);
  compareSchemaInventories(generatedMap, authoredMap, expected, findings);
  compareSemanticSchemas(generatedMap, authoredMap, expected, maxFindings, findings);

  const sorted = sortFindings(findings.slice(0, maxFindings));

  return {
    findings: sorted,
    truncated: findings.length > maxFindings,
    findingCount: findings.length,
    expectedDeclarations: [...expected.values()]
      .map((entry) => ({
        typespec: entry.declaration.qualifiedName,
        kind: entry.declaration.kind,
        generated: entry.generatedName,
        authored: entry.authoredName,
      }))
      .sort((left, right) => left.typespec.localeCompare(right.typespec)),
  };
}
