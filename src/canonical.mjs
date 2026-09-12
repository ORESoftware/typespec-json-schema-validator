import { createHash } from 'node:crypto';
import { assertFindingLimit } from './finding-limit.mjs';

// Context is essential: keys inside properties/$defs name declarations, while
// const/enum/default/examples contain JSON data, not nested schemas.
const SCHEMA_MAP_KEYS = new Set([
  '$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas',
]);
const SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const UNORDERED_SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf']);
const SCHEMA_SINGLE_KEYS = new Set([
  'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains',
  'not', 'if', 'then', 'else', 'contentSchema', 'items', 'unevaluatedItems',
  'additionalItems',
]);
const JSON_SCHEMA_TYPES = new Set([
  'array', 'boolean', 'integer', 'null', 'number', 'object', 'string',
]);

// additionalProperties and unevaluatedProperties differ when annotations can
// arrive through composition or reference boundaries. Only simple object
// schemas with none of these boundaries are eligible for comparison-only
// spelling equivalence.
const EVALUATED_PROPERTY_COMPOSITION_KEYS = new Set([
  '$ref', '$dynamicRef', '$recursiveRef', 'allOf', 'anyOf', 'oneOf',
  'if', 'then', 'else', 'dependentSchemas', 'dependencies', 'not',
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
  collapseSafeIntegerConstType: false,
  collapseSimpleClosedObjectKeyword: false,
});

const COMPARISON_NORMALIZATION = Object.freeze({
  stripMetadata: true,
  normalizeReference: normalizeComparisonRef,
  collapseSafeIntegerConstType: true,
  collapseSimpleClosedObjectKeyword: true,
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

/** Sort object keys only. Literal array order and multiplicity bind digests. */
export function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  // Object.fromEntries defines own data properties, including "__proto__".
  // Assignment into {} would instead invoke the inherited prototype setter.
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key])]),
  );
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
  const declaration = /^#\/(?:definitions|\$defs)\/([^/%]+)$/u.exec(reference);
  if (declaration && !/~(?:[^01]|$)/u.test(declaration[1])) {
    return declarationRef(declaration[1]);
  }

  // The official TypeSpec bundle emitter uses declaration-local files such as
  // `User.json`, while independently authored bundles commonly use
  // `#/$defs/User`. Paths, URLs, query strings, and nested fragments remain
  // untouched because their resolution semantics may differ.
  // A colon can introduce a URI scheme; backslashes and percent escapes can
  // identify a different resource. Do not guess equivalence for those spellings
  // or for whitespace/control characters. Require a full match because `$`
  // alone also accepts a position before a trailing line terminator in JS.
  const localFile = /^(?:\.\/)?([^:/\\#?%\s\u0000-\u001f\u007f]+)\.json$/u.exec(reference);
  if (localFile && localFile[0] === reference) {
    // File names contain literal tildes; pointer tokens use ~0 and ~1 escapes.
    // In particular A~1B.json names A~1B, not the declaration named A/B.
    return declarationRef(escapeJsonPointerSegment(localFile[1]));
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
    if (typeof branch.type !== 'string' || !JSON_SCHEMA_TYPES.has(branch.type)) {
      return null;
    }
    types.push(branch.type);
  }
  if (new Set(types).size !== types.length) {
    return null;
  }
  // integer is a subset of number: an integer matches BOTH branches in oneOf,
  // so replacing that XOR with an inclusive type array would accept more data.
  if (unionKey === 'oneOf' && types.includes('number') && types.includes('integer')) {
    return null;
  }
  return { type: types.sort() };
}

function collapseRedundantSafeIntegerConstType(value, options) {
  if (!options.collapseSafeIntegerConstType || !isPlainObject(value)) {
    return value;
  }
  if (!Object.hasOwn(value, 'const') || !Number.isSafeInteger(value.const)) {
    return value;
  }
  if (value.type !== 'number' && value.type !== 'integer') {
    return value;
  }

  // Draft 2020-12 defines integer as the mathematical integer subset of number.
  // Once `const` fixes the only accepted JSON numeric value to a safely
  // representable integer, `type: number` and `type: integer` accept exactly the
  // same instance. Erase only that redundant spelling in the comparison lane.
  // Keep executable schemas untouched, and keep unsafe/non-integral constants
  // distinct because JavaScript number parsing cannot prove exact equivalence.
  const { type: _redundantType, ...rest } = value;
  return rest;
}

function collapseEquivalentSimpleClosedObjectKeyword(value, options) {
  if (!options.collapseSimpleClosedObjectKeyword || !isPlainObject(value) || value.type !== 'object') {
    return value;
  }

  const hasAdditional = Object.hasOwn(value, 'additionalProperties');
  const hasUnevaluated = Object.hasOwn(value, 'unevaluatedProperties');
  // Both spellings together may carry intentionally redundant evidence. Neither
  // spelling has nothing to normalize.
  if (hasAdditional === hasUnevaluated) {
    return value;
  }

  const closureKey = hasAdditional ? 'additionalProperties' : 'unevaluatedProperties';
  if (value[closureKey] !== false) {
    return value;
  }
  if ([...EVALUATED_PROPERTY_COMPOSITION_KEYS].some((key) => Object.hasOwn(value, key))) {
    return value;
  }

  // Without composition/reference annotations, both keywords reject exactly the
  // properties not covered by this object's properties/patternProperties. Use
  // additionalProperties:false as a comparison-only common spelling. The
  // executable lane and both authored source documents remain untouched.
  if (closureKey === 'additionalProperties') {
    return value;
  }
  const entries = Object.entries(value)
    .filter(([key]) => key !== 'unevaluatedProperties');
  entries.push(['additionalProperties', false]);
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return Object.fromEntries(entries);
}

function sortJsonValues(values) {
  // Never deduplicate. In particular, repeated oneOf branches change validity.
  // Use code-unit ordering, not a locale-dependent comparator, for digests.
  return values.map((value) => [canonicalStringify(value), value])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, value]) => value);
}

function normalizeSchemaMap(value, options) {
  if (!isPlainObject(value)) return canonicalizeJson(value);
  return Object.fromEntries(Object.keys(value).sort().map((name) => [
    name, normalizeSchemaNodeWith(value[name], options),
  ]));
}

function normalizeKeywordValue(key, value, options) {
  if (SCHEMA_MAP_KEYS.has(key)) return normalizeSchemaMap(value, options);
  if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(value)) {
    const children = value.map((child) => normalizeSchemaNodeWith(child, options));
    return UNORDERED_SCHEMA_ARRAY_KEYS.has(key) ? sortJsonValues(children) : children;
  }
  if (SCHEMA_SINGLE_KEYS.has(key)) {
    // Keep legacy tuple order; structural validation still decides dialect support.
    return key === 'items' && Array.isArray(value)
      ? value.map((child) => normalizeSchemaNodeWith(child, options))
      : normalizeSchemaNodeWith(value, options);
  }
  if ((key === 'dependentRequired' || key === 'dependencies') && isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((name) => [name,
      Array.isArray(value[name])
        ? sortJsonValues(value[name].map((item) => canonicalizeJson(item)))
        : key === 'dependencies'
          ? normalizeSchemaNodeWith(value[name], options)
          : canonicalizeJson(value[name]),
    ]));
  }
  if (key === '$ref') return options.normalizeReference(value);
  if (['enum', 'required', 'type'].includes(key) && Array.isArray(value)) {
    // Enum members are literal JSON values, not schemas. Only the OUTER array
    // is unordered; arrays anywhere inside a member retain their exact order.
    return sortJsonValues(value.map((item) => canonicalizeJson(item)));
  }
  // const, defaults, examples, annotations, and unknown extension values are
  // opaque JSON. Do not interpret keyword-looking keys nested inside them.
  return canonicalizeJson(value);
}

function normalizeSchemaNodeWith(value, options) {
  if (!isPlainObject(value)) return canonicalizeJson(value);
  if (isAlwaysFalseSchema(value)) return false;

  // Do this at EVERY schema node, not just at the document root, and compare
  // declaration maps as maps (a declaration may legitimately be named title).
  if (Object.hasOwn(value, '$defs') && Object.hasOwn(value, 'definitions')) {
    const left = canonicalStringify(normalizeSchemaMap(value.$defs, options));
    const right = canonicalStringify(normalizeSchemaMap(value.definitions, options));
    if (left !== right) {
      throw new Error('JSON Schema document contains conflicting $defs and definitions objects');
    }
  }
  const entries = [];
  for (const key of Object.keys(value).sort()) {
    if (options.stripMetadata && NON_ASSERTION_METADATA_KEYS.has(key)) continue;
    const targetKey = key === 'definitions' ? '$defs' : key;
    entries.push([targetKey, normalizeKeywordValue(key, value[key], options)]);
  }
  const result = Object.fromEntries(entries);
  const normalizedUnion = canCollapseSimpleTypeUnion(result) ?? result;
  const normalizedClosedObject = collapseEquivalentSimpleClosedObjectKeyword(normalizedUnion, options);
  return collapseRedundantSafeIntegerConstType(normalizedClosedObject, options);
}

/**
 * Normalize a schema while retaining every value needed for execution,
 * resource resolution, declaration inference, and probe generation.
 * parentKey explicitly identifies a keyword value when called on a subtree.
 */
export function normalizeSchemaNode(value, parentKey = '') {
  return parentKey
    ? normalizeKeywordValue(parentKey, value, EXECUTABLE_NORMALIZATION)
    : normalizeSchemaNodeWith(value, EXECUTABLE_NORMALIZATION);
}

/** Normalize actual schema locations only for cross-authority comparison. */
export function normalizeSchemaNodeForComparison(value, parentKey = '') {
  return parentKey
    ? normalizeKeywordValue(parentKey, value, COMPARISON_NORMALIZATION)
    : normalizeSchemaNodeWith(value, COMPARISON_NORMALIZATION);
}

export function normalizeSchemaDocument(document) {
  return normalizeSchemaNode(document);
}

export function normalizeSchemaDocumentForComparison(document) {
  return normalizeSchemaNodeForComparison(document);
}

export function resolveJsonPointer(document, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('#')) return undefined;
  let decoded;
  try {
    // RFC 6901 section 6: decode the URI fragment before parsing pointer tokens.
    decoded = decodeURIComponent(pointer.slice(1));
  } catch {
    return undefined;
  }
  if (decoded === '') return document;
  if (!decoded.startsWith('/')) return undefined;
  let current = document;
  for (const encoded of decoded.slice(1).split('/')) {
    if (/~(?:[^01]|$)/u.test(encoded)) return undefined;
    const segment = unescapeJsonPointerSegment(encoded);
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    if (Array.isArray(current) && !/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
    current = current[segment];
  }
  return current;
}

export function deepDiff(left, right, options = {}) {
  const maxFindings = options.maxFindings ?? 250;
  assertFindingLimit(maxFindings);
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
