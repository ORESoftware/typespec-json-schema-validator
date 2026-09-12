/**
 * Dependency-free JSON Schema Draft 2020-12 instance validator.
 *
 * This module exists so that the independently authored JSON Schema authority (lane A)
 * can be executed as a validator over concrete instances, and so that the
 * TypeSpec-generated comparison witness (lane B) can be executed the same way. Running
 * both lanes over one instance corpus turns "the two documents look different" into
 * "here is an instance the two authorities disagree about", which is decidable evidence
 * rather than a formatting opinion.
 *
 * The validator is deliberately fail-closed: any keyword it cannot evaluate faithfully
 * raises `UnsupportedKeywordError` instead of being silently skipped, because silently
 * skipping a keyword would make two different schemas look behaviourally identical.
 */

import { isPlainObject, escapeJsonPointerSegment, unescapeJsonPointerSegment } from './canonical.mjs';
import { JSON_SCHEMA_DRAFT_2020_12 } from './json-schema.mjs';
import { registerSchemaUri } from './schema-uri-index.mjs';
import { FORMAT_ASSERTIONS } from './format-assertions.mjs';
export { SchemaIdentityError } from './schema-uri-index.mjs';

/** Synthetic base authority used when a schema document declares no absolute `$id`. */
const SYNTHETIC_BASE = 'https://tsjsv.invalid/';

// Only these keyword positions contain schemas. Literal JSON inside annotations,
// const/enum and extension values must never register resources or anchors.
const SCHEMA_MAP_KEYS = new Set(['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas']);
const SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_SINGLE_KEYS = new Set([
  'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains',
  'not', 'if', 'then', 'else', 'contentSchema', 'items', 'unevaluatedItems',
]);

/**
 * Keywords the validator evaluates. Anything outside this set and {@link ANNOTATION_KEYWORDS}
 * is refused rather than ignored.
 */
const ASSERTION_KEYWORDS = new Set([
  '$ref',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'contains',
  'dependentRequired',
  'dependentSchemas',
  'else',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'if',
  'items',
  'maxContains',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minContains',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'not',
  'oneOf',
  'pattern',
  'patternProperties',
  'prefixItems',
  'properties',
  'propertyNames',
  'required',
  'then',
  'type',
  'unevaluatedItems',
  'unevaluatedProperties',
  'uniqueItems',
]);

/** Keywords that carry no assertion behaviour and are safe to carry through untouched. */
const ANNOTATION_KEYWORDS = new Set([
  '$anchor',
  '$comment',
  '$defs',
  '$id',
  '$schema',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'default',
  'definitions',
  'deprecated',
  'description',
  'examples',
  'format',
  'readOnly',
  'title',
  'writeOnly',
]);

/**
 * Keywords that change validation outcomes in ways this validator does not model.
 * Encountering one is an error, never a silent pass.
 */
const REFUSED_KEYWORDS = new Set(['$dynamicAnchor', '$dynamicRef', '$recursiveAnchor', '$recursiveRef', '$vocabulary']);

const SIMPLE_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);

export class UnsupportedKeywordError extends Error {
  constructor(keyword, pointer, source) {
    super(`unsupported JSON Schema keyword ${keyword} at ${pointer} in ${source}`);
    this.name = 'UnsupportedKeywordError';
    this.keyword = keyword;
    this.pointer = pointer;
    this.source = source;
  }
}

export class SchemaResolutionError extends Error {
  constructor(reference, pointer, source) {
    super(`could not resolve $ref ${reference} referenced from ${pointer} in ${source}`);
    this.name = 'SchemaResolutionError';
    this.reference = reference;
    this.pointer = pointer;
    this.source = source;
  }
}

/** An evaluation limit is missing evidence, never an invalid-instance verdict. */
export class SchemaEvaluationError extends Error {
  constructor(reason, pointer, source) {
    super(`JSON Schema evaluation refused (${reason}) at ${pointer} in ${source}`);
    this.name = 'SchemaEvaluationError';
    this.reason = reason;
    this.pointer = pointer;
    this.source = source;
  }
}

function resolveUri(reference, base) {
  try {
    return new URL(reference, base).href;
  } catch {
    return undefined;
  }
}

function pointerSegments(fragment) {
  if (fragment === '' || fragment === '#') {
    return [];
  }
  let raw;
  try {
    // RFC 6901: decode the whole URI fragment before splitting its pointer.
    raw = decodeURIComponent(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  } catch {
    return undefined;
  }
  if (raw === '') {
    return [];
  }
  if (!raw.startsWith('/')) {
    return undefined;
  }
  const segments = raw.slice(1).split('/');
  if (segments.some((segment) => /~(?:[^01]|$)/u.test(segment))) return undefined;
  return segments.map(unescapeJsonPointerSegment);
}

function followPointer(root, segments) {
  let current = root;
  let location = 'schema';
  for (const segment of segments) {
    if (location === 'schema') {
      if (SCHEMA_MAP_KEYS.has(segment)) location = 'map';
      else if (SCHEMA_ARRAY_KEYS.has(segment)) location = 'array';
      else if (SCHEMA_SINGLE_KEYS.has(segment)) location = 'schema';
      else return undefined;
    } else if (location === 'array') {
      if (!Array.isArray(current) || !/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
      location = 'schema';
    } else {
      location = 'schema';
    }
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  // A map of declarations or literal JSON value is not itself a subschema.
  return location === 'schema' && (isPlainObject(current) || typeof current === 'boolean')
    ? current : undefined;
}

/**
 * A resolver owns one or more schema documents and knows how to turn a `$ref` into the
 * subschema it denotes, together with the base URI that subschema's own refs resolve against.
 */
export class SchemaResolver {
  #byUri = new Map();

  #documents = [];

  /**
   * @param {Array<{ path: string, document: unknown }>} documents Parsed schema documents.
   */
  constructor(documents = []) {
    for (const entry of documents) {
      this.addDocument(entry.document, entry.path);
    }
  }

  addDocument(document, path) {
    const index = this.#documents.length;
    const declaredId = isPlainObject(document) && typeof document.$id === 'string' ? document.$id : undefined;
    const fallbackBase = `${SYNTHETIC_BASE}${index}/${encodeURIComponent(path ?? `document-${index}`)}`;
    const rootBase = (declaredId ? resolveUri(declaredId, fallbackBase) ?? fallbackBase : fallbackBase).split('#')[0];
    const record = { path, document, base: rootBase };
    // A rejected bundle must not leave new resources, anchors or document slots.
    const pending = new Map();
    registerSchemaUri(pending, this.#byUri, rootBase.split('#')[0], {
      schema: document, base: rootBase, parentBase: fallbackBase, record, pointer: '#',
    });
    this.#register(document, fallbackBase, rootBase, '#', record, pending);
    for (const [uri, entry] of pending) this.#byUri.set(uri, entry);
    this.#documents.push(record);
    return record;
  }

  #register(node, base, rootBase, pointer, record, pending) {
    if (typeof node === 'boolean') {
      registerSchemaUri(pending, this.#byUri, `${rootBase}#${pointer === '#' ? '' : pointer.slice(1)}`, { schema: node, base, parentBase: base, record, pointer });
      return;
    }
    if (!isPlainObject(node)) {
      return;
    }
    let currentBase = base;
    if (typeof node.$id === 'string') {
      const resolved = resolveUri(node.$id, base);
      if (!resolved) throw new SchemaResolutionError(node.$id, `${pointer}/$id`, base);
      if (resolved) {
        currentBase = resolved.split('#')[0];
        registerSchemaUri(pending, this.#byUri, currentBase, { schema: node, base: currentBase, parentBase: base, record, pointer });
      }
    }
    const pointerUri = `${rootBase}#${pointer === '#' ? '' : pointer.slice(1)}`;
    registerSchemaUri(pending, this.#byUri, pointerUri, { schema: node, base: currentBase, parentBase: base, record, pointer });
    if (typeof node.$anchor === 'string') {
      registerSchemaUri(pending, this.#byUri, `${currentBase}#${node.$anchor}`, { schema: node, base: currentBase, parentBase: base, record, pointer });
    }

    for (const [key, child] of Object.entries(node)) {
      const childPointer = `${pointer === '#' ? '#' : pointer}/${escapeJsonPointerSegment(key)}`;
      if (SCHEMA_MAP_KEYS.has(key) && isPlainObject(child)) {
        for (const [name, subschema] of Object.entries(child)) {
          this.#register(subschema, currentBase, rootBase, `${childPointer}/${escapeJsonPointerSegment(name)}`, record, pending);
        }
      } else if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(child)) {
        for (let itemIndex = 0; itemIndex < child.length; itemIndex += 1) {
          this.#register(child[itemIndex], currentBase, rootBase, `${childPointer}/${itemIndex}`, record, pending);
        }
      } else if (SCHEMA_SINGLE_KEYS.has(key)) {
        this.#register(child, currentBase, rootBase, childPointer, record, pending);
      }
    }
  }

  /**
   * @returns {{ schema: unknown, base: string } | undefined}
   */
  resolve(reference, base) {
    const absolute = resolveUri(reference, base);
    if (absolute === undefined) {
      return undefined;
    }
    const direct = this.#byUri.get(absolute);
    if (direct) {
      return direct;
    }
    const hashIndex = absolute.indexOf('#');
    if (hashIndex === -1) {
      return undefined;
    }
    const documentUri = absolute.slice(0, hashIndex);
    const fragment = absolute.slice(hashIndex);
    const segments = pointerSegments(fragment);
    if (segments === undefined) {
      return undefined;
    }
    const anchorTarget = this.#byUri.get(documentUri);
    if (!anchorTarget) {
      return undefined;
    }
    const schema = followPointer(anchorTarget.schema, segments);
    if (schema === undefined) {
      return undefined;
    }
    // A pointer can cross embedded resources. Recover the registered location's
    // scope instead of substituting the enclosing resource's base URI.
    const pointer = `${anchorTarget.pointer}${segments.map((segment) => `/${escapeJsonPointerSegment(segment)}`).join('')}`;
    return this.#byUri.get(`${anchorTarget.record.base}${pointer}`);
  }

  get documents() {
    return [...this.#documents];
  }
}

function typeOfInstance(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOfInstance(value);
  if (type === 'number') {
    return actual === 'number' || actual === 'integer';
  }
  if (type === 'integer') {
    return actual === 'integer' || (actual === 'number' && Number.isInteger(value));
  }
  return actual === type;
}

/** Deep equality over JSON values, used by `const`, `enum` and `uniqueItems`. */
export function jsonEquals(left, right) {
  if (left === right) {
    return true;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left === right;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEquals(item, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index]) &&
      leftKeys.every((key) => jsonEquals(left[key], right[key]))
    );
  }
  return false;
}

function isMultipleOf(value, divisor) {
  if (divisor <= 0 || !Number.isFinite(divisor)) {
    return false;
  }
  const quotient = value / divisor;
  if (Number.isInteger(quotient)) {
    return true;
  }
  // Tolerate binary floating point drift without accepting genuinely off-grid values.
  const rounded = Math.round(quotient);
  return Math.abs(quotient - rounded) < 1e-9 && Math.abs(value - rounded * divisor) <= Math.abs(value) * 1e-12;
}

function compileRegExp(pattern, cache) {
  const cached = cache.get(pattern);
  if (cached !== undefined) {
    return cached;
  }
  let expression;
  try {
    expression = new RegExp(pattern, 'u');
  } catch {
    try {
      expression = new RegExp(pattern);
    } catch {
      expression = null;
    }
  }
  cache.set(pattern, expression);
  return expression;
}

function emptyAnnotations() {
  return { properties: new Set(), items: 0, matchedItems: new Set(), allItems: false };
}

function mergeAnnotations(target, source) {
  for (const property of source.properties) {
    target.properties.add(property);
  }
  for (const index of source.matchedItems) target.matchedItems.add(index);
  target.items = Math.max(target.items, source.items);
  target.allItems = target.allItems || source.allItems;
  return target;
}

class ValidationContext {
  constructor(resolver, options = {}) {
    this.resolver = resolver;
    this.formatAssertion = options.formatAssertion === true;
    this.maxErrors = options.maxErrors ?? 32;
    this.maxDepth = options.maxDepth ?? 128;
    this.regexCache = new Map();
    this.errors = [];
    this.refStack = [];
  }

  push(keyword, instancePath, schemaPointer, message, extra = {}) {
    if (this.errors.length < this.maxErrors) {
      this.errors.push({ keyword, instancePath, schemaPointer, message, ...extra });
    }
  }
}

/**
 * Refuse the keywords whose semantics this validator does not model. Unknown keywords are
 * annotations under Draft 2020-12 and cannot change a verdict, so they pass through; the
 * dynamic-reference family genuinely can change a verdict and is therefore refused.
 */
function assertKnownKeywords(schema, schemaPointer, source) {
  if (schema.$schema !== undefined && schema.$schema !== JSON_SCHEMA_DRAFT_2020_12) {
    throw new UnsupportedKeywordError('$schema', schemaPointer, source);
  }
  for (const keyword of Object.keys(schema)) {
    if (REFUSED_KEYWORDS.has(keyword)) {
      throw new UnsupportedKeywordError(keyword, schemaPointer, source);
    }
  }
}

/**
 * Core recursive evaluation. Returns whether the instance is valid together with the
 * annotation set that `unevaluatedProperties` / `unevaluatedItems` consume.
 */
function evaluate(schema, instance, base, ctx, instancePath, schemaPointer, depth) {
  if (depth > ctx.maxDepth) {
    throw new SchemaEvaluationError('maximum-depth', schemaPointer, base);
  }
  if (schema === true) {
    return { valid: true, annotations: emptyAnnotations() };
  }
  if (schema === false) {
    ctx.push('false', instancePath, schemaPointer, 'schema is unsatisfiable (false)');
    return { valid: false, annotations: emptyAnnotations() };
  }
  if (!isPlainObject(schema)) {
    ctx.push('schema', instancePath, schemaPointer, 'schema node must be an object or boolean');
    return { valid: false, annotations: emptyAnnotations() };
  }

  assertKnownKeywords(schema, schemaPointer, base);

  let currentBase = base;
  if (typeof schema.$id === 'string') {
    const resolved = resolveUri(schema.$id, base);
    if (!resolved) throw new SchemaResolutionError(schema.$id, `${schemaPointer}/$id`, base);
    if (resolved) {
      currentBase = resolved.split('#')[0];
    }
  }

  const annotations = emptyAnnotations();
  let valid = true;

  const fail = (keyword, message, extra) => {
    valid = false;
    ctx.push(keyword, instancePath, `${schemaPointer}/${keyword}`, message, extra);
  };

  // ---- $ref (in-place applicator) -------------------------------------------------
  if (typeof schema.$ref === 'string') {
    const target = ctx.resolver.resolve(schema.$ref, currentBase);
    if (!target) {
      throw new SchemaResolutionError(schema.$ref, schemaPointer, currentBase);
    }
    const frame = `${currentBase}|${schema.$ref}|${instancePath}`;
    if (ctx.refStack.includes(frame)) {
      throw new SchemaEvaluationError('reference-cycle', `${schemaPointer}/$ref`, currentBase);
    }
    ctx.refStack.push(frame);
    let result;
    try {
      result = evaluate(target.schema, instance, target.parentBase, ctx, instancePath, `${schemaPointer}/$ref`, depth + 1);
    } finally {
      ctx.refStack.pop();
    }
    if (result.valid) {
      mergeAnnotations(annotations, result.annotations);
    } else {
      valid = false;
    }
  }

  // ---- type -----------------------------------------------------------------------
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const known = types.filter((type) => SIMPLE_TYPES.has(type));
    if (known.length !== types.length) {
      throw new UnsupportedKeywordError(`type:${types.join(',')}`, schemaPointer, currentBase);
    }
    if (!known.some((type) => matchesType(instance, type))) {
      fail('type', `expected type ${known.join(' | ')}, received ${typeOfInstance(instance)}`, {
        expected: known,
        actual: typeOfInstance(instance),
      });
    }
  }

  // ---- const / enum ---------------------------------------------------------------
  if ('const' in schema && !jsonEquals(instance, schema.const)) {
    fail('const', 'instance does not equal the declared const value', { expected: schema.const });
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonEquals(instance, candidate))) {
    fail('enum', 'instance is not one of the declared enum values', { expected: schema.enum });
  }

  // ---- string assertions ----------------------------------------------------------
  if (typeof instance === 'string') {
    const length = [...instance].length;
    if (typeof schema.minLength === 'number' && length < schema.minLength) {
      fail('minLength', `string length ${length} is below minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) {
      fail('maxLength', `string length ${length} exceeds maxLength ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      const expression = compileRegExp(schema.pattern, ctx.regexCache);
      if (expression === null) {
        throw new UnsupportedKeywordError(`pattern:${schema.pattern}`, schemaPointer, currentBase);
      }
      if (!expression.test(instance)) {
        fail('pattern', `string does not match pattern ${schema.pattern}`);
      }
    }
    if (ctx.formatAssertion && typeof schema.format === 'string') {
      const expression = FORMAT_ASSERTIONS[schema.format];
      if (expression && !expression.test(instance)) {
        fail('format', `string does not satisfy format ${schema.format}`);
      }
    }
  }

  // ---- numeric assertions ---------------------------------------------------------
  if (typeof instance === 'number' && Number.isFinite(instance)) {
    if (typeof schema.minimum === 'number' && instance < schema.minimum) {
      fail('minimum', `${instance} is below minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && instance > schema.maximum) {
      fail('maximum', `${instance} exceeds maximum ${schema.maximum}`);
    }
    if (typeof schema.exclusiveMinimum === 'number' && instance <= schema.exclusiveMinimum) {
      fail('exclusiveMinimum', `${instance} is not above exclusiveMinimum ${schema.exclusiveMinimum}`);
    }
    if (typeof schema.exclusiveMaximum === 'number' && instance >= schema.exclusiveMaximum) {
      fail('exclusiveMaximum', `${instance} is not below exclusiveMaximum ${schema.exclusiveMaximum}`);
    }
    if (typeof schema.multipleOf === 'number' && !isMultipleOf(instance, schema.multipleOf)) {
      fail('multipleOf', `${instance} is not a multiple of ${schema.multipleOf}`);
    }
  }

  // ---- object assertions and applicators -------------------------------------------
  if (isPlainObject(instance)) {
    const keys = Object.keys(instance);
    // additionalProperties sees only sibling properties/patternProperties, not
    // the annotations inherited from $ref or another in-place applicator.
    const locallyDeclared = new Set();
    if (Array.isArray(schema.required)) {
      for (const property of schema.required) {
        if (!Object.hasOwn(instance, property)) {
          fail('required', `required property is absent: ${property}`, { property });
        }
      }
    }
    if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties) {
      fail('minProperties', `object has ${keys.length} properties, below minProperties ${schema.minProperties}`);
    }
    if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties) {
      fail('maxProperties', `object has ${keys.length} properties, above maxProperties ${schema.maxProperties}`);
    }
    if (isPlainObject(schema.dependentRequired)) {
      for (const [trigger, dependencies] of Object.entries(schema.dependentRequired)) {
        if (!Object.hasOwn(instance, trigger) || !Array.isArray(dependencies)) {
          continue;
        }
        for (const dependency of dependencies) {
          if (!Object.hasOwn(instance, dependency)) {
            fail('dependentRequired', `property ${trigger} requires absent property ${dependency}`);
          }
        }
      }
    }

    if (isPlainObject(schema.properties)) {
      for (const [property, subschema] of Object.entries(schema.properties)) {
        if (!Object.hasOwn(instance, property)) {
          continue;
        }
        locallyDeclared.add(property);
        const result = evaluate(
          subschema,
          instance[property],
          currentBase,
          ctx,
          `${instancePath}/${escapeJsonPointerSegment(property)}`,
          `${schemaPointer}/properties/${escapeJsonPointerSegment(property)}`,
          depth + 1,
        );
        if (result.valid) {
          annotations.properties.add(property);
        } else {
          valid = false;
        }
      }
    }

    if (isPlainObject(schema.patternProperties)) {
      for (const [pattern, subschema] of Object.entries(schema.patternProperties)) {
        const expression = compileRegExp(pattern, ctx.regexCache);
        if (expression === null) {
          throw new UnsupportedKeywordError(`patternProperties:${pattern}`, schemaPointer, currentBase);
        }
        for (const property of keys) {
          if (!expression.test(property)) {
            continue;
          }
          locallyDeclared.add(property);
          const result = evaluate(
            subschema,
            instance[property],
            currentBase,
            ctx,
            `${instancePath}/${escapeJsonPointerSegment(property)}`,
            `${schemaPointer}/patternProperties/${escapeJsonPointerSegment(pattern)}`,
            depth + 1,
          );
          if (result.valid) {
            annotations.properties.add(property);
          } else {
            valid = false;
          }
        }
      }
    }

    if (schema.additionalProperties !== undefined) {
      for (const property of keys) {
        if (locallyDeclared.has(property)) {
          continue;
        }
        const result = evaluate(
          schema.additionalProperties,
          instance[property],
          currentBase,
          ctx,
          `${instancePath}/${escapeJsonPointerSegment(property)}`,
          `${schemaPointer}/additionalProperties`,
          depth + 1,
        );
        if (result.valid) {
          annotations.properties.add(property);
        } else {
          valid = false;
        }
      }
    }

    if (schema.propertyNames !== undefined) {
      for (const property of keys) {
        const result = evaluate(
          schema.propertyNames,
          property,
          currentBase,
          ctx,
          `${instancePath}/${escapeJsonPointerSegment(property)}`,
          `${schemaPointer}/propertyNames`,
          depth + 1,
        );
        if (!result.valid) {
          valid = false;
        }
      }
    }

    if (isPlainObject(schema.dependentSchemas)) {
      for (const [trigger, subschema] of Object.entries(schema.dependentSchemas)) {
        if (!Object.hasOwn(instance, trigger)) {
          continue;
        }
        const result = evaluate(
          subschema,
          instance,
          currentBase,
          ctx,
          instancePath,
          `${schemaPointer}/dependentSchemas/${escapeJsonPointerSegment(trigger)}`,
          depth + 1,
        );
        if (result.valid) {
          mergeAnnotations(annotations, result.annotations);
        } else {
          valid = false;
        }
      }
    }
  }

  // ---- array assertions and applicators ---------------------------------------------
  if (Array.isArray(instance)) {
    if (typeof schema.minItems === 'number' && instance.length < schema.minItems) {
      fail('minItems', `array has ${instance.length} items, below minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === 'number' && instance.length > schema.maxItems) {
      fail('maxItems', `array has ${instance.length} items, above maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      for (let index = 0; index < instance.length; index += 1) {
        for (let other = index + 1; other < instance.length; other += 1) {
          if (jsonEquals(instance[index], instance[other])) {
            fail('uniqueItems', `array items ${index} and ${other} are duplicates`);
          }
        }
      }
    }

    let prefixCount = 0;
    if (Array.isArray(schema.prefixItems)) {
      prefixCount = Math.min(schema.prefixItems.length, instance.length);
      for (let index = 0; index < prefixCount; index += 1) {
        const result = evaluate(
          schema.prefixItems[index],
          instance[index],
          currentBase,
          ctx,
          `${instancePath}/${index}`,
          `${schemaPointer}/prefixItems/${index}`,
          depth + 1,
        );
        if (result.valid) {
          annotations.items = Math.max(annotations.items, index + 1);
        } else {
          valid = false;
        }
      }
    }

    if (schema.items !== undefined) {
      let allValid = true;
      for (let index = prefixCount; index < instance.length; index += 1) {
        const result = evaluate(
          schema.items,
          instance[index],
          currentBase,
          ctx,
          `${instancePath}/${index}`,
          `${schemaPointer}/items`,
          depth + 1,
        );
        if (!result.valid) {
          allValid = false;
          valid = false;
        }
      }
      if (allValid) {
        annotations.allItems = true;
        annotations.items = instance.length;
      }
    }

    if (schema.contains !== undefined) {
      let matches = 0;
      for (let index = 0; index < instance.length; index += 1) {
        const probe = new ValidationContext(ctx.resolver, {
          formatAssertion: ctx.formatAssertion,
          maxErrors: 0,
          maxDepth: ctx.maxDepth,
        });
        probe.regexCache = ctx.regexCache;
        probe.refStack = ctx.refStack;
        const result = evaluate(
          schema.contains,
          instance[index],
          currentBase,
          probe,
          `${instancePath}/${index}`,
          `${schemaPointer}/contains`,
          depth + 1,
        );
        if (result.valid) {
          matches += 1;
          // contains evaluates a sparse set, not the entire preceding prefix.
          annotations.matchedItems.add(index);
        }
      }
      const minContains = typeof schema.minContains === 'number' ? schema.minContains : 1;
      if (matches < minContains) {
        fail('contains', `array has ${matches} matching items, below minContains ${minContains}`);
      }
      if (typeof schema.maxContains === 'number' && matches > schema.maxContains) {
        fail('maxContains', `array has ${matches} matching items, above maxContains ${schema.maxContains}`);
      }
    }
  }

  // ---- in-place applicators ----------------------------------------------------------
  if (Array.isArray(schema.allOf)) {
    for (let index = 0; index < schema.allOf.length; index += 1) {
      const result = evaluate(
        schema.allOf[index],
        instance,
        currentBase,
        ctx,
        instancePath,
        `${schemaPointer}/allOf/${index}`,
        depth + 1,
      );
      if (result.valid) {
        mergeAnnotations(annotations, result.annotations);
      } else {
        valid = false;
      }
    }
  }

  if (Array.isArray(schema.anyOf)) {
    let anyValid = false;
    const branchAnnotations = emptyAnnotations();
    for (let index = 0; index < schema.anyOf.length; index += 1) {
      const probe = new ValidationContext(ctx.resolver, {
        formatAssertion: ctx.formatAssertion,
        maxErrors: 0,
        maxDepth: ctx.maxDepth,
      });
      probe.regexCache = ctx.regexCache;
      probe.refStack = ctx.refStack;
      const result = evaluate(
        schema.anyOf[index],
        instance,
        currentBase,
        probe,
        instancePath,
        `${schemaPointer}/anyOf/${index}`,
        depth + 1,
      );
      if (result.valid) {
        anyValid = true;
        mergeAnnotations(branchAnnotations, result.annotations);
      }
    }
    if (anyValid) {
      mergeAnnotations(annotations, branchAnnotations);
    } else {
      fail('anyOf', 'instance does not satisfy any anyOf branch');
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const matched = [];
    const branchAnnotations = [];
    for (let index = 0; index < schema.oneOf.length; index += 1) {
      const probe = new ValidationContext(ctx.resolver, {
        formatAssertion: ctx.formatAssertion,
        maxErrors: 0,
        maxDepth: ctx.maxDepth,
      });
      probe.regexCache = ctx.regexCache;
      probe.refStack = ctx.refStack;
      const result = evaluate(
        schema.oneOf[index],
        instance,
        currentBase,
        probe,
        instancePath,
        `${schemaPointer}/oneOf/${index}`,
        depth + 1,
      );
      if (result.valid) {
        matched.push(index);
        branchAnnotations.push(result.annotations);
      }
    }
    if (matched.length === 1) {
      mergeAnnotations(annotations, branchAnnotations[0]);
    } else if (matched.length === 0) {
      fail('oneOf', 'instance does not satisfy any oneOf branch');
    } else {
      fail('oneOf', `instance satisfies ${matched.length} oneOf branches; exactly one is required`, {
        matchedBranches: matched,
      });
    }
  }

  if (schema.not !== undefined) {
    const probe = new ValidationContext(ctx.resolver, {
      formatAssertion: ctx.formatAssertion,
      maxErrors: 0,
      maxDepth: ctx.maxDepth,
    });
    probe.regexCache = ctx.regexCache;
    probe.refStack = ctx.refStack;
    const result = evaluate(schema.not, instance, currentBase, probe, instancePath, `${schemaPointer}/not`, depth + 1);
    if (result.valid) {
      fail('not', 'instance satisfies a schema that must not be satisfied');
    }
  }

  if (schema.if !== undefined) {
    const probe = new ValidationContext(ctx.resolver, {
      formatAssertion: ctx.formatAssertion,
      maxErrors: 0,
      maxDepth: ctx.maxDepth,
    });
    probe.regexCache = ctx.regexCache;
    probe.refStack = ctx.refStack;
    const conditional = evaluate(schema.if, instance, currentBase, probe, instancePath, `${schemaPointer}/if`, depth + 1);
    if (conditional.valid) {
      mergeAnnotations(annotations, conditional.annotations);
      if (schema.then !== undefined) {
        const result = evaluate(schema.then, instance, currentBase, ctx, instancePath, `${schemaPointer}/then`, depth + 1);
        if (result.valid) {
          mergeAnnotations(annotations, result.annotations);
        } else {
          valid = false;
        }
      }
    } else if (schema.else !== undefined) {
      const result = evaluate(schema.else, instance, currentBase, ctx, instancePath, `${schemaPointer}/else`, depth + 1);
      if (result.valid) {
        mergeAnnotations(annotations, result.annotations);
      } else {
        valid = false;
      }
    }
  }

  // ---- unevaluated* (consume the annotations gathered above) --------------------------
  if (schema.unevaluatedProperties !== undefined && isPlainObject(instance)) {
    for (const property of Object.keys(instance)) {
      if (annotations.properties.has(property)) {
        continue;
      }
      const result = evaluate(
        schema.unevaluatedProperties,
        instance[property],
        currentBase,
        ctx,
        `${instancePath}/${escapeJsonPointerSegment(property)}`,
        `${schemaPointer}/unevaluatedProperties`,
        depth + 1,
      );
      if (result.valid) {
        annotations.properties.add(property);
      } else {
        valid = false;
      }
    }
  }

  if (schema.unevaluatedItems !== undefined && Array.isArray(instance)) {
    const start = annotations.allItems ? instance.length : annotations.items;
    let allValid = true;
    for (let index = start; index < instance.length; index += 1) {
      if (annotations.matchedItems.has(index)) continue;
      const result = evaluate(
        schema.unevaluatedItems,
        instance[index],
        currentBase,
        ctx,
        `${instancePath}/${index}`,
        `${schemaPointer}/unevaluatedItems`,
        depth + 1,
      );
      if (!result.valid) {
        allValid = false;
        valid = false;
      }
    }
    if (allValid) {
      annotations.allItems = true;
      annotations.items = instance.length;
    }
  }

  return { valid, annotations };
}

/**
 * Validate one instance against one schema.
 *
 * @param {object} input
 * @param {unknown} input.schema Schema node to evaluate.
 * @param {unknown} input.instance Instance to validate.
 * @param {SchemaResolver} input.resolver Resolver owning the schema's document(s).
 * @param {string} input.base Base URI the schema's own `$ref`s resolve against.
 * @param {boolean} [input.formatAssertion] Treat known `format` values as assertions.
 * @param {number} [input.maxErrors] Cap on retained error records.
 * @returns {{ valid: boolean, errors: Array<object> }}
 */
export function validateInstance({ schema, instance, resolver, base, formatAssertion = false, maxErrors = 32 }) {
  const ctx = new ValidationContext(resolver, { formatAssertion, maxErrors });
  const resource = resolver.resolve('#', base);
  const inheritedBase = resource?.schema === schema ? resource.parentBase : base;
  const result = evaluate(schema, instance, inheritedBase, ctx, '', '#', 0);
  return { valid: result.valid, errors: ctx.errors };
}

export const INTERNAL = Object.freeze({
  ASSERTION_KEYWORDS,
  ANNOTATION_KEYWORDS,
  REFUSED_KEYWORDS,
  FORMAT_ASSERTIONS,
  SYNTHETIC_BASE,
});
