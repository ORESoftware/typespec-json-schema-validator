import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  canonicalStringify,
  deepDiff,
  normalizeSchemaNode,
  stableFindingFingerprint,
} from './canonical.mjs';
import { declarationKindFamily } from './typespec-inventory.mjs';

export const MAPPING_SCHEMA = 'ores.typespec-json-schema-validator.mapping/v1';

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
  if (value.schema !== MAPPING_SCHEMA) {
    throw new Error(`mapping file ${absolute} must declare schema ${MAPPING_SCHEMA}`);
  }
  if (!Array.isArray(value.declarations)) {
    throw new Error(`mapping file ${absolute} must contain a declarations array`);
  }
  for (const [index, declaration] of value.declarations.entries()) {
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
      throw new Error(`mapping declaration ${index} must be an object`);
    }
    if (typeof declaration.typespec !== 'string' || declaration.typespec.length === 0) {
      throw new Error(`mapping declaration ${index} must provide a non-empty typespec name`);
    }
    for (const key of ['generated', 'authored']) {
      if (declaration[key] !== undefined && (typeof declaration[key] !== 'string' || declaration[key].length === 0)) {
        throw new Error(`mapping declaration ${index}.${key} must be a non-empty string when present`);
      }
    }
  }
  const ignore = value.ignore ?? {};
  for (const key of ['typespec', 'generated', 'authored']) {
    if (ignore[key] !== undefined && (!Array.isArray(ignore[key]) || ignore[key].some((item) => typeof item !== 'string'))) {
      throw new Error(`mapping ignore.${key} must be an array of strings`);
    }
  }
  return {
    schema: MAPPING_SCHEMA,
    declarations: value.declarations,
    ignore: {
      typespec: ignore.typespec ?? [],
      generated: ignore.generated ?? [],
      authored: ignore.authored ?? [],
    },
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

function compareSchemaInventories(generatedMap, authoredMap, findings) {
  const names = [...new Set([...generatedMap.keys(), ...authoredMap.keys()])].sort();
  for (const name of names) {
    const generated = generatedMap.get(name);
    const authored = authoredMap.get(name);
    if (!generated || !authored) {
      findings.push(
        makeFinding({
          ruleId: 'generated-authored-declaration-set-mismatch',
          comparison: 'generated-vs-authored-inventory',
          declaration: name,
          pointer: generated?.pointer ?? authored?.pointer ?? '#',
          message: `declaration ${name} is present in only one JSON Schema lane`,
          left: generated ? { authority: 'typespec-generated-json-schema', kind: generated.kind } : undefined,
          right: authored ? { authority: 'authored-json-schema', kind: authored.kind } : undefined,
        }),
      );
      continue;
    }
    if (schemaKindFamily(generated.kind) !== schemaKindFamily(authored.kind)) {
      findings.push(
        makeFinding({
          ruleId: 'generated-authored-kind-mismatch',
          comparison: 'generated-vs-authored-inventory',
          declaration: name,
          pointer: authored.pointer,
          message: `generated and authored JSON Schema declarations disagree on kind for ${name}`,
          left: generated.kind,
          right: authored.kind,
        }),
      );
    }
  }
}

function compareSemanticSchemas(generatedMap, authoredMap, maxFindings, findings) {
  const commonNames = [...generatedMap.keys()].filter((name) => authoredMap.has(name)).sort();
  for (const name of commonNames) {
    if (findings.length >= maxFindings) {
      break;
    }
    const generated = generatedMap.get(name);
    const authored = authoredMap.get(name);
    const left = normalizeSchemaNode(generated.schema);
    const right = normalizeSchemaNode(authored.schema);
    const remaining = Math.max(1, maxFindings - findings.length);
    const { differences } = deepDiff(left, right, { maxFindings: remaining });
    for (const difference of differences) {
      findings.push(
        makeFinding({
          ruleId: 'generated-authored-semantic-mismatch',
          comparison: 'typespec-generated-vs-authored-json-schema',
          declaration: name,
          pointer: `${authored.pointer}${difference.pointer === '#' ? '' : difference.pointer.slice(1)}`,
          message: `TypeSpec-generated JSON Schema and independently authored JSON Schema differ for ${name} at ${difference.pointer}`,
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

export function compareParity({
  typespecInventory,
  generatedCollection,
  authoredCollection,
  mapping,
  maxFindings = 250,
}) {
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

  const expected = buildExpectedDeclarations(typespecInventory, mapping, findings);
  const generatedMap = buildSchemaMap(generatedCollection, mapping.ignore.generated);
  const authoredMap = buildSchemaMap(authoredCollection, mapping.ignore.authored);

  compareExpectedToSchema(expected, generatedMap, 'generated', findings);
  compareExpectedToSchema(expected, authoredMap, 'authored', findings);
  compareSchemaInventories(generatedMap, authoredMap, findings);
  compareSemanticSchemas(generatedMap, authoredMap, maxFindings, findings);

  const sorted = findings
    .slice(0, maxFindings)
    .sort((left, right) =>
      canonicalStringify([
        left.ruleId,
        left.declaration ?? '',
        left.pointer ?? '',
        left.fingerprint,
      ]).localeCompare(
        canonicalStringify([
          right.ruleId,
          right.declaration ?? '',
          right.pointer ?? '',
          right.fingerprint,
        ]),
      ),
    );

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
