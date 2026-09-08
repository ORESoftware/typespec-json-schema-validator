const SIMPLE_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);
const ANCHOR_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]*$/u;
const FORBIDDEN_URI_CODE_POINTS = /[\u0000-\u0020\u007f]/u;
const INVALID_PERCENT_ESCAPE = /%(?![0-9A-Fa-f]{2})/u;

const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);
const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_SINGLE_KEYWORDS = new Set([
  'additionalItems',
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
const NON_NEGATIVE_INTEGER_KEYWORDS = new Set([
  'maxContains',
  'maxItems',
  'maxLength',
  'maxProperties',
  'minContains',
  'minItems',
  'minLength',
  'minProperties',
]);
const NUMBER_KEYWORDS = new Set([
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maximum',
  'minimum',
]);
const STRING_KEYWORDS = new Set([
  '$comment',
  'contentEncoding',
  'contentMediaType',
  'description',
  'format',
  'title',
]);
const BOOLEAN_KEYWORDS = new Set(['deprecated', 'readOnly', 'uniqueItems', 'writeOnly']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeJsonPointerSegment(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function childPointer(pointer, keyword) {
  return `${pointer === '#' ? '#' : pointer}/${escapeJsonPointerSegment(keyword)}`;
}

function isSchema(value) {
  return typeof value === 'boolean' || isPlainObject(value);
}

function isJsonValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((item) => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = Object.values(value).every((item) => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }
  return false;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function uriReferenceStatus(value, { absolute = false, forbidNonEmptyFragment = false } = {}) {
  if (typeof value !== 'string') return 'must be a string';
  if (FORBIDDEN_URI_CODE_POINTS.test(value)) return 'must not contain whitespace or control characters';
  if (INVALID_PERCENT_ESCAPE.test(value)) return 'contains an invalid percent escape';
  if (forbidNonEmptyFragment) {
    const hashIndex = value.indexOf('#');
    if (hashIndex !== -1 && hashIndex !== value.length - 1) {
      return 'must not contain a non-empty fragment';
    }
  }
  try {
    if (absolute) {
      const parsed = new URL(value);
      if (!parsed.protocol) return 'must be an absolute URI';
    } else {
      // A fixed non-network base validates relative references without fetching anything.
      new URL(value, 'https://tsjsv.invalid/schema-base/');
    }
  } catch {
    return absolute ? 'must be an absolute URI' : 'must be a valid URI-reference';
  }
  return null;
}

function finding(ruleId, message, pointer, source, keyword, extra = {}) {
  return {
    ruleId,
    severity: 'error',
    comparison: 'json-schema-structural-validation',
    message,
    pointer,
    source,
    keyword,
    ...extra,
  };
}

function addTypeArrayFindings(
  findings, value, pointer, source, keyword, validItem, label, { nonEmpty = false, unique = false } = {},
) {
  if (!Array.isArray(value)) {
    findings.push(finding('json-schema-invalid-array', `${keyword} must be an array`, pointer, source, keyword));
    return;
  }
  if (nonEmpty && value.length === 0) {
    findings.push(finding('json-schema-empty-array', `${keyword} must not be empty`, pointer, source, keyword));
  }
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const itemPointer = `${pointer}/${index}`;
    const item = value[index];
    if (!validItem(item)) {
      findings.push(finding('json-schema-invalid-array-item', `${keyword}[${index}] must be ${label}`, itemPointer, source, keyword));
      continue;
    }
    if (unique) {
      const encoded = canonicalJson(item);
      if (seen.has(encoded)) {
        findings.push(finding('json-schema-duplicate-array-item', `${keyword} contains a duplicate item`, itemPointer, source, keyword));
      }
      seen.add(encoded);
    }
  }
}

function addRegexFinding(findings, pattern, pointer, source, keyword) {
  if (typeof pattern !== 'string') {
    findings.push(finding('json-schema-invalid-regex', `${keyword} must be a string`, pointer, source, keyword));
    return;
  }
  try {
    // Draft 2020-12 expects ECMA-262 expressions with Unicode behavior. Do not
    // silently retry without `u`, because that can change both syntax and matches.
    new RegExp(pattern, 'u');
  } catch {
    findings.push(finding('json-schema-invalid-regex', `${keyword} must be a valid ECMA-262 Unicode regular expression`, pointer, source, keyword));
  }
}

function addSchemaMapFindings(findings, value, pointer, source, keyword) {
  if (!isPlainObject(value)) {
    findings.push(finding('json-schema-invalid-schema-map', `${keyword} must be an object of schemas`, pointer, source, keyword));
    return;
  }
  for (const [name, child] of Object.entries(value)) {
    if (!isSchema(child)) {
      findings.push(finding(
        'json-schema-invalid-child-schema',
        `${keyword}.${name} must be an object or boolean schema`,
        `${pointer}/${escapeJsonPointerSegment(name)}`,
        source,
        keyword,
      ));
    }
  }
}

/**
 * Validate the Draft 2020-12 syntax owned by one schema object. Child schema
 * objects are validated when their own node is visited; this function validates
 * only the current node and the immediate shape of schema-containing keywords.
 */
export function validateSchemaNodeSyntax(schema, { pointer = '#', source = '<memory>' } = {}) {
  const findings = [];
  if (typeof schema === 'boolean') return findings;
  if (!isPlainObject(schema)) {
    return [finding('json-schema-invalid-node', 'schema nodes must be objects or booleans', pointer, source, null)];
  }

  if (Object.hasOwn(schema, '$id')) {
    const location = childPointer(pointer, '$id');
    const reason = uriReferenceStatus(schema.$id, { forbidNonEmptyFragment: true });
    if (reason) findings.push(finding('json-schema-invalid-id', `$id ${reason}`, location, source, '$id'));
  }
  if (Object.hasOwn(schema, '$schema')) {
    const location = childPointer(pointer, '$schema');
    const reason = uriReferenceStatus(schema.$schema, { absolute: true });
    if (reason) findings.push(finding('json-schema-invalid-schema-uri', `$schema ${reason}`, location, source, '$schema'));
  }
  for (const keyword of ['$ref', '$dynamicRef']) {
    if (!Object.hasOwn(schema, keyword)) continue;
    const location = childPointer(pointer, keyword);
    const reason = uriReferenceStatus(schema[keyword]);
    if (reason) findings.push(finding('json-schema-invalid-ref', `${keyword} ${reason}`, location, source, keyword));
  }
  for (const keyword of ['$anchor', '$dynamicAnchor']) {
    if (!Object.hasOwn(schema, keyword)) continue;
    const location = childPointer(pointer, keyword);
    if (typeof schema[keyword] !== 'string' || !ANCHOR_PATTERN.test(schema[keyword])) {
      findings.push(finding(
        'json-schema-invalid-anchor',
        `${keyword} must start with a letter or underscore and contain only letters, digits, hyphens, underscores, and periods`,
        location,
        source,
        keyword,
      ));
    }
  }
  if (Object.hasOwn(schema, '$vocabulary')) {
    const location = childPointer(pointer, '$vocabulary');
    if (!isPlainObject(schema.$vocabulary)) {
      findings.push(finding('json-schema-invalid-vocabulary', '$vocabulary must be an object', location, source, '$vocabulary'));
    } else {
      for (const [uri, required] of Object.entries(schema.$vocabulary)) {
        const itemPointer = `${location}/${escapeJsonPointerSegment(uri)}`;
        const reason = uriReferenceStatus(uri, { absolute: true });
        if (reason) findings.push(finding('json-schema-invalid-vocabulary-uri', `vocabulary identifier ${reason}`, itemPointer, source, '$vocabulary'));
        if (typeof required !== 'boolean') {
          findings.push(finding('json-schema-invalid-vocabulary-requirement', 'vocabulary requirement must be boolean', itemPointer, source, '$vocabulary'));
        }
      }
    }
  }

  if (Object.hasOwn(schema, 'type')) {
    const location = childPointer(pointer, 'type');
    const values = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (values.length === 0) {
      findings.push(finding('json-schema-empty-type', 'type array must not be empty', location, source, 'type'));
    }
    const seen = new Set();
    for (let index = 0; index < values.length; index += 1) {
      const type = values[index];
      const itemPointer = Array.isArray(schema.type) ? `${location}/${index}` : location;
      if (typeof type !== 'string' || !SIMPLE_TYPES.has(type)) {
        findings.push(finding('json-schema-invalid-type', `unsupported JSON Schema type: ${String(type)}`, itemPointer, source, 'type'));
      } else if (seen.has(type)) {
        findings.push(finding('json-schema-duplicate-type', `duplicate JSON Schema type: ${type}`, itemPointer, source, 'type'));
      }
      seen.add(type);
    }
  }

  if (Object.hasOwn(schema, 'enum')) {
    const location = childPointer(pointer, 'enum');
    addTypeArrayFindings(
      findings, schema.enum, location, source, 'enum', isJsonValue, 'a JSON value',
      { nonEmpty: true, unique: true },
    );
  }
  if (Object.hasOwn(schema, 'const') && !isJsonValue(schema.const)) {
    findings.push(finding('json-schema-invalid-json-value', 'const must be a JSON value', childPointer(pointer, 'const'), source, 'const'));
  }
  if (Object.hasOwn(schema, 'default') && !isJsonValue(schema.default)) {
    findings.push(finding('json-schema-invalid-json-value', 'default must be a JSON value', childPointer(pointer, 'default'), source, 'default'));
  }
  if (Object.hasOwn(schema, 'examples')) {
    addTypeArrayFindings(
      findings,
      schema.examples,
      childPointer(pointer, 'examples'),
      source,
      'examples',
      isJsonValue,
      'a JSON value',
    );
  }

  for (const keyword of STRING_KEYWORDS) {
    if (Object.hasOwn(schema, keyword) && typeof schema[keyword] !== 'string') {
      findings.push(finding('json-schema-invalid-string', `${keyword} must be a string`, childPointer(pointer, keyword), source, keyword));
    }
  }
  for (const keyword of BOOLEAN_KEYWORDS) {
    if (Object.hasOwn(schema, keyword) && typeof schema[keyword] !== 'boolean') {
      findings.push(finding('json-schema-invalid-boolean', `${keyword} must be a boolean`, childPointer(pointer, keyword), source, keyword));
    }
  }
  for (const keyword of NON_NEGATIVE_INTEGER_KEYWORDS) {
    if (Object.hasOwn(schema, keyword) && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)) {
      findings.push(finding('json-schema-invalid-cardinality', `${keyword} must be a non-negative integer`, childPointer(pointer, keyword), source, keyword));
    }
  }
  for (const keyword of NUMBER_KEYWORDS) {
    if (Object.hasOwn(schema, keyword) && (typeof schema[keyword] !== 'number' || !Number.isFinite(schema[keyword]))) {
      findings.push(finding('json-schema-invalid-number', `${keyword} must be a finite number`, childPointer(pointer, keyword), source, keyword));
    }
  }
  if (Object.hasOwn(schema, 'multipleOf') && (
    typeof schema.multipleOf !== 'number' || !Number.isFinite(schema.multipleOf) || schema.multipleOf <= 0
  )) {
    findings.push(finding('json-schema-invalid-multiple-of', 'multipleOf must be a finite number greater than zero', childPointer(pointer, 'multipleOf'), source, 'multipleOf'));
  }
  if (Object.hasOwn(schema, 'pattern')) {
    addRegexFinding(findings, schema.pattern, childPointer(pointer, 'pattern'), source, 'pattern');
  }

  if (Object.hasOwn(schema, 'required')) {
    addTypeArrayFindings(
      findings,
      schema.required,
      childPointer(pointer, 'required'),
      source,
      'required',
      (item) => typeof item === 'string',
      'a string',
      { unique: true },
    );
  }
  if (Object.hasOwn(schema, 'dependentRequired')) {
    const location = childPointer(pointer, 'dependentRequired');
    if (!isPlainObject(schema.dependentRequired)) {
      findings.push(finding('json-schema-invalid-dependent-required', 'dependentRequired must be an object', location, source, 'dependentRequired'));
    } else {
      for (const [name, dependencies] of Object.entries(schema.dependentRequired)) {
        addTypeArrayFindings(
          findings,
          dependencies,
          `${location}/${escapeJsonPointerSegment(name)}`,
          source,
          'dependentRequired',
          (item) => typeof item === 'string',
          'a string',
          { unique: true },
        );
      }
    }
  }

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    if (!Object.hasOwn(schema, keyword)) continue;
    const location = childPointer(pointer, keyword);
    addSchemaMapFindings(findings, schema[keyword], location, source, keyword);
    if (keyword === 'patternProperties' && isPlainObject(schema[keyword])) {
      for (const pattern of Object.keys(schema[keyword])) {
        addRegexFinding(findings, pattern, `${location}/${escapeJsonPointerSegment(pattern)}`, source, 'patternProperties');
      }
    }
  }
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    if (!Object.hasOwn(schema, keyword)) continue;
    addTypeArrayFindings(
      findings,
      schema[keyword],
      childPointer(pointer, keyword),
      source,
      keyword,
      isSchema,
      'an object or boolean schema',
      { nonEmpty: true },
    );
  }
  for (const keyword of SCHEMA_SINGLE_KEYWORDS) {
    if (Object.hasOwn(schema, keyword) && !isSchema(schema[keyword])) {
      findings.push(finding(
        'json-schema-invalid-child-schema',
        `${keyword} must be an object or boolean schema`,
        childPointer(pointer, keyword),
        source,
        keyword,
      ));
    }
  }

  if (Object.hasOwn(schema, 'dependencies')) {
    const location = childPointer(pointer, 'dependencies');
    if (!isPlainObject(schema.dependencies)) {
      findings.push(finding('json-schema-invalid-dependencies', 'dependencies must be an object', location, source, 'dependencies'));
    } else {
      for (const [name, dependency] of Object.entries(schema.dependencies)) {
        const itemPointer = `${location}/${escapeJsonPointerSegment(name)}`;
        if (isSchema(dependency)) continue;
        addTypeArrayFindings(
          findings,
          dependency,
          itemPointer,
          source,
          'dependencies',
          (item) => typeof item === 'string',
          'a string',
          { unique: true },
        );
      }
    }
  }

  return findings;
}

export class SchemaSyntaxError extends Error {
  constructor(issue) {
    super(`${issue.message} at ${issue.pointer} in ${issue.source}`);
    this.name = 'SchemaSyntaxError';
    this.ruleId = issue.ruleId;
    this.keyword = issue.keyword;
    this.pointer = issue.pointer;
    this.source = issue.source;
    this.finding = issue;
  }
}

export function assertSchemaNodeSyntax(schema, context) {
  const [issue] = validateSchemaNodeSyntax(schema, context);
  if (issue) throw new SchemaSyntaxError(issue);
}

export const INTERNAL = Object.freeze({
  ANCHOR_PATTERN,
  SIMPLE_TYPES,
  uriReferenceStatus,
});
