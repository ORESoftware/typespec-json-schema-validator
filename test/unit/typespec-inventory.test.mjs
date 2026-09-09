import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compile, getNamespaceFullName, NodeHost } from '@typespec/compiler';
import {
  inventoryTypeSpec,
  inventoryTypeSpecSource,
  lexTypeSpec,
} from '../../src/typespec-inventory.mjs';

function diagnosticText(diagnostics) {
  return diagnostics
    .map((diagnostic) => `${diagnostic.code}: ${String(diagnostic.message)}`)
    .join('\n');
}

async function compileTypeSpecSource(source, filename) {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-namespace-compiler-'));
  const entry = join(root, filename);
  await writeFile(entry, source);
  const program = await compile(NodeHost, entry, {
    noEmit: true,
    warningAsError: true,
  });
  assert.equal(program.hasError(), false, diagnosticText(program.diagnostics));
  return program;
}

function requireCompilerModel(program, reference) {
  const [type, diagnostics] = program.resolveTypeReference(reference);
  assert.deepEqual(diagnostics, [], diagnosticText(diagnostics));
  assert.ok(type, `official TypeSpec compiler must resolve ${reference}`);
  assert.equal(type.kind, 'Model', `${reference} must resolve to a model`);

  const separator = reference.lastIndexOf('.');
  const expectedNamespace = reference.slice(0, separator);
  const expectedName = reference.slice(separator + 1);
  assert.equal(type.name, expectedName);
  assert.ok(type.namespace, `${reference} must retain a namespace`);
  assert.equal(getNamespaceFullName(type.namespace), expectedNamespace);
  return type;
}

function requireCompilerReferenceAbsent(program, reference) {
  const [type, diagnostics] = program.resolveTypeReference(reference);
  assert.equal(type, undefined, `${reference} must not resolve in the official compiler`);
  assert.ok(diagnostics.length > 0, `${reference} must produce an unresolved-reference diagnostic`);
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

test('qualified nested namespace detection is segment-aware and stable at multiple depths', () => {
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
      'Demo.Inner.Deep.FullyQualifiedDeep',
      'Demo.Inner.Innerish.RelativeDeep',
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

  const basicInventory = inventoryTypeSpecSource(basicSource, 'compiler-basic.tsp');
  const deepInventory = inventoryTypeSpecSource(deepSource, 'compiler-deep.tsp');

  // One official compiler program is enough to independently resolve both fixtures.
  // Keeping the oracle in one compilation also prevents this focused regression from
  // doubling compiler startup/memory cost under the macOS node:test worker budget.
  const compilerProgram = await compileTypeSpecSource(
    `${basicSource}\n${deepSource}`,
    'compiler-namespace-lockstep.tsp',
  );

  for (const reference of [
    'Demo.OuterModel',
    'Demo.Inner.WeatherReading',
    'Demo.Relative.LocalReading',
    'Demo.Demo2.PrefixCollision',
    'Demo.Inner.Deep.FullyQualifiedDeep',
    'Demo.Inner.Innerish.RelativeDeep',
  ]) {
    requireCompilerModel(compilerProgram, reference);
  }

  for (const reference of [
    'Demo.Demo.Inner.WeatherReading',
    'Demo.Demo.Relative.LocalReading',
    'Demo2.PrefixCollision',
    'Demo.Inner.Demo.Inner.Deep.FullyQualifiedDeep',
    'Demo.Innerish.RelativeDeep',
  ]) {
    requireCompilerReferenceAbsent(compilerProgram, reference);
  }

  assert.deepEqual(
    basicInventory.declarations.map((item) => item.qualifiedName),
    ['Demo.OuterModel', 'Demo.Inner.WeatherReading', 'Demo.Relative.LocalReading'],
  );
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
