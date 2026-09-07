import { createHash } from 'node:crypto';

const SET_LIKE_ARRAY_KEYS = new Set([
  'allOf',
  'anyOf',
  'enum',
  'oneOf',
  'required',
  'type',
]);

// These keywords do not assert whether an instance is valid. The validator
// checks both documents as Draft 2020-12 before comparison, then removes this
// presentation/documentation metadata so generated and authored authorities
// are compared on validation semantics rather than emitter file layout.
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

export function normalizeRef(reference) {
  if (typeof reference !== 'string') {
    return reference;
  }
  if (reference.startsWith('#/definitions/')) {
    return `#/$defs/${reference.slice('#/definitions/'.length)}`;
  }

  // Preserve every other runtime-resolvable spelling. In particular, local
  // declaration files and bundled $defs references are not interchangeable
  // while a schema document is being executed as a validator. Rewriting them
  // to a synthetic identity here would make the differential lane refuse
  // otherwise valid references. Cross-lane declaration mapping belongs in the
  // inventory/comparison layer, not in executable schema documents.
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

export function normalizeSchemaNode(value, parentKey = '') {
  if (value === true || value === false || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeSchemaNode(item, ''));
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
    if (NON_ASSERTION_METADATA_KEYS.has(key)) {
      continue;
    }
    let targetKey = key;
    if (key === 'definitions') {
      targetKey = '$defs';
    }
    let child = value[key];
    if (targetKey === '$ref') {
      child = normalizeRef(child);
    }
    result[targetKey] = normalizeSchemaNode(child, targetKey);
  }

  const collapsed = canCollapseSimpleTypeUnion(result);
  return collapsed ?? result;
}

export function normalizeSchemaDocument(document) {
  if (!isPlainObject(document)) {
    return normalizeSchemaNode(document);
  }
  if (document.$defs !== undefined && document.definitions !== undefined) {
    const left = canonicalStringify(normalizeSchemaNode(document.$defs));
    const right = canonicalStringify(normalizeSchemaNode(document.definitions));
    if (left !== right) {
      throw new Error('JSON Schema document contains conflicting $defs and definitions objects');
    }
  }
  return normalizeSchemaNode(document);
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
    const segment = unescapeJsonPointerSegment(decodeURIComponent(encoded));
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
