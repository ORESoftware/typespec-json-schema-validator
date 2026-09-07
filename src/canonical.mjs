import { createHash } from 'node:crypto';

const SET_LIKE_ARRAY_KEYS = new Set([
  'allOf',
  'anyOf',
  'enum',
  'oneOf',
  'required',
  'type',
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
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalStringify(value, space = 0) {
  return JSON.stringify(canonicalizeJson(value), null, space);
}

export function canonicalizeJson(value, parentKey = '') {
  if (Array.isArray(value)) {
    const values = value.map((item) => canonicalizeJson(item, ''));
    if (SET_LIKE_ARRAY_KEYS.has(parentKey)) {
      const byEncoding = new Map();
      for (const item of values) {
        byEncoding.set(JSON.stringify(item), item);
      }
      return [...byEncoding.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, item]) => item);
    }
    return values;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalizeJson(value[key], key);
  }
  return result;
}

export function escapeJsonPointerSegment(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

export function unescapeJsonPointerSegment(value) {
  return String(value).replaceAll('~1', '/').replaceAll('~0', '~');
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
  const unionKey = keys.includes('anyOf') ? 'anyOf' : keys.includes('oneOf') ? 'oneOf' : null;
  if (!unionKey || keys.some((key) => key !== unionKey)) {
    return null;
  }
  const branches = value[unionKey];
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

function normalizeSchemaNodeWith(value, parentKey, options) {
  if (value === true || value === false || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeSchemaNodeWith(item, '', options));
    if (SET_LIKE_ARRAY_KEYS.has(parentKey)) {
      const byEncoding = new Map();
      for (const item of normalized) {
        byEncoding.set(JSON.stringify(canonicalizeJson(item)), item);
      }
      return [...byEncoding.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, item]) => item);
    }
    return normalized;
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
    result[targetKey] = normalizeSchemaNodeWith(child, targetKey, options);
  }

  const collapsed = canCollapseSimpleTypeUnion(result);
  return collapsed ?? result;
}

/**
 * Normalize a schema while retaining every value needed for execution,
 * resource resolution, declaration inference, and probe generation.
 */
export function normalizeSchemaNode(value, parentKey = '') {
  return normalizeSchemaNodeWith(value, parentKey, EXECUTABLE_NORMALIZATION);
}

/**
 * Normalize a schema for semantic cross-authority comparison only.
 */
export function normalizeSchemaNodeForComparison(value, parentKey = '') {
  return normalizeSchemaNodeWith(value, parentKey, COMPARISON_NORMALIZATION);
}

function normalizeSchemaDocumentWith(document, nodeNormalizer) {
  if (!isPlainObject(document)) {
    return nodeNormalizer(document);
  }
  if (document.$defs !== undefined && document.definitions !== undefined) {
    const left = canonicalStringify(nodeNormalizer(document.$defs));
    const right = canonicalStringify(nodeNormalizer(document.definitions));
    if (left !== right) {
      throw new Error('JSON Schema document contains conflicting $defs and definitions objects');
    }
  }
  return nodeNormalizer(document);
}

export function normalizeSchemaDocument(document) {
  return normalizeSchemaDocumentWith(document, normalizeSchemaNode);
}

export function normalizeSchemaDocumentForComparison(document) {
  return normalizeSchemaDocumentWith(document, normalizeSchemaNodeForComparison);
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
      segment = unescapeJsonPointerSegment(decodeURIComponent(encoded));
    } catch {
      return undefined;
    }
    if (current === null || typeof current !== 'object' || !(segment in current)) {
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
        if (!(key in a)) {
          differences.push({ pointer: childPointer, kind: 'missing-left', left: undefined, right: b[key] });
        } else if (!(key in b)) {
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
