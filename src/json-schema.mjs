import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import {
  canonicalStringify,
  escapeJsonPointerSegment,
  isPlainObject,
  normalizeSchemaDocument,
  normalizeSchemaNode,
  resolveJsonPointer,
  sha256,
} from './canonical.mjs';

export const JSON_SCHEMA_DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const VALID_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);
const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_MAP_KEYWORDS = new Set(['$defs', 'definitions', 'dependentSchemas', 'patternProperties', 'properties']);
const SCHEMA_SINGLE_KEYWORDS = new Set([
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

function finding(ruleId, message, pointer, source, extra = {}) {
  return {
    ruleId,
    severity: 'error',
    comparison: 'json-schema-structural-validation',
    message,
    pointer,
    source,
    ...extra,
  };
}

function isSchema(value) {
  return typeof value === 'boolean' || isPlainObject(value);
}

function validateNumberPair(node, minimumKey, maximumKey, pointer, source, findings) {
  const minimum = node[minimumKey];
  const maximum = node[maximumKey];
  if (minimum !== undefined && (typeof minimum !== 'number' || !Number.isFinite(minimum))) {
    findings.push(finding('json-schema-invalid-number', `${minimumKey} must be a finite number`, `${pointer}/${minimumKey}`, source));
  }
  if (maximum !== undefined && (typeof maximum !== 'number' || !Number.isFinite(maximum))) {
    findings.push(finding('json-schema-invalid-number', `${maximumKey} must be a finite number`, `${pointer}/${maximumKey}`, source));
  }
  if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
    findings.push(
      finding(
        'json-schema-impossible-range',
        `${minimumKey} (${minimum}) is greater than ${maximumKey} (${maximum})`,
        pointer,
        source,
      ),
    );
  }
}

function validateNonNegativeInteger(node, key, pointer, source, findings) {
  if (node[key] === undefined) {
    return;
  }
  if (!Number.isInteger(node[key]) || node[key] < 0) {
    findings.push(
      finding('json-schema-invalid-cardinality', `${key} must be a non-negative integer`, `${pointer}/${key}`, source),
    );
  }
}

function validateUniqueArray(node, key, pointer, source, findings, itemType) {
  const value = node[key];
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    findings.push(finding('json-schema-invalid-array', `${key} must be an array`, `${pointer}/${key}`, source));
    return;
  }
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (itemType && typeof item !== itemType) {
      findings.push(
        finding(
          'json-schema-invalid-array-item',
          `${key}[${index}] must be a ${itemType}`,
          `${pointer}/${key}/${index}`,
          source,
        ),
      );
      continue;
    }
    const encoded = canonicalStringify(item);
    if (seen.has(encoded)) {
      findings.push(
        finding('json-schema-duplicate-array-item', `${key} contains a duplicate item`, `${pointer}/${key}/${index}`, source),
      );
    }
    seen.add(encoded);
  }
}

function walkSchema(node, pointer, document, source, findings, visited) {
  if (typeof node === 'boolean') {
    return;
  }
  if (!isPlainObject(node)) {
    findings.push(finding('json-schema-invalid-node', 'schema nodes must be objects or booleans', pointer, source));
    return;
  }
  if (visited.has(node)) {
    return;
  }
  visited.add(node);

  if ('nullable' in node) {
    findings.push(
      finding(
        'json-schema-openapi-nullable-keyword',
        'nullable is not a JSON Schema Draft 2020-12 keyword; represent null in type/anyOf/oneOf explicitly',
        `${pointer}/nullable`,
        source,
      ),
    );
  }

  if (node.$ref !== undefined) {
    if (typeof node.$ref !== 'string') {
      findings.push(finding('json-schema-invalid-ref', '$ref must be a string', `${pointer}/$ref`, source));
    } else if (node.$ref.startsWith('#') && resolveJsonPointer(document, node.$ref) === undefined) {
      findings.push(
        finding('json-schema-unresolved-local-ref', `local $ref does not resolve: ${node.$ref}`, `${pointer}/$ref`, source),
      );
    }
  }

  if (node.type !== undefined) {
    const values = Array.isArray(node.type) ? node.type : [node.type];
    if (values.length === 0) {
      findings.push(finding('json-schema-empty-type', 'type array must not be empty', `${pointer}/type`, source));
    }
    const seen = new Set();
    for (let index = 0; index < values.length; index += 1) {
      const type = values[index];
      if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
        findings.push(
          finding('json-schema-invalid-type', `unsupported JSON Schema type: ${String(type)}`, `${pointer}/type/${index}`, source),
        );
      }
      if (seen.has(type)) {
        findings.push(finding('json-schema-duplicate-type', `duplicate JSON Schema type: ${type}`, `${pointer}/type/${index}`, source));
      }
      seen.add(type);
    }
  }

  validateUniqueArray(node, 'required', pointer, source, findings, 'string');
  validateUniqueArray(node, 'enum', pointer, source, findings);

  if (Array.isArray(node.required)) {
    const properties = isPlainObject(node.properties) ? node.properties : {};
    for (let index = 0; index < node.required.length; index += 1) {
      const property = node.required[index];
      if (typeof property === 'string' && !(property in properties)) {
        findings.push(
          finding(
            'json-schema-required-property-missing',
            `required property is not declared in properties: ${property}`,
            `${pointer}/required/${index}`,
            source,
          ),
        );
      }
    }
  }

  if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0)) {
    findings.push(finding('json-schema-empty-enum', 'enum must be a non-empty array', `${pointer}/enum`, source));
  }

  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'minContains', 'maxContains']) {
    validateNonNegativeInteger(node, key, pointer, source, findings);
  }
  validateNumberPair(node, 'minimum', 'maximum', pointer, source, findings);
  validateNumberPair(node, 'exclusiveMinimum', 'exclusiveMaximum', pointer, source, findings);
  validateNumberPair(node, 'minLength', 'maxLength', pointer, source, findings);
  validateNumberPair(node, 'minItems', 'maxItems', pointer, source, findings);
  validateNumberPair(node, 'minProperties', 'maxProperties', pointer, source, findings);
  validateNumberPair(node, 'minContains', 'maxContains', pointer, source, findings);

  if (node.multipleOf !== undefined && (typeof node.multipleOf !== 'number' || node.multipleOf <= 0)) {
    findings.push(
      finding('json-schema-invalid-multiple-of', 'multipleOf must be a number greater than zero', `${pointer}/multipleOf`, source),
    );
  }

  for (const key of SCHEMA_ARRAY_KEYWORDS) {
    if (node[key] === undefined) {
      continue;
    }
    if (!Array.isArray(node[key]) || node[key].length === 0) {
      findings.push(
        finding('json-schema-invalid-schema-array', `${key} must be a non-empty array of schemas`, `${pointer}/${key}`, source),
      );
      continue;
    }
    for (let index = 0; index < node[key].length; index += 1) {
      walkSchema(node[key][index], `${pointer}/${key}/${index}`, document, source, findings, visited);
    }
  }

  for (const key of SCHEMA_MAP_KEYWORDS) {
    if (node[key] === undefined) {
      continue;
    }
    if (!isPlainObject(node[key])) {
      findings.push(finding('json-schema-invalid-schema-map', `${key} must be an object of schemas`, `${pointer}/${key}`, source));
      continue;
    }
    for (const [name, child] of Object.entries(node[key])) {
      walkSchema(child, `${pointer}/${key}/${escapeJsonPointerSegment(name)}`, document, source, findings, visited);
    }
  }

  for (const key of SCHEMA_SINGLE_KEYWORDS) {
    if (node[key] === undefined) {
      continue;
    }
    if (!isSchema(node[key])) {
      findings.push(finding('json-schema-invalid-child-schema', `${key} must be an object or boolean schema`, `${pointer}/${key}`, source));
      continue;
    }
    walkSchema(node[key], `${pointer}/${key}`, document, source, findings, visited);
  }
}

export function validateJsonSchemaDocument(document, source = '<memory>', options = {}) {
  const findings = [];
  if (!isSchema(document)) {
    findings.push(finding('json-schema-invalid-root', 'JSON Schema root must be an object or boolean', '#', source));
    return findings;
  }
  if (isPlainObject(document)) {
    const requireDialect = options.requireDialect ?? true;
    if (requireDialect && document.$schema !== JSON_SCHEMA_DRAFT_2020_12) {
      findings.push(
        finding(
          'json-schema-dialect',
          `expected explicit JSON Schema Draft 2020-12 dialect ${JSON_SCHEMA_DRAFT_2020_12}`,
          '#/$schema',
          source,
          { left: document.$schema, right: JSON_SCHEMA_DRAFT_2020_12 },
        ),
      );
    }
    if (document.$defs !== undefined && document.definitions !== undefined) {
      const left = canonicalStringify(normalizeSchemaNode(document.$defs));
      const right = canonicalStringify(normalizeSchemaNode(document.definitions));
      if (left !== right) {
        findings.push(
          finding(
            'json-schema-conflicting-definition-containers',
            'document has non-equivalent $defs and definitions containers',
            '#',
            source,
          ),
        );
      }
    }
  }
  walkSchema(document, '#', document, source, findings, new WeakSet());
  return findings;
}

function inferRootName(document, path) {
  if (isPlainObject(document) && typeof document.title === 'string' && document.title.trim()) {
    return document.title.trim();
  }
  if (isPlainObject(document) && typeof document.$id === 'string') {
    try {
      const url = new URL(document.$id, 'https://local.invalid/');
      const candidate = basename(url.pathname).replace(/\.(schema|jsonschema)?\.json$/iu, '').replace(/\.json$/iu, '');
      if (candidate) {
        return candidate;
      }
    } catch {
      // Fall through to the filename.
    }
  }
  return basename(path).replace(/\.(schema|jsonschema)?\.json$/iu, '').replace(/\.json$/iu, '');
}

export function inferSchemaKind(schema) {
  if (typeof schema === 'boolean') {
    return 'scalar-like';
  }
  if (!isPlainObject(schema)) {
    return 'unknown';
  }
  if (Array.isArray(schema.enum) || 'const' in schema) {
    return 'enum';
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    return 'union';
  }
  const typeValues = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (
    typeValues.includes('object') ||
    isPlainObject(schema.properties) ||
    Array.isArray(schema.allOf) ||
    isPlainObject(schema.patternProperties)
  ) {
    return 'model';
  }
  return 'scalar-like';
}

export function extractSchemaDeclarations(document, sourcePath) {
  if (!isPlainObject(document)) {
    return [
      {
        name: inferRootName(document, sourcePath),
        kind: inferSchemaKind(document),
        schema: normalizeSchemaNode(document),
        source: sourcePath,
        pointer: '#',
      },
    ];
  }
  const definitions = document.$defs ?? document.definitions;
  if (isPlainObject(definitions) && Object.keys(definitions).length > 0) {
    return Object.keys(definitions)
      .sort()
      .map((name) => ({
        name,
        kind: inferSchemaKind(definitions[name]),
        schema: normalizeSchemaNode(definitions[name]),
        source: sourcePath,
        pointer: `#/$defs/${escapeJsonPointerSegment(name)}`,
        typespecName:
          isPlainObject(definitions[name]) && typeof definitions[name]['x-typespec-name'] === 'string'
            ? definitions[name]['x-typespec-name']
            : undefined,
      }));
  }
  const name = inferRootName(document, sourcePath);
  return [
    {
      name,
      kind: inferSchemaKind(document),
      schema: normalizeSchemaNode(document),
      source: sourcePath,
      pointer: '#',
      typespecName: typeof document['x-typespec-name'] === 'string' ? document['x-typespec-name'] : undefined,
    },
  ];
}

async function collectSchemaFiles(input) {
  const absolute = resolve(input);
  const inputStat = await stat(absolute);
  if (inputStat.isFile()) {
    return [absolute];
  }
  if (!inputStat.isDirectory()) {
    throw new Error(`JSON Schema input is neither a file nor a directory: ${absolute}`);
  }
  const entries = await readdir(absolute, { withFileTypes: true });
  const preferred = entries
    .filter((entry) => entry.isFile() && /\.(schema|jsonschema)\.json$/iu.test(entry.name))
    .map((entry) => join(absolute, entry.name));
  if (preferred.length > 0) {
    return preferred.sort();
  }
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.json')
    .map((entry) => join(absolute, entry.name))
    .sort();
}

export async function loadSchemaCollection(input, options = {}) {
  const files = await collectSchemaFiles(input);
  if (files.length === 0) {
    throw new Error(`no JSON Schema files found at ${resolve(input)}`);
  }
  const root = files.length === 1 ? resolve(input) : resolve(input);
  const documents = [];
  const declarations = [];
  const findings = [];
  const seen = new Map();
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    let document;
    try {
      document = JSON.parse(raw);
    } catch (error) {
      throw new Error(`invalid JSON in ${file}: ${error.message}`, { cause: error });
    }
    findings.push(...validateJsonSchemaDocument(document, file, options));
    const normalizedDocument = normalizeSchemaDocument(document);
    const extracted = extractSchemaDeclarations(normalizedDocument, file);
    for (const declaration of extracted) {
      if (seen.has(declaration.name)) {
        const previous = seen.get(declaration.name);
        findings.push(
          finding(
            'json-schema-duplicate-declaration',
            `duplicate JSON Schema declaration ${declaration.name} in ${previous.source} and ${file}`,
            declaration.pointer,
            file,
          ),
        );
      } else {
        seen.set(declaration.name, declaration);
        declarations.push(declaration);
      }
    }
    documents.push({
      path: file,
      relativePath: relative(root, file).replaceAll('\\', '/') || basename(file),
      sha256: sha256(raw),
      document: normalizedDocument,
    });
  }
  const digestMaterial = documents
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((document) => `${document.relativePath}\0${canonicalStringify(document.document)}`)
    .join('\0');
  return {
    input: resolve(input),
    digest: sha256(digestMaterial),
    // The parsed document is retained so the differential lane can execute each authority as
    // a validator. Consumers that only need provenance keep using path/relativePath/sha256.
    documents: documents.map(({ path, relativePath, sha256: digest, document }) => ({
      path,
      relativePath,
      sha256: digest,
      document,
    })),
    declarations: declarations.sort((left, right) => left.name.localeCompare(right.name)),
    findings,
  };
}
