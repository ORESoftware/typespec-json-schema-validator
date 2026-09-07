import { createHash } from 'node:crypto';

const SCHEMA_SET_LIKE_ARRAY_KEYS = new Set([
  'allOf',
  'anyOf',
  'enum',
  'required',
  'type',
]);

const SCHEMA_ARRAY_KEYS = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'prefixItems',
]);

const SCHEMA_MAP_KEYS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);

const SINGLE_SCHEMA_KEYS = new Set([
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

// These keywords do not assert whether an instance is valid. They may still be
// essential while executing a schema: $id builds the resource graph, examples
// and defaults seed probes, and title can identify a root declaration. They are
// therefore removed only by the comparison-specific normalizer below.
const NON_ASSERTION_METADATA_KEYS = new Set([
  '$comment',
  '$id',
  '$schema',
  'default',
  'deprecated',
  'description',
  'examples',
  'readOnly',
  'title',
  'writeOnly',
]);

const EXECUTABLE_NORMALIZATION = Object.freeze({
  stripMetadata: false,
  normalizeReference: normalizeRef,
});

const COMPARISON_NORMALIZATION = Object.freeze({
  stripMetadata: true,
  normalizeReference: normalizeComparisonRef,
});

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function setOwn(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalStringify(value, space = 0) {
  return JSON.stringify(canonicalizeJson(value), null, space);
}

/**
 * Canonicalize generic JSON. Arrays remain ordered and multiplicity-preserving;
 * schema-specific set semantics belong only in the schema normalizer below.
 */
export function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
    setOwn(result, key, canonicalizeJson(value[key]));
  }
  return result;
}

export function escapeJsonPointerSegment(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

export function unescapeJsonPointerSegment(value) {
  return String(value).replaceAll('~1', '/').replaceAll('~0', '~');
}

/** Decode one URI-fragment JSON Pointer token and reject invalid RFC 6901 escapes. */
export function decodeJsonPointerSegment(value) {
  const decoded = decodeURIComponent(String(value));
  if (/~(?:[^01]|$)/u.test(decoded)) {
    throw new URIError(`invalid JSON Pointer escape in segment: ${value}`);
  }
  return unescapeJsonPointerSegment(decoded);
}

function declarationRef(name) {
  return `urn:tsjsv:declaration:${name}`;
}

/**
 * Normalize references without changing runtime resolution semantics.
 */
export function normalizeRef(reference) {
  if (typeof reference !== 'string') {
    return reference;
  }
  if (reference.startsWith('#/definitions/')) {
    return `#/$defs/${reference.slice('#/definitions/'.length)}`;
  }
  return reference;
}

/**
 * Normalize only references that identify a mapped top-level declaration.
 * This representation is for cross-authority comparison and must never be
 * installed into a schema document that will be executed as a validator.
 */
export function normalizeComparisonRef(reference) {
  if (typeof reference !== 'string') {
    return reference;
  }
  if (reference.startsWith('#/definitions/')) {
    return declarationRef(reference.slice('#/definitions/'.length));
  }
  if (reference.startsWith('#/$defs/')) {
    return declarationRef(reference.slice('#/$defs/'.length));
  }

  // The official TypeSpec bundle emitter uses declaration-local files such as
  // `User.json`, while independently authored bundles commonly use
  // `#/$defs/User`. Paths, URLs, query strings, and nested fragments remain
  // untouched because their resolution semantics may differ.
  const localFile = /^(?:\.\/)?([^/#?]+)\.json$/.exec(reference);
  if (localFile) {
    return declarationRef(localFile[1]);
  }
  return reference;
}

function isAlwaysFalseSchema(value) {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 1 &&
    isPlainObject(value.not) &&
    Object.keys(value.not).length === 0
  );
}

function canCollapseSimpleTypeUnion(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'anyOf') {
    return null;
  }
  const branches = value.anyOf;
  if (!Array.isArray(branches) || branches.length === 0) {
    return null;
  }
  const types = [];
  for (const branch of branches) {
    if (!isPlainObject(branch) || Object.keys(branch).length !== 1) {
      return null;
    }
    if (typeof branch.type !== 'string') {
      return null;
    }
    types.push(branch.type);
  }
  if (new Set(types).size !== types.length) {
    return null;
  }
  return { type: types.sort() };
}

function sortSchemaArray(values, deduplicate) {
  const entries = values
    .map((item, index) => ({ encoding: JSON.stringify(canonicalizeJson(item)), index, item }))
    .sort((left, right) => left.encoding.localeCompare(right.encoding) || left.index - right.index);
  if (!deduplicate) {
    return entries.map(({ item }) => item);
  }
  const result = [];
  let prior;
  for (const entry of entries) {
    if (entry.encoding !== prior) {
      result.push(entry.item);
      prior = entry.encoding;
    }
  }
  return result;
}

function normalizeSchemaMap(value, options) {
  if (!isPlainObject(value)) {
    return normalizeSchemaValue(value, '', options, 'literal');
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    setOwn(result, key, normalizeSchemaValue(value[key], '', options, 'schema'));
  }
  return result;
}

function normalizeSchemaArray(value, keyword, options) {
  if (!Array.isArray(value)) {
    return normalizeSchemaValue(value, keyword, options, 'literal');
  }
  const childContext = SCHEMA_ARRAY_KEYS.has(keyword) ? 'schema' : 'literal';
  const normalized = value.map((item) => normalizeSchemaValue(item, '', options, childContext));
  if (keyword === 'oneOf') {
    return sortSchemaArray(normalized, false);
  }
  if (SCHEMA_SET_LIKE_ARRAY_KEYS.has(keyword)) {
    return sortSchemaArray(normalized, true);
  }
  return normalized;
}

function normalizeSchemaValue(value, parentKey, options, context) {
  if (value === true || value === false || value === null || typeof value !== 'object') {
    return value;
  }

  if (context === 'literal') {
    return canonicalizeJson(value);
  }

  if (context === 'schema-map') {
    return normalizeSchemaMap(value, options);
  }

  if (Array.isArray(value)) {
    return normalizeSchemaArray(value, parentKey, options);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (isAlwaysFalseSchema(value)) {
    return false;
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (options.stripMetadata && NON_ASSERTION_METADATA_KEYS.has(key)) {
      continue;
    }
    const targetKey = key === 'definitions' ? '$defs' : key;
    let child = value[key];
    if (targetKey === '$ref') {
      child = options.normalizeReference(child);
    }

    let childContext = 'literal';
    if (SCHEMA_MAP_KEYS.has(key)) {
      childContext = 'schema-map';
    } else if (SCHEMA_ARRAY_KEYS.has(key) || SINGLE_SCHEMA_KEYS.has(key)) {
      childContext = 'schema';
    }

    const normalized = Array.isArray(child)
      ? normalizeSchemaArray(child, targetKey, options)
      : normalizeSchemaValue(child, targetKey, options, childContext);
    setOwn(result, targetKey, normalized);
  }

  const collapsed = canCollapseSimpleTypeUnion(result);
  return collapsed ?? result;
}

/**
 * Normalize a schema while retaining every value needed for execution,
 * resource resolution, declaration inference, and probe generation.
 */
export function normalizeSchemaNode(value, parentKey = '') {
  return normalizeSchemaValue(value, parentKey, EXECUTABLE_NORMALIZATION, 'schema');
}

/**
 * Normalize a schema for semantic cross-authority comparison only.
 */
export function normalizeSchemaNodeForComparison(value, parentKey = '') {
  return normalizeSchemaValue(value, parentKey, COMPARISON_NORMALIZATION, 'schema');
}

function normalizeSchemaDocumentWith(document, nodeNormalizer, options) {
  if (!isPlainObject(document)) {
    return nodeNormalizer(document);
  }
  if (document.$defs !== undefined && document.definitions !== undefined) {
    const left = canonicalStringify(normalizeSchemaMap(document.$defs, options));
    const right = canonicalStringify(normalizeSchemaMap(document.definitions, options));
    if (left !== right) {
      throw new Error('JSON Schema document contains conflicting $defs and definitions objects');
    }
  }
  return nodeNormalizer(document);
}

export function normalizeSchemaDocument(document) {
  return normalizeSchemaDocumentWith(document, normalizeSchemaNode, EXECUTABLE_NORMALIZATION);
}

export function normalizeSchemaDocumentForComparison(document) {
  return normalizeSchemaDocumentWith(
    document,
    normalizeSchemaNodeForComparison,
    COMPARISON_NORMALIZATION,
  );
}

function arrayIndex(segment, length) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) {
    return undefined;
  }
  const index = Number(segment);
  return Number.isSafeInteger(index) && index < length ? index : undefined;
}

export function resolveJsonPointer(document, pointer) {
  if (pointer === '#') {
    return document;
  }
  if (!pointer.startsWith('#/')) {
    return undefined;
  }
  let current = document;
  for (const encoded of pointer.slice(2).split('/')) {
    let segment;
    try {
      segment = decodeJsonPointerSegment(encoded);
    } catch {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = arrayIndex(segment, current.length);
      if (index === undefined) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function deepDiff(left, right, options = {}) {
  const maxFindings = options.maxFindings ?? 250;
  const differences = [];

  function visit(a, b, pointer) {
    if (differences.length >= maxFindings) {
      return;
    }
    if (Object.is(a, b)) {
      return;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      const length = Math.max(a.length, b.length);
      for (let index = 0; index < length; index += 1) {
        const childPointer = `${pointer}/${index}`;
        if (index >= a.length) {
          differences.push({ pointer: childPointer, kind: 'missing-left', left: undefined, right: b[index] });
        } else if (index >= b.length) {
          differences.push({ pointer: childPointer, kind: 'missing-right', left: a[index], right: undefined });
        } else {
          visit(a[index], b[index], childPointer);
        }
        if (differences.length >= maxFindings) {
          return;
        }
      }
      return;
    }

    if (isPlainObject(a) && isPlainObject(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) {
        const childPointer = `${pointer}/${escapeJsonPointerSegment(key)}`;
        if (!Object.hasOwn(a, key)) {
          differences.push({ pointer: childPointer, kind: 'missing-left', left: undefined, right: b[key] });
        } else if (!Object.hasOwn(b, key)) {
          differences.push({ pointer: childPointer, kind: 'missing-right', left: a[key], right: undefined });
        } else {
          visit(a[key], b[key], childPointer);
        }
        if (differences.length >= maxFindings) {
          return;
        }
      }
      return;
    }

    differences.push({ pointer: pointer || '#', kind: 'value-mismatch', left: a, right: b });
  }

  visit(left, right, '#');
  return {
    differences,
    truncated: differences.length >= maxFindings,
  };
}

export function stableFindingFingerprint(finding) {
  const material = canonicalStringify({
    ruleId: finding.ruleId,
    comparison: finding.comparison,
    declaration: finding.declaration,
    pointer: finding.pointer,
    message: finding.message,
    left: finding.left,
    right: finding.right,
  });
  return sha256(material);
}
