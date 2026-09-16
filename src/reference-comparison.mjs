import { escapeJsonPointerSegment, isPlainObject } from './canonical.mjs';
import { SchemaResolver } from './instance-validator.mjs';
import { JSON_SCHEMA_DRAFT_2020_12 } from './json-schema.mjs';

const MAPS = new Set(['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas']);
const ARRAYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SINGLES = new Set([
  'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains',
  'not', 'if', 'then', 'else', 'contentSchema', 'items', 'unevaluatedItems',
]);
const DYNAMIC = new Set(['$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor', '$vocabulary']);
const SAFE_INLINE_STRING_LEAF_KEYS = new Set([
  '$schema', '$id', 'type', 'minLength', 'maxLength', 'pattern', 'format', 'description',
]);
const SAFE_INLINE_STRING_ASSERTION_KEYS = new Set([
  'type', 'minLength', 'maxLength', 'pattern', 'format',
]);
const SAFE_INLINE_RECORD_LEAF_KEYS = new Set([
  '$schema', '$id', 'type', 'properties', 'additionalProperties', 'unevaluatedProperties', 'description',
]);
const SAFE_INLINE_ARRAY_VALUE_KEYS = new Set([
  'type', 'items', 'minItems', 'maxItems', 'uniqueItems',
]);

// These ORES extensions are deliberately non-validating JSON Schema annotations.
// Persistence/code-generation annotations are independently checked by
// ores-contracts; x-ores-invariants is a runtime documentation marker whose
// corresponding rule must be enforced by the owning runtime contract tests.
// The runtime/language TJSV lane must not mistake their presence in an authored
// schema for an executable JSON Schema difference when the official TypeSpec
// JSON Schema emitter cannot carry them. The list is closed and reviewed:
// unknown `x-*` keywords remain visible to structural parity and fail closed.
const NON_VALIDATING_ORES_ANNOTATIONS = new Set([
  'x-ores-indexes',
  'x-ores-invariants',
  'x-ores-json',
  'x-ores-primary-key',
  'x-ores-references',
  'x-ores-table',
  'x-ores-unique',
  'x-ores-width',
]);

function validLeafResourceMetadata(schema) {
  if (
    Object.hasOwn(schema, '$schema')
    && schema.$schema !== JSON_SCHEMA_DRAFT_2020_12
  ) {
    return false;
  }
  if (Object.hasOwn(schema, '$id') && typeof schema.$id !== 'string') {
    return false;
  }
  return true;
}

function safeInlineStringSchema(schema) {
  if (!isPlainObject(schema) || schema.type !== 'string') return null;
  const keys = Object.keys(schema);
  if (keys.length === 0 || keys.some((key) => !SAFE_INLINE_STRING_LEAF_KEYS.has(key))) {
    return null;
  }
  if (!validLeafResourceMetadata(schema)) return null;
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => SAFE_INLINE_STRING_ASSERTION_KEYS.has(key)),
  );
}

function safeInlineStringLeaf(target) {
  return safeInlineStringSchema(target?.schema);
}

function safeInlineRecordValue(schema) {
  if (schema === true) return {};
  if (!isPlainObject(schema)) return null;
  if (Object.keys(schema).length === 0) return {};

  const stringSchema = safeInlineStringSchema(schema);
  if (stringSchema) return stringSchema;

  if (schema.type !== 'array') return null;
  const keys = Object.keys(schema);
  if (keys.some((key) => !SAFE_INLINE_ARRAY_VALUE_KEYS.has(key))) return null;
  if (!Object.hasOwn(schema, 'items')) return null;
  const items = safeInlineStringSchema(schema.items);
  if (!items) return null;
  const result = { type: 'array', items };
  for (const key of ['minItems', 'maxItems', 'uniqueItems']) {
    if (Object.hasOwn(schema, key)) result[key] = schema[key];
  }
  return result;
}

function safeInlineRecordLeaf(target) {
  if (!isPlainObject(target?.schema) || target.schema.type !== 'object') return null;
  const schema = target.schema;
  const keys = Object.keys(schema);
  if (keys.length === 0 || keys.some((key) => !SAFE_INLINE_RECORD_LEAF_KEYS.has(key))) {
    return null;
  }
  if (!validLeafResourceMetadata(schema)) return null;
  if (Object.hasOwn(schema, 'properties')) {
    if (!isPlainObject(schema.properties) || Object.keys(schema.properties).length !== 0) return null;
  }

  const hasAdditional = Object.hasOwn(schema, 'additionalProperties');
  const hasUnevaluated = Object.hasOwn(schema, 'unevaluatedProperties');
  const additional = hasAdditional ? schema.additionalProperties : undefined;
  const unevaluated = hasUnevaluated ? schema.unevaluatedProperties : undefined;

  // Normalize the two equivalent dictionary encodings used by the TypeSpec
  // JSON Schema emitter and independently authored Draft 2020-12 schemas:
  //   { unevaluatedProperties: <value-schema> }
  //   { additionalProperties: <value-schema>, unevaluatedProperties: false }
  // No named properties, compositions, refs, patterns, or mixed assertion
  // channels are admitted here. The value schema itself is retained exactly
  // enough for comparison; a changed constraint therefore remains visible.
  let valueSchema;
  if (hasAdditional && additional !== false) {
    if (hasUnevaluated && unevaluated !== false) return null;
    valueSchema = additional;
  } else if (!hasAdditional && hasUnevaluated && unevaluated !== false) {
    valueSchema = unevaluated;
  } else {
    return null;
  }

  const value = safeInlineRecordValue(valueSchema);
  if (value === null) return null;
  if (Object.keys(value).length === 0) return { type: 'object' };
  return { type: 'object', additionalProperties: value };
}

function safeInlineHelper(target) {
  return safeInlineStringLeaf(target) ?? safeInlineRecordLeaf(target);
}

/** Bind references before comparison is allowed to remove resource metadata. */
export function createScopedSchemaComparison({ collection, schemaMap, expectedDeclarations, lane, onFinding }) {
  // Declaration-only callers can perform a structural comparison, but have no
  // resource graph. The runner always supplies the complete loaded documents.
  if (!collection.documents?.length) return null;
  const resolver = new SchemaResolver(collection.documents);
  const records = new Map(resolver.documents.map((record) => [record.path, record]));
  const locations = [...expectedDeclarations.values()].flatMap((expected) => {
    const declaration = schemaMap.get(lane === 'generated' ? expected.generatedName : expected.authoredName);
    return declaration ? [{ ...declaration, identity: expected.declaration.qualifiedName }] : [];
  }).sort((left, right) => right.pointer.length - left.pointer.length);

  function report(ruleId, declaration, pointer, message) {
    onFinding({ ruleId, comparison: 'json-schema-reference-validation', declaration: declaration.name, pointer, source: declaration.source, message: `${lane}: ${message}` });
  }

  function targetIdentity(target) {
    const owner = locations.find((location) => location.source === target.record.path
      && (target.pointer === location.pointer || target.pointer.startsWith(`${location.pointer}/`)));
    if (!owner) return undefined;
    // A nested subschema is distinct from a top-level declaration with the same
    // simple name. The paired owner and exact relative pointer are both retained.
    return `urn:tsjsv:schema-location:${encodeURIComponent(owner.identity)}:${encodeURIComponent(target.pointer.slice(owner.pointer.length))}`;
  }

  function visit(node, inheritedBase, pointer, declaration) {
    if (!isPlainObject(node)) return node;
    const base = typeof node.$id === 'string' ? new URL(node.$id, inheritedBase).href.split('#')[0] : inheritedBase;

    // Comparison may inline deliberately narrow ignored helpers: a reference-only
    // assertion node that resolves to a self-contained string leaf or a pure
    // Record<T> dictionary helper whose value schema is a reviewed scalar/array
    // shape. Constraints are preserved during normalization. Reviewed ORES
    // annotations may sit beside the $ref because they are non-validating.
    // Unknown annotations or any other assertion/composition sibling fail closed.
    const assertionEntries = Object.entries(node)
      .filter(([key]) => !NON_VALIDATING_ORES_ANNOTATIONS.has(key));
    const assertionNode = Object.fromEntries(assertionEntries);
    const nodeKeys = Object.keys(assertionNode);
    if (nodeKeys.length === 1 && nodeKeys[0] === '$ref' && typeof assertionNode.$ref === 'string') {
      const target = resolver.resolve(assertionNode.$ref, base);
      if (target && targetIdentity(target) === undefined) {
        const leaf = safeInlineHelper(target);
        if (leaf) {
          return visit(leaf, target.parentBase, target.pointer, declaration);
        }
      }
    }

    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !NON_VALIDATING_ORES_ANNOTATIONS.has(key))
        .map(([key, value]) => {
          const childPointer = `${pointer}/${escapeJsonPointerSegment(key)}`;
          if (key === '$schema' && value !== JSON_SCHEMA_DRAFT_2020_12) {
            report('json-schema-unsupported-dialect', declaration, childPointer, 'static comparison requires Draft 2020-12 for every declared resource dialect');
          }
          if (DYNAMIC.has(key)) {
            report('json-schema-unsupported-reference', declaration, childPointer, `static reference comparison cannot evaluate ${key}`);
          }
          if (key === '$ref' && typeof value === 'string') {
            const target = resolver.resolve(value, base);
            if (!target) {
              report('json-schema-unresolved-ref', declaration, childPointer, 'reference does not resolve to a schema in the loaded authority');
              return [key, value];
            }
            const identity = targetIdentity(target);
            if (identity === undefined) {
              report('json-schema-uncompared-ref-target', declaration, childPointer, 'reference selects a schema outside the compared declarations');
              return [key, value];
            }
            return [key, identity];
          }
          if (MAPS.has(key) && isPlainObject(value)) {
            return [key, Object.fromEntries(Object.entries(value).map(([name, child]) =>
              [name, visit(child, base, `${childPointer}/${escapeJsonPointerSegment(name)}`, declaration)]))];
          }
          if (ARRAYS.has(key) && Array.isArray(value)) {
            return [key, value.map((child, index) => visit(child, base, `${childPointer}/${index}`, declaration))];
          }
          if (SINGLES.has(key)) return [key, visit(value, base, childPointer, declaration)];
          // const/enum/default/examples/extensions contain literal JSON, not schemas.
          return [key, value];
        }),
    );
  }

  return (declaration) => {
    const record = records.get(declaration.source);
    const location = record && resolver.resolve(declaration.pointer, record.base);
    if (!location) {
      report('json-schema-declaration-location-missing', declaration, declaration.pointer, 'declaration has no schema location in its loaded source');
      return declaration.schema;
    }
    return visit(declaration.schema, location.parentBase, declaration.pointer, declaration);
  };
}
