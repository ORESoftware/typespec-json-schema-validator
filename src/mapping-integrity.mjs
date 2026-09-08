import { isPlainObject } from './canonical.mjs';

const ROOT_KEYS = new Set(['schema', 'declarations', 'ignore']);
const DECLARATION_KEYS = new Set(['typespec', 'generated', 'authored']);
const IGNORE_KEYS = new Set(['typespec', 'generated', 'authored']);

function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.has(key)).sort();
}

function nonEmptyName(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) {
    throw new Error(`${label} must not contain leading or trailing whitespace`);
  }
  return value;
}

function normalizeIgnoreArray(value, label) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings`);
  }
  const seen = new Set();
  return value.map((item, index) => {
    const name = nonEmptyName(item, `${label}[${index}]`);
    if (seen.has(name)) {
      throw new Error(`${label} must not contain duplicate name ${name}`);
    }
    seen.add(name);
    return name;
  });
}

/**
 * Validate the executable mapping input against the published mapping schema's
 * closed-world shape, plus cross-entry uniqueness that JSON Schema cannot
 * express by one object property.
 */
export function validateAndNormalizeMapping(value, { schema, source = 'mapping' }) {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  const rootUnknown = unknownKeys(value, ROOT_KEYS);
  if (rootUnknown.length > 0) {
    throw new Error(`${source} contains unknown properties: ${rootUnknown.join(', ')}`);
  }
  if (value.schema !== schema) {
    throw new Error(`${source} must declare schema ${schema}`);
  }
  if (!Array.isArray(value.declarations)) {
    throw new Error(`${source} must contain a declarations array`);
  }

  const seenTypeSpecNames = new Set();
  const declarations = value.declarations.map((declaration, index) => {
    if (!isPlainObject(declaration)) {
      throw new Error(`mapping declaration ${index} must be an object`);
    }
    const declarationUnknown = unknownKeys(declaration, DECLARATION_KEYS);
    if (declarationUnknown.length > 0) {
      throw new Error(
        `mapping declaration ${index} contains unknown properties: ${declarationUnknown.join(', ')}`,
      );
    }
    const typespec = nonEmptyName(
      declaration.typespec,
      `mapping declaration ${index}.typespec`,
    );
    if (seenTypeSpecNames.has(typespec)) {
      throw new Error(`mapping declarations must not repeat TypeSpec name ${typespec}`);
    }
    seenTypeSpecNames.add(typespec);

    const normalized = { typespec };
    for (const lane of ['generated', 'authored']) {
      if (declaration[lane] !== undefined) {
        normalized[lane] = nonEmptyName(
          declaration[lane],
          `mapping declaration ${index}.${lane}`,
        );
      }
    }
    return normalized;
  });

  const rawIgnore = value.ignore ?? {};
  if (!isPlainObject(rawIgnore)) {
    throw new Error('mapping ignore must be an object when present');
  }
  const ignoreUnknown = unknownKeys(rawIgnore, IGNORE_KEYS);
  if (ignoreUnknown.length > 0) {
    throw new Error(`mapping ignore contains unknown properties: ${ignoreUnknown.join(', ')}`);
  }

  return {
    schema,
    declarations,
    ignore: {
      typespec: normalizeIgnoreArray(rawIgnore.typespec, 'mapping ignore.typespec'),
      generated: normalizeIgnoreArray(rawIgnore.generated, 'mapping ignore.generated'),
      authored: normalizeIgnoreArray(rawIgnore.authored, 'mapping ignore.authored'),
    },
  };
}

function rawFinding({ ruleId, declaration, pointer, message, left, right }) {
  return {
    ruleId,
    comparison: 'mapping-integrity',
    declaration,
    pointer,
    message,
    left,
    right,
  };
}

function declarationsBySimpleName(declarations) {
  const result = new Map();
  for (const declaration of declarations) {
    const current = result.get(declaration.name) ?? [];
    current.push(declaration);
    result.set(declaration.name, current);
  }
  return result;
}

function resolveTypeSpecName(name, byQualifiedName, bySimpleName) {
  const exact = byQualifiedName.get(name);
  if (exact) {
    return { kind: 'exact', declarations: [exact] };
  }
  const simple = bySimpleName.get(name) ?? [];
  if (simple.length === 0) {
    return { kind: 'missing', declarations: [] };
  }
  if (simple.length === 1) {
    return { kind: 'simple', declarations: simple };
  }
  return { kind: 'ambiguous', declarations: simple };
}

function duplicateIndexes(values) {
  const first = new Map();
  const duplicates = [];
  values.forEach((value, index) => {
    if (first.has(value)) {
      duplicates.push({ value, firstIndex: first.get(value), index });
    } else {
      first.set(value, index);
    }
  });
  return duplicates;
}

/**
 * Audit semantic references in an already parsed mapping. This runs even for
 * programmatic API callers that bypass loadMapping, so a stale or ambiguous
 * mapping can never convert declaration drift into a passing report.
 */
export function auditMappingIntegrity({
  typespecInventory,
  generatedCollection,
  authoredCollection,
  mapping,
}) {
  const findings = [];
  const declarations = Array.isArray(typespecInventory?.declarations)
    ? typespecInventory.declarations
    : [];
  const byQualifiedName = new Map(
    declarations.map((declaration) => [declaration.qualifiedName, declaration]),
  );
  const bySimpleName = declarationsBySimpleName(declarations);
  const mappingDeclarations = Array.isArray(mapping?.declarations)
    ? mapping.declarations
    : [];
  const ignore = isPlainObject(mapping?.ignore) ? mapping.ignore : {};

  const resolvedMappings = new Map();
  const generatedTargets = new Map();
  const authoredTargets = new Map();
  const typeSpecKeys = mappingDeclarations.map((entry) => entry?.typespec);

  for (const duplicate of duplicateIndexes(typeSpecKeys)) {
    if (typeof duplicate.value !== 'string') {
      continue;
    }
    findings.push(rawFinding({
      ruleId: 'mapping-typespec-duplicate',
      declaration: duplicate.value,
      pointer: `#/declarations/${duplicate.index}/typespec`,
      message: `mapping repeats TypeSpec declaration ${duplicate.value}`,
      left: `#/declarations/${duplicate.firstIndex}`,
      right: `#/declarations/${duplicate.index}`,
    }));
  }

  for (const [index, entry] of mappingDeclarations.entries()) {
    if (!isPlainObject(entry) || typeof entry.typespec !== 'string' || entry.typespec.length === 0) {
      findings.push(rawFinding({
        ruleId: 'mapping-declaration-invalid',
        declaration: undefined,
        pointer: `#/declarations/${index}`,
        message: 'mapping declaration must provide a non-empty TypeSpec name',
        left: entry,
        right: undefined,
      }));
      continue;
    }
    const resolution = resolveTypeSpecName(entry.typespec, byQualifiedName, bySimpleName);
    if (resolution.kind === 'missing') {
      findings.push(rawFinding({
        ruleId: 'mapping-typespec-declaration-missing',
        declaration: entry.typespec,
        pointer: `#/declarations/${index}/typespec`,
        message: `mapping references TypeSpec declaration ${entry.typespec}, but that declaration does not exist`,
        left: entry.typespec,
        right: undefined,
      }));
      continue;
    }
    if (resolution.kind === 'ambiguous') {
      const qualifiedNames = resolution.declarations
        .map((declaration) => declaration.qualifiedName)
        .sort();
      findings.push(rawFinding({
        ruleId: 'mapping-typespec-simple-name-ambiguous',
        declaration: entry.typespec,
        pointer: `#/declarations/${index}/typespec`,
        message: `mapping TypeSpec name ${entry.typespec} is ambiguous; use one qualified declaration name`,
        left: entry.typespec,
        right: qualifiedNames,
      }));
      continue;
    }

    const declaration = resolution.declarations[0];
    resolvedMappings.set(declaration.qualifiedName, { entry, index, declaration });
    const generated = entry.generated ?? declaration.name;
    const authored = entry.authored ?? generated;
    generatedTargets.set(generated, declaration.qualifiedName);
    authoredTargets.set(authored, declaration.qualifiedName);
  }

  const typeSpecIgnore = Array.isArray(ignore.typespec) ? ignore.typespec : [];
  for (const duplicate of duplicateIndexes(typeSpecIgnore)) {
    findings.push(rawFinding({
      ruleId: 'mapping-ignore-duplicate',
      declaration: duplicate.value,
      pointer: `#/ignore/typespec/${duplicate.index}`,
      message: `mapping ignore.typespec repeats ${String(duplicate.value)}`,
      left: duplicate.firstIndex,
      right: duplicate.index,
    }));
  }
  for (const [index, name] of typeSpecIgnore.entries()) {
    if (typeof name !== 'string' || name.length === 0) {
      findings.push(rawFinding({
        ruleId: 'mapping-ignore-invalid-name',
        declaration: undefined,
        pointer: `#/ignore/typespec/${index}`,
        message: 'mapping ignore.typespec entries must be non-empty strings',
        left: name,
        right: undefined,
      }));
      continue;
    }
    const resolution = resolveTypeSpecName(name, byQualifiedName, bySimpleName);
    if (resolution.kind === 'missing') {
      findings.push(rawFinding({
        ruleId: 'mapping-ignore-typespec-stale',
        declaration: name,
        pointer: `#/ignore/typespec/${index}`,
        message: `mapping ignore.typespec references missing declaration ${name}`,
        left: name,
        right: undefined,
      }));
      continue;
    }
    if (resolution.kind === 'ambiguous') {
      findings.push(rawFinding({
        ruleId: 'mapping-ignore-typespec-ambiguous',
        declaration: name,
        pointer: `#/ignore/typespec/${index}`,
        message: `mapping ignore.typespec name ${name} is ambiguous; ignore qualified declarations explicitly`,
        left: name,
        right: resolution.declarations
          .map((declaration) => declaration.qualifiedName)
          .sort(),
      }));
      continue;
    }
    const declaration = resolution.declarations[0];
    const mapped = resolvedMappings.get(declaration.qualifiedName);
    if (mapped) {
      findings.push(rawFinding({
        ruleId: 'mapping-typespec-ignore-conflict',
        declaration: declaration.qualifiedName,
        pointer: `#/ignore/typespec/${index}`,
        message: `TypeSpec declaration ${declaration.qualifiedName} is both mapped and ignored`,
        left: `#/declarations/${mapped.index}`,
        right: `#/ignore/typespec/${index}`,
      }));
    }
  }

  for (const [lane, collection, targets] of [
    ['generated', generatedCollection, generatedTargets],
    ['authored', authoredCollection, authoredTargets],
  ]) {
    const names = new Set(
      (Array.isArray(collection?.declarations) ? collection.declarations : [])
        .map((declaration) => declaration.name),
    );
    const ignored = Array.isArray(ignore[lane]) ? ignore[lane] : [];
    for (const duplicate of duplicateIndexes(ignored)) {
      findings.push(rawFinding({
        ruleId: 'mapping-ignore-duplicate',
        declaration: duplicate.value,
        pointer: `#/ignore/${lane}/${duplicate.index}`,
        message: `mapping ignore.${lane} repeats ${String(duplicate.value)}`,
        left: duplicate.firstIndex,
        right: duplicate.index,
      }));
    }
    for (const [index, name] of ignored.entries()) {
      if (typeof name !== 'string' || name.length === 0) {
        findings.push(rawFinding({
          ruleId: 'mapping-ignore-invalid-name',
          declaration: undefined,
          pointer: `#/ignore/${lane}/${index}`,
          message: `mapping ignore.${lane} entries must be non-empty strings`,
          left: name,
          right: undefined,
        }));
        continue;
      }
      if (!names.has(name)) {
        findings.push(rawFinding({
          ruleId: `mapping-ignore-${lane}-stale`,
          declaration: name,
          pointer: `#/ignore/${lane}/${index}`,
          message: `mapping ignore.${lane} references missing declaration ${name}`,
          left: name,
          right: undefined,
        }));
      }
      if (targets.has(name)) {
        findings.push(rawFinding({
          ruleId: `mapping-${lane}-ignore-conflict`,
          declaration: targets.get(name),
          pointer: `#/ignore/${lane}/${index}`,
          message: `${lane} declaration ${name} is both a mapping target and ignored`,
          left: targets.get(name),
          right: name,
        }));
      }
    }
  }

  return findings;
}
