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
    return Object.fromEntries(Object.entries(node).map(([key, value]) => {
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
    }));
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
