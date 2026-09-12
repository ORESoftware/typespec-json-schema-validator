import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compile, NodeHost } from '@typespec/compiler';
import {
  inventoryTypeSpec,
  inventoryTypeSpecSource,
  lexTypeSpec,
} from '../../src/typespec-inventory.mjs';

async function compileTypeSpecSource(source, filename) {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-namespace-compiler-'));
  const entry = join(root, filename);
  await writeFile(entry, source);
  const program = await compile(NodeHost, entry, {
    noEmit: true,
    warningAsError: true,
  });
  assert.equal(
    program.hasError(),
    false,
    program.diagnostics.map((diagnostic) => String(diagnostic.message)).join('\n'),
  );
  return program.getGlobalNamespaceType();
}

function requireNamespace(parent, name, label) {
  const namespace = parent.namespaces.get(name);
  assert.ok(namespace, `official TypeSpec compiler must resolve ${label}`);
  return namespace;
}

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

test('nested compact namespaces compose lexically even when a child repeats the parent prefix', () => {
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
    ['Demo.OuterModel', 'Demo.Demo.Inner.WeatherReading', 'Demo.Relative.LocalReading'],
  );
});

test('nested compact namespace composition stays lexical and segment-aware at multiple depths', () => {
  const source = `
    namespace Demo {
      namespace Demo2 {
        model PrefixCollision {}
      }
      namespace Demo.Inner {
        namespace Demo.Inner.Deep {
          model FullyQualifiedDeep {}
        }
        namespace Innerish {
          model RelativeDeep {}
        }
      }
    }
  `;
  const inventory = inventoryTypeSpecSource(source, 'nested-segments.tsp');
  assert.deepEqual(inventory.errors, []);
  assert.deepEqual(
    inventory.declarations.map((item) => item.qualifiedName),
    [
      'Demo.Demo2.PrefixCollision',
      'Demo.Demo.Inner.Demo.Inner.Deep.FullyQualifiedDeep',
      'Demo.Demo.Inner.Innerish.RelativeDeep',
    ],
  );
});

test('official TypeSpec compiler and TJSV inventory agree on qualified nested namespace identity', async () => {
  const basicSource = `
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
  const basicInventory = inventoryTypeSpecSource(basicSource, 'compiler-basic.tsp');
  const basicGlobal = await compileTypeSpecSource(basicSource, 'compiler-basic.tsp');
  const basicDemo = requireNamespace(basicGlobal, 'Demo', 'Demo');
  const basicInner = requireNamespace(basicDemo, 'Inner', 'Demo.Inner');
  const basicRelative = requireNamespace(basicDemo, 'Relative', 'Demo.Relative');
  assert.ok(basicDemo.models.has('OuterModel'));
  assert.ok(basicInner.models.has('WeatherReading'));
  assert.ok(basicRelative.models.has('LocalReading'));
  assert.equal(basicDemo.namespaces.has('Demo'), false, 'qualified child must not duplicate its parent');
  assert.deepEqual(
    basicInventory.declarations.map((item) => item.qualifiedName),
    ['Demo.OuterModel', 'Demo.Inner.WeatherReading', 'Demo.Relative.LocalReading'],
  );

  const deepSource = `
    namespace Demo {
      namespace Demo2 {
        model PrefixCollision {}
      }
      namespace Demo.Inner {
        namespace Demo.Inner.Deep {
          model FullyQualifiedDeep {}
        }
        namespace Innerish {
          model RelativeDeep {}
        }
      }
    }
  `;
  const deepInventory = inventoryTypeSpecSource(deepSource, 'compiler-deep.tsp');
  const deepGlobal = await compileTypeSpecSource(deepSource, 'compiler-deep.tsp');
  const deepDemo = requireNamespace(deepGlobal, 'Demo', 'Demo');
  const demo2 = requireNamespace(deepDemo, 'Demo2', 'Demo.Demo2');
  const deepInner = requireNamespace(deepDemo, 'Inner', 'Demo.Inner');
  const deep = requireNamespace(deepInner, 'Deep', 'Demo.Inner.Deep');
  const innerish = requireNamespace(deepInner, 'Innerish', 'Demo.Inner.Innerish');
  assert.ok(demo2.models.has('PrefixCollision'));
  assert.ok(deep.models.has('FullyQualifiedDeep'));
  assert.ok(innerish.models.has('RelativeDeep'));
  assert.equal(deepInner.namespaces.has('Demo'), false, 'deep qualified child must not repeat its root');
  assert.deepEqual(
    deepInventory.declarations.map((item) => item.qualifiedName),
    [
      'Demo.Demo2.PrefixCollision',
      'Demo.Inner.Deep.FullyQualifiedDeep',
      'Demo.Inner.Innerish.RelativeDeep',
    ],
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
