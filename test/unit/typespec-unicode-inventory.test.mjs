import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from '@typespec/compiler/ast';
import {
  inventoryTypeSpecSource,
  lexTypeSpec,
} from '../../src/typespec-inventory.mjs';

const unicodeSource = `
  namespace Café.😁Yay {
    model 数据 {
      id: string;
    }

    scalar कर्म extends string;
    enum Hi✋There { ready }
    union deaf\u200cly { yes: true, no: false }
    alias क्‍ष = string;
  }
`;

test('inventory accepts the same international and emoji identifiers as the TypeSpec parser', () => {
  const script = parse(unicodeSource);
  assert.deepEqual(
    script.parseDiagnostics,
    [],
    'the official TypeSpec parser must accept the conformance source',
  );

  const inventory = inventoryTypeSpecSource(unicodeSource, 'unicode.tsp');
  assert.deepEqual(inventory.errors, []);
  assert.deepEqual(
    inventory.declarations.map((item) => [item.kind, item.qualifiedName]),
    [
      ['model', 'Café.😁Yay.数据'],
      ['scalar', 'Café.😁Yay.कर्म'],
      ['enum', 'Café.😁Yay.Hi✋There'],
      ['union', 'Café.😁Yay.deaf\u200cly'],
      ['alias', 'Café.😁Yay.क्‍ष'],
    ],
  );
});

test('assigned non-ASCII code points follow the TypeSpec stable-identifier profile', () => {
  const source = 'model A\u00a0B {}';
  const script = parse(source);
  assert.deepEqual(script.parseDiagnostics, []);
  const inventory = inventoryTypeSpecSource(source);
  assert.deepEqual(inventory.declarations.map((item) => item.name), ['A\u00a0B']);
});

test('replacement characters remain invalid identifiers in both lanes', () => {
  const source = 'model \ufffdBroken {}';
  assert.ok(parse(source).parseDiagnostics.length > 0);
  const inventory = inventoryTypeSpecSource(source, 'replacement.tsp');
  assert.ok(inventory.errors.some((item) => item.code === 'declaration-name-missing'));
  assert.equal(inventory.declarations.length, 0);
});

test('the lexer emits a single ellipsis token for model and tuple spreads', () => {
  const tokens = lexTypeSpec('model Child { ...Base; value: [...Pair] }').tokens;
  const spreads = tokens.filter((token) => token.value === '...');
  assert.equal(spreads.length, 2);
  assert.ok(spreads.every((token) => token.kind === 'punctuation'));
});
