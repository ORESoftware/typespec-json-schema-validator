/**
 * Deterministic instance synthesis and mutation.
 *
 * The differential lane needs concrete JSON values to push through both authorities. It does
 * NOT need those values to be valid: a probe is informative precisely when the two authorities
 * disagree about it, and disagreement is meaningful whether the probe is accepted or rejected.
 * Synthesis quality therefore affects coverage, never soundness.
 *
 * Everything here is deterministic and ordering-stable so that two runs over identical inputs
 * produce byte-identical receipts.
 */

import { canonicalStringify, isPlainObject, escapeJsonPointerSegment } from './canonical.mjs';

/** Property name injected to probe additional/unevaluated-property policy. */
export const UNEXPECTED_PROPERTY = '__tsjsv_unexpected__';

/** String injected to probe enum, const and pattern domains. */
export const OUT_OF_DOMAIN_STRING = '__tsjsv_out_of_domain__';

const SCALAR_SUBSTITUTIONS = Object.freeze([
  { label: 'null', value: null },
  { label: 'string', value: OUT_OF_DOMAIN_STRING },
  { label: 'empty-string', value: '' },
  { label: 'zero', value: 0 },
  { label: 'negative', value: -1 },
  { label: 'fractional', value: 1.5 },
  { label: 'boolean', value: true },
  { label: 'array', value: [] },
  { label: 'object', value: {} },
]);

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map(deepClone);
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = deepClone(value[key]);
    }
    return result;
  }
  return value;
}

function resolveNode(schema, base, resolver, depth) {
  let current = schema;
  let currentBase = base;
  if (isPlainObject(current) && typeof current.$id === 'string') {
    try {
      currentBase = new URL(current.$id, currentBase).href.split('#')[0];
    } catch {
      // Keep the inherited base when the identifier cannot be resolved.
    }
  }
  let hops = 0;
  while (isPlainObject(current) && typeof current.$ref === 'string' && hops < 32) {
    const target = resolver.resolve(current.$ref, currentBase);
    if (!target) {
      return { schema: current, base: currentBase, unresolved: current.$ref };
    }
    const merged = { ...current };
    delete merged.$ref;
    current = isPlainObject(target.schema) && Object.keys(merged).length > 0
      ? { ...target.schema, ...merged }
      : target.schema;
    currentBase = target.base;
    hops += 1;
  }
  return { schema: current, base: currentBase, depth };
}

function chooseType(schema) {
  if (Array.isArray(schema.type)) {
    const preferred = schema.type.find((candidate) => candidate !== 'null');
    return preferred ?? schema.type[0];
  }
  if (typeof schema.type === 'string') {
    return schema.type;
  }
  if (isPlainObject(schema.properties) || Array.isArray(schema.required) || isPlainObject(schema.patternProperties)) {
    return 'object';
  }
  if (schema.items !== undefined || Array.isArray(schema.prefixItems)) {
    return 'array';
  }
  return undefined;
}

function representativeCharacterFromClass(source) {
  if (!source || source.startsWith('^')) {
    return undefined;
  }
  if (source.startsWith('\\d')) {
    return '0';
  }
  if (source.startsWith('\\w')) {
    return 'a';
  }
  if (source.startsWith('\\s')) {
    return ' ';
  }
  if (source.startsWith('\\') && source.length >= 2) {
    return source[1];
  }
  return source[0];
}

function buildAnchoredCharacterClassPattern(pattern, minLength, maxLength) {
  if (typeof pattern !== 'string' || !pattern.startsWith('^') || !pattern.endsWith('$')) {
    return undefined;
  }
  const body = pattern.slice(1, -1);
  const token = /\[((?:\\.|[^\]])+)\](\{(\d+)(?:,(\d*))?\}|[+*?])?/gyu;
  let index = 0;
  let value = '';
  let stretchable;

  while (index < body.length) {
    token.lastIndex = index;
    const match = token.exec(body);
    if (!match || match.index !== index) {
      return undefined;
    }
    const character = representativeCharacterFromClass(match[1]);
    if (character === undefined) {
      return undefined;
    }

    let minimum = 1;
    let maximum = 1;
    const quantifier = match[2];
    if (quantifier?.startsWith('{')) {
      minimum = Number(match[3]);
      maximum = match[4] === undefined
        ? minimum
        : match[4] === ''
          ? Number.POSITIVE_INFINITY
          : Number(match[4]);
    } else if (quantifier === '+') {
      minimum = 1;
      maximum = Number.POSITIVE_INFINITY;
    } else if (quantifier === '*') {
      minimum = 0;
      maximum = Number.POSITIVE_INFINITY;
    } else if (quantifier === '?') {
      minimum = 0;
      maximum = 1;
    }

    value += character.repeat(minimum);
    if (maximum > minimum) {
      stretchable = {
        character,
        remaining: Number.isFinite(maximum) ? maximum - minimum : Number.POSITIVE_INFINITY,
      };
    }
    index = token.lastIndex;
  }

  if (value.length < minLength) {
    const additional = minLength - value.length;
    if (!stretchable || additional > stretchable.remaining) {
      return undefined;
    }
    value += stretchable.character.repeat(additional);
  }
  if (value.length > maxLength) {
    return undefined;
  }
  return value;
}

function buildString(schema) {
  const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
  const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : Number.POSITIVE_INFINITY;
  const patterned = buildAnchoredCharacterClassPattern(schema.pattern, minLength, maxLength);
  if (patterned !== undefined) {
    return patterned;
  }
  const seed = 'tsjsv';
  let value = seed.length >= minLength ? seed : seed.padEnd(minLength, 'x');
  if (value.length > maxLength) {
    value = value.slice(0, Math.max(0, maxLength));
  }
  return value;
}

function buildNumber(schema, integral) {
  const multipleOf = typeof schema.multipleOf === 'number' && schema.multipleOf > 0 ? schema.multipleOf : undefined;
  let value = 1;
  if (typeof schema.minimum === 'number') {
    value = schema.minimum;
  } else if (typeof schema.exclusiveMinimum === 'number') {
    value = schema.exclusiveMinimum + (integral ? 1 : 0.5);
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    value = schema.maximum;
  }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
    value = schema.exclusiveMaximum - (integral ? 1 : 0.5);
  }
  if (multipleOf) {
    const steps = Math.ceil(value / multipleOf);
    value = steps * multipleOf;
  }
  return integral ? Math.round(value) : value;
}

/**
 * Build one representative instance for a schema.
 *
 * @param {object} input
 * @param {unknown} input.schema
 * @param {string} input.base
 * @param {import('./instance-validator.mjs').SchemaResolver} input.resolver
 * @param {'minimal'|'full'} [input.mode] `minimal` emits required properties only.
 * @returns {{ instance: unknown, complete: boolean }} `complete` is false when synthesis had to
 *   guess (unsupported pattern, unresolved reference, depth cutoff).
 */
export function synthesizeInstance({ schema, base, resolver, mode = 'full', maxDepth = 8 }) {
  const seen = new Set();
  let complete = true;

  function build(node, nodeBase, depth) {
    if (depth > maxDepth) {
      complete = false;
      return null;
    }
    if (node === true) {
      return {};
    }
    if (node === false) {
      complete = false;
      return null;
    }
    if (!isPlainObject(node)) {
      complete = false;
      return null;
    }

    const resolved = resolveNode(node, nodeBase, resolver, depth);
    if (resolved.unresolved) {
      complete = false;
      return null;
    }
    const schemaNode = resolved.schema;
    if (typeof schemaNode === 'boolean') {
      return schemaNode ? {} : null;
    }
    if (!isPlainObject(schemaNode)) {
      complete = false;
      return null;
    }

    const identity = canonicalStringify(schemaNode);
    if (seen.has(identity)) {
      complete = false;
      return null;
    }
    seen.add(identity);
    try {
      if ('const' in schemaNode) {
        return deepClone(schemaNode.const);
      }
      if (Array.isArray(schemaNode.enum) && schemaNode.enum.length > 0) {
        return deepClone(schemaNode.enum[0]);
      }
      for (const key of ['allOf', 'anyOf', 'oneOf']) {
        if (Array.isArray(schemaNode[key]) && schemaNode[key].length > 0) {
          if (key === 'allOf') {
            const parts = schemaNode[key].map((branch) => build(branch, resolved.base, depth + 1));
            const own = chooseType(schemaNode) === 'object'
              ? build({ ...schemaNode, allOf: undefined }, resolved.base, depth + 1)
              : undefined;
            const objectParts = parts.filter(isPlainObject);
            if (isPlainObject(own)) {
              return Object.assign({}, ...objectParts, own);
            }
            if (objectParts.length > 0) {
              return Object.assign({}, ...objectParts);
            }
            return parts[0];
          }
          return build(schemaNode[key][0], resolved.base, depth + 1);
        }
      }

      const type = chooseType(schemaNode);
      switch (type) {
        case 'object': {
          const instance = {};
          const required = new Set(Array.isArray(schemaNode.required) ? schemaNode.required : []);
          const properties = isPlainObject(schemaNode.properties) ? schemaNode.properties : {};
          for (const property of Object.keys(properties).sort()) {
            if (mode === 'minimal' && !required.has(property)) {
              continue;
            }
            instance[property] = build(properties[property], resolved.base, depth + 1);
          }
          for (const property of [...required].sort()) {
            if (!(property in instance)) {
              complete = false;
              instance[property] = null;
            }
          }
          return instance;
        }
        case 'array': {
          const minItems = typeof schemaNode.minItems === 'number' ? schemaNode.minItems : 1;
          const prefix = Array.isArray(schemaNode.prefixItems) ? schemaNode.prefixItems : [];
          const instance = prefix.map((item) => build(item, resolved.base, depth + 1));
          const target = Math.max(minItems, instance.length, schemaNode.items === undefined ? instance.length : 1);
          while (instance.length < target) {
            instance.push(schemaNode.items === undefined ? null : build(schemaNode.items, resolved.base, depth + 1));
          }
          if (typeof schemaNode.maxItems === 'number' && instance.length > schemaNode.maxItems) {
            instance.length = schemaNode.maxItems;
          }
          return instance;
        }
        case 'string': {
          const value = buildString(schemaNode);
          if (typeof schemaNode.pattern === 'string') {
            try {
              if (!new RegExp(schemaNode.pattern, 'u').test(value)) {
                complete = false;
              }
            } catch {
              complete = false;
            }
          }
          return value;
        }
        case 'integer':
          return buildNumber(schemaNode, true);
        case 'number':
          return buildNumber(schemaNode, false);
        case 'boolean':
          return true;
        case 'null':
          return null;
        default:
          complete = false;
          return null;
      }
    } finally {
      seen.delete(identity);
    }
  }

  const instance = build(schema, base, 0);
  return { instance, complete };
}

/**
 * Walk a schema in parallel with the shape {@link synthesizeInstance} would build, recording the
 * closed value domain (`enum` / `const`) that applies at each instance pointer.
 *
 * Enumerating a declaration's own domain is what turns "the two enums differ by one member" into
 * a witness instance: probing only a synthesized representative would exercise a value both
 * authorities happen to share and report a false agreement.
 *
 * @returns {Array<{ pointer: string, values: unknown[] }>} Stable, pointer-sorted domains.
 */
export function collectValueDomains({ schema, base, resolver, maxDepth = 8, maxDomains = 32 }) {
  const domains = [];
  const seen = new Set();

  function walk(node, nodeBase, pointer, depth) {
    if (depth > maxDepth || domains.length >= maxDomains || node === undefined || node === null) {
      return;
    }
    if (typeof node === 'boolean') {
      return;
    }
    if (!isPlainObject(node)) {
      return;
    }
    const resolved = resolveNode(node, nodeBase, resolver, depth);
    if (resolved.unresolved || !isPlainObject(resolved.schema)) {
      return;
    }
    const schemaNode = resolved.schema;
    const identity = `${pointer}\u0000${canonicalStringify(schemaNode)}`;
    if (seen.has(identity)) {
      return;
    }
    seen.add(identity);

    if (Array.isArray(schemaNode.enum) && schemaNode.enum.length > 0) {
      domains.push({ pointer, values: schemaNode.enum.map(deepClone) });
    } else if ('const' in schemaNode) {
      domains.push({ pointer, values: [deepClone(schemaNode.const)] });
    }

    if (isPlainObject(schemaNode.properties)) {
      for (const property of Object.keys(schemaNode.properties).sort()) {
        walk(
          schemaNode.properties[property],
          resolved.base,
          `${pointer}/${escapeJsonPointerSegment(property)}`,
          depth + 1,
        );
      }
    }
    if (schemaNode.items !== undefined) {
      walk(schemaNode.items, resolved.base, `${pointer}/0`, depth + 1);
    }
    if (Array.isArray(schemaNode.prefixItems)) {
      for (let index = 0; index < schemaNode.prefixItems.length; index += 1) {
        walk(schemaNode.prefixItems[index], resolved.base, `${pointer}/${index}`, depth + 1);
      }
    }
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
      if (!Array.isArray(schemaNode[key])) {
        continue;
      }
      for (const branch of schemaNode[key]) {
        walk(branch, resolved.base, pointer, depth + 1);
      }
    }
  }

  walk(schema, base, '', 0);
  return domains.sort((left, right) => left.pointer.localeCompare(right.pointer)).slice(0, maxDomains);
}

function collectPointers(instance, pointer, out, maxNodes) {
  if (out.length >= maxNodes) {
    return;
  }
  out.push({ pointer, value: instance });
  if (Array.isArray(instance)) {
    for (let index = 0; index < instance.length; index += 1) {
      collectPointers(instance[index], `${pointer}/${index}`, out, maxNodes);
    }
    return;
  }
  if (isPlainObject(instance)) {
    for (const key of Object.keys(instance).sort()) {
      collectPointers(instance[key], `${pointer}/${escapeJsonPointerSegment(key)}`, out, maxNodes);
    }
  }
}

function setAtPointer(root, pointer, value) {
  if (pointer === '') {
    return value;
  }
  const clone = deepClone(root);
  const segments = pointer.slice(1).split('/');
  let current = clone;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (current === null || typeof current !== 'object') {
      return clone;
    }
    const segment = segments[index].replaceAll('~1', '/').replaceAll('~0', '~');
    current = Array.isArray(current) ? current[Number(segment)] : current[segment];
    if (current === undefined || current === null) {
      return clone;
    }
  }
  const last = segments[segments.length - 1].replaceAll('~1', '/').replaceAll('~0', '~');
  if (Array.isArray(current)) {
    current[Number(last)] = value;
  } else if (isPlainObject(current)) {
    current[last] = value;
  }
  return clone;
}

function deleteAtPointer(root, pointer) {
  if (pointer === '') {
    return undefined;
  }
  const clone = deepClone(root);
  const segments = pointer.slice(1).split('/');
  let current = clone;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (current === null || typeof current !== 'object') {
      return clone;
    }
    const segment = segments[index].replaceAll('~1', '/').replaceAll('~0', '~');
    current = Array.isArray(current) ? current[Number(segment)] : current[segment];
    if (current === undefined || current === null) {
      return clone;
    }
  }
  const last = segments[segments.length - 1].replaceAll('~1', '/').replaceAll('~0', '~');
  if (Array.isArray(current)) {
    current.splice(Number(last), 1);
  } else if (isPlainObject(current)) {
    delete current[last];
  }
  return clone;
}

/**
 * Derive a deterministic, bounded family of mutants from a seed instance.
 *
 * Mutations are emitted in a fixed order: property deletions, unexpected-property injections,
 * then typed scalar substitutions. Ordering is stable so receipts stay reproducible.
 *
 * @returns {Array<{ mutation: string, pointer: string, instance: unknown }>}
 */
export function mutateInstance(seed, { limit = 64, maxNodes = 64 } = {}) {
  const mutants = [];
  if (seed === undefined) {
    return mutants;
  }
  const nodes = [];
  collectPointers(seed, '', nodes, maxNodes);

  const push = (mutation, pointer, instance) => {
    if (mutants.length >= limit || instance === undefined) {
      return;
    }
    mutants.push({ mutation, pointer, instance });
  };

  for (const node of nodes) {
    if (!isPlainObject(node.value)) {
      continue;
    }
    for (const key of Object.keys(node.value).sort()) {
      push('delete-property', `${node.pointer}/${escapeJsonPointerSegment(key)}`, deleteAtPointer(seed, `${node.pointer}/${escapeJsonPointerSegment(key)}`));
    }
  }

  for (const node of nodes) {
    if (!isPlainObject(node.value)) {
      continue;
    }
    const injected = setAtPointer(seed, `${node.pointer}/${UNEXPECTED_PROPERTY}`, true);
    push('inject-unexpected-property', `${node.pointer}/${UNEXPECTED_PROPERTY}`, injected);
  }

  // Arrays need explicit length-boundary probes. Scalar substitution can replace an
  // entire array, but it cannot expose a generated tuple that silently accepts one item too few
  // or too many compared with an independently authored minItems/maxItems authority.
  for (const node of nodes) {
    if (!Array.isArray(node.value)) {
      continue;
    }
    if (node.value.length > 0) {
      const shortened = node.value.slice(0, -1).map(deepClone);
      push('shorten-array', node.pointer, setAtPointer(seed, node.pointer, shortened));
    }
    const extended = node.value.map(deepClone);
    extended.push(OUT_OF_DOMAIN_STRING);
    push('extend-array', node.pointer, setAtPointer(seed, node.pointer, extended));
  }

  for (const node of nodes) {
    for (const substitution of SCALAR_SUBSTITUTIONS) {
      if (node.pointer === '' && substitution.label === 'null') {
        // The root null probe is emitted once below with a clearer label.
        continue;
      }
      push(`substitute-${substitution.label}`, node.pointer, setAtPointer(seed, node.pointer, deepClone(substitution.value)));
    }
  }

  push('root-null', '', null);
  return mutants.slice(0, limit);
}

/**
 * Build the full probe corpus for one declaration from a schema in a single lane.
 *
 * @returns {Array<{ id: string, origin: string, mutation: string|null, pointer: string|null, instance: unknown, synthesisComplete: boolean }>}
 */
export function buildProbes({ schema, base, resolver, lane, declaration, maxProbes = 64 }) {
  const probes = [];
  const seenEncodings = new Set();

  const add = (origin, mutation, pointer, instance, synthesisComplete) => {
    if (probes.length >= maxProbes || instance === undefined) {
      return;
    }
    const encoding = canonicalStringify(instance);
    if (seenEncodings.has(encoding)) {
      return;
    }
    seenEncodings.add(encoding);
    probes.push({
      id: `${lane}:${declaration}:${origin}${mutation ? `:${mutation}` : ''}${pointer ? `:${pointer}` : ''}`,
      origin,
      lane,
      declaration,
      mutation: mutation ?? null,
      pointer: pointer ?? null,
      instance,
      synthesisComplete,
    });
  };

  const declared = isPlainObject(schema) && Array.isArray(schema.examples) ? schema.examples : [];
  for (let index = 0; index < declared.length; index += 1) {
    add(`declared-example-${index}`, null, null, declared[index], true);
  }
  if (isPlainObject(schema) && 'default' in schema) {
    add('declared-default', null, null, schema.default, true);
  }

  const full = synthesizeInstance({ schema, base, resolver, mode: 'full' });
  add('synthesized-full', null, null, full.instance, full.complete);
  const minimal = synthesizeInstance({ schema, base, resolver, mode: 'minimal' });
  add('synthesized-minimal', null, null, minimal.instance, minimal.complete);

  // Enumerate closed value domains before mutating. A one-member difference between two enums is
  // invisible to a single synthesized representative, so every declared member is probed.
  for (const domain of collectValueDomains({ schema, base, resolver })) {
    for (let index = 0; index < domain.values.length; index += 1) {
      const instance = domain.pointer === ''
        ? deepClone(domain.values[index])
        : setAtPointer(full.instance, domain.pointer, deepClone(domain.values[index]));
      add('domain-member', `${domain.pointer || '#'}[${index}]`, domain.pointer || '#', instance, full.complete);
    }
  }

  const seeds = [full.instance, minimal.instance].filter((value) => value !== undefined);
  const perSeed = Math.max(1, Math.floor((maxProbes - probes.length) / Math.max(1, seeds.length)));
  for (const seed of seeds) {
    for (const mutant of mutateInstance(seed, { limit: perSeed })) {
      add('mutant', mutant.mutation, mutant.pointer, mutant.instance, full.complete);
    }
  }

  return probes;
}
