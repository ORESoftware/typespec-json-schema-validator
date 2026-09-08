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
import { validateSchemaNodeSyntax } from './schema-syntax.mjs';

export const JSON_SCHEMA_DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_MAP_KEYWORDS = new Set(['$defs', 'definitions', 'dependentSchemas', 'patternProperties', 'properties']);
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

function validateOrderedPair(node, minimumKey, maximumKey, pointer, source, findings) {
  const minimum = node[minimumKey];
  const maximum = node[maximumKey];
  if (
    typeof minimum === 'number' &&
    Number.isFinite(minimum) &&
    typeof maximum === 'number' &&
    Number.isFinite(maximum) &&
    minimum > maximum
  ) {
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

function localJsonPointer(reference) {
  if (reference === '#') {
    return '#';
  }
  if (!reference.startsWith('#/')) {
    return null;
  }
  try {
    return `#${decodeURIComponent(reference.slice(1))}`;
  } catch {
    // Invalid percent escapes are reported by the shared URI syntax guard.
    return null;
  }
}

function walkLegacyDependencies(node, pointer, document, resourceRoot, source, findings, visited) {
  if (!isPlainObject(node.dependencies)) {
    return;
  }
  for (const [name, dependency] of Object.entries(node.dependencies)) {
    if (isSchema(dependency)) {
      walkSchema(
        dependency,
        `${pointer}/dependencies/${escapeJsonPointerSegment(name)}`,
        document,
        resourceRoot,
        source,
        findings,
        visited,
      );
    }
  }
}

function walkSchema(node, pointer, document, resourceRoot, source, findings, visited) {
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

  findings.push(...validateSchemaNodeSyntax(node, { pointer, source }));
  const activeResourceRoot = typeof node.$id === 'string' ? node : resourceRoot;

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

  if (typeof node.$ref === 'string') {
    const localPointer = localJsonPointer(node.$ref);
    if (localPointer !== null && resolveJsonPointer(activeResourceRoot, localPointer) === undefined) {
      findings.push(
        finding(
          'json-schema-unresolved-local-ref',
          'local JSON Pointer reference does not resolve within its schema resource',
          `${pointer}/$ref`,
          source,
        ),
      );
    }
  }

  // `required` is intentionally not cross-checked against `properties`.
  // Draft 2020-12 permits requiring a named property while leaving its value
  // unconstrained, including when no `properties` keyword is present.
  validateOrderedPair(node, 'minimum', 'maximum', pointer, source, findings);
  validateOrderedPair(node, 'exclusiveMinimum', 'exclusiveMaximum', pointer, source, findings);
  validateOrderedPair(node, 'minLength', 'maxLength', pointer, source, findings);
  validateOrderedPair(node, 'minItems', 'maxItems', pointer, source, findings);
  validateOrderedPair(node, 'minProperties', 'maxProperties', pointer, source, findings);
  validateOrderedPair(node, 'minContains', 'maxContains', pointer, source, findings);

  for (const key of SCHEMA_ARRAY_KEYWORDS) {
    if (!Array.isArray(node[key])) {
      continue;
    }
    for (let index = 0; index < node[key].length; index += 1) {
      if (isSchema(node[key][index])) {
        walkSchema(
          node[key][index],
          `${pointer}/${key}/${index}`,
          document,
          activeResourceRoot,
          source,
          findings,
          visited,
        );
      }
    }
  }

  for (const key of SCHEMA_MAP_KEYWORDS) {
    if (!isPlainObject(node[key])) {
      continue;
    }
    for (const [name, child] of Object.entries(node[key])) {
      if (isSchema(child)) {
        walkSchema(
          child,
          `${pointer}/${key}/${escapeJsonPointerSegment(name)}`,
          document,
          activeResourceRoot,
          source,
          findings,
          visited,
        );
      }
    }
  }

  for (const key of SCHEMA_SINGLE_KEYWORDS) {
    if (isSchema(node[key])) {
      walkSchema(
        node[key],
        `${pointer}/${key}`,
        document,
        activeResourceRoot,
        source,
        findings,
        visited,
      );
    }
  }

  walkLegacyDependencies(node, pointer, document, activeResourceRoot, source, findings, visited);
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
  walkSchema(document, '#', document, document, source, findings, new WeakSet());
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
  const typeValues = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (
    typeValues.includes('object') ||
    isPlainObject(schema.properties) ||
    Array.isArray(schema.allOf) ||
    isPlainObject(schema.patternProperties)
  ) {
    return 'model';
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    return 'union';
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
