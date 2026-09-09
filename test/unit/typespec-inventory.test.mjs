import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  inventoryTypeSpec,
  inventoryTypeSpecSource,
  lexTypeSpec,
} from '../../src/typespec-inventory.mjs';

test('lexer ignores declaration-looking text inside comments and strings', () => {
  const source = `
    // model Fake { value: string; }
    /* enum AlsoFake { nope } */
    const text = "union StillFake { x: string }";
    namespace Demo;
    model Real { value: string; }
  `;
  const inventory = inventoryTypeSpecSource(source, 'main.tsp');
  assert.deepEqual(inventory.declarations.map((item) => item.qualifiedName), ['Demo.Real']);
  assert.deepEqual(inventory.errors, []);
});

test('inventory separates JSON-Schema data declarations from operations', () => {
  const source = `
    namespace Demo {
      scalar Identifier extends string;
      alias Label = string;
      enum State { ready }
      union Value { text: string, count: int32 }
      model Item { id: Identifier; }
      interface Api { op get(): Item; }
    }
  `;
  const inventory = inventoryTypeSpecSource(source, 'main.tsp');
  assert.deepEqual(
    inventory.declarations.map((item) => [item.kind, item.qualifiedName]),
    [
      ['scalar', 'Demo.Identifier'],
      ['alias', 'Demo.Label'],
      ['enum', 'Demo.State'],
      ['union', 'Demo.Value'],
      ['model', 'Demo.Item'],
    ],
  );
  assert.deepEqual(inventory.outOfScopeDeclarations.map((item) => item.qualifiedName), ['Demo.Api']);
});

test('qualified nested namespaces preserve absolute identity while relative namespaces extend the parent', () => {
  const source = `
    namespace Demo {
      model OuterModel {}
      namespace Demo.Inner {
        model WeatherReading {}
      }
      namespace Relative {
        model LocalReading {}
      }
    }
  `;
  const inventory = inventoryTypeSpecSource(source, 'nested.tsp');
  assert.deepEqual(inventory.errors, []);
  assert.deepEqual(
    inventory.declarations.map((item) => item.qualifiedName),
    ['Demo.OuterModel', 'Demo.Inner.WeatherReading', 'Demo.Relative.LocalReading'],
  );
});

test('file inventory follows local imports but excludes package imports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-inventory-'));
  await writeFile(
    join(root, 'main.tsp'),
    'import "./models.tsp"; import "@typespec/json-schema"; namespace Demo; model Root { child: Child; }\n',
  );
  await writeFile(join(root, 'models.tsp'), 'namespace Demo; model Child { id: string; }\n');
  const inventory = await inventoryTypeSpec(join(root, 'main.tsp'));
  assert.deepEqual(inventory.declarations.map((item) => item.qualifiedName), ['Demo.Child', 'Demo.Root']);
  assert.equal(inventory.files.length, 2);
});

test('ambiguous simple names across namespaces stop safe identity inference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tsjsv-ambiguous-'));
  await writeFile(join(root, 'main.tsp'), 'namespace A { model User {} } namespace B { model User {} }\n');
  const inventory = await inventoryTypeSpec(root);
  assert.equal(inventory.ambiguities.length, 1);
  assert.deepEqual(inventory.ambiguities[0].qualifiedNames, ['A.User', 'B.User']);
});

test('unbalanced TypeSpec blocks are reported rather than inferred away', () => {
  const inventory = inventoryTypeSpecSource('namespace Demo { model User { id: string; }', 'broken.tsp');
  assert.ok(inventory.errors.some((item) => item.code === 'unclosed-brace'));
});

test('lexer reports unterminated block comments', () => {
  const lexed = lexTypeSpec('model User {} /* no end', 'broken.tsp');
  assert.ok(lexed.errors.some((item) => item.code === 'unterminated-block-comment'));
});
