from pathlib import Path

witness = Path('src/witness.mjs')
text = witness.read_text()

old = """function buildString(schema) {
  const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
  const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : Number.POSITIVE_INFINITY;
  const seed = 'tsjsv';
  let value = seed.length >= minLength ? seed : seed.padEnd(minLength, 'x');
  if (value.length > maxLength) {
    value = value.slice(0, Math.max(0, maxLength));
  }
  return value;
}
"""
new = r"""function representativeCharacterFromClass(source) {
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
"""
assert text.count(old) == 1, 'expected one buildString implementation'
text = text.replace(old, new, 1)

old_case = """        case 'string':
          if (typeof schemaNode.pattern === 'string') {
            complete = false;
          }
          return buildString(schemaNode);
"""
new_case = """        case 'string': {
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
"""
assert text.count(old_case) == 1, 'expected one string synthesis case'
witness.write_text(text.replace(old_case, new_case, 1))

Path('test/unit/witness-pattern-synthesis.test.mjs').write_text("""import assert from 'node:assert/strict';
import test from 'node:test';
import { SchemaResolver, validateInstance } from '../../src/instance-validator.mjs';
import { synthesizeInstance } from '../../src/witness.mjs';

const schema = {
  type: 'object',
  required: ['service', 'contractSha256'],
  properties: {
    service: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '^[A-Za-z][A-Za-z0-9._-]*$',
    },
    contractSha256: {
      type: 'string',
      pattern: '^[0-9a-f]{64}$',
    },
  },
  unevaluatedProperties: false,
};

test('common anchored character-class patterns synthesize valid deterministic witnesses', () => {
  const resolver = new SchemaResolver();
  const record = resolver.addDocument(schema, 'pattern-witness.json');
  const synthesized = synthesizeInstance({
    schema,
    base: record.base,
    resolver,
    mode: 'full',
  });
  assert.equal(synthesized.complete, true);
  assert.match(synthesized.instance.service, /^[A-Za-z][A-Za-z0-9._-]*$/u);
  assert.match(synthesized.instance.contractSha256, /^[0-9a-f]{64}$/u);
  assert.equal(synthesized.instance.contractSha256, '0'.repeat(64));
  const verdict = validateInstance({
    schema,
    instance: synthesized.instance,
    resolver,
    base: record.base,
  });
  assert.equal(verdict.valid, true, JSON.stringify(verdict.errors));
});
""")
