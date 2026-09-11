import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compile, getNamespaceFullName, NodeHost } from '@typespec/compiler';
import { inventoryTypeSpecSource } from '../../src/typespec-inventory.mjs';

function diagnosticText(diagnostics) {
  return diagnostics
    .map((diagnostic) => `${diagnostic.code}: ${String(diagnostic.message)}`)
    .join('\n');
}

async function compileSource(source, filename) {
  const root = await mkdtemp(join(tmpdir(), 'tjsv-namespace-parity-'));
  const entry = join(root, filename);
  await writeFile(entry, source);
  const program = await compile(NodeHost, entry, {
    noEmit: true,
    warningAsError: true,
  });
  assert.equal(program.hasError(), false, diagnosticText(program.diagnostics));
  return program;
}

function requireModel(program, reference) {
  const [type, diagnostics] = program.resolveTypeReference(reference);
  assert.deepEqual(diagnostics, [], diagnosticText(diagnostics));
  assert.ok(type, `${reference} must resolve`);
  assert.equal(type.kind, 'Model', `${reference} must resolve to a model`);
  const separator = reference.lastIndexOf('.');
  assert.equal(type.name, reference.slice(separator + 1));
  assert.ok(type.namespace, `${reference} must retain a namespace`);
  assert.equal(getNamespaceFullName(type.namespace), reference.slice(0, separator));
}

function requireNamespace(program, reference) {
  const [type, diagnostics] = program.resolveTypeReference(reference);
  assert.deepEqual(diagnostics, [], diagnosticText(diagnostics));
  assert.ok(type, `${reference} must resolve`);
  assert.equal(type.kind, 'Namespace', `${reference} must resolve to a namespace`);
  assert.equal(getNamespaceFullName(type), reference);
}

function requireAbsent(program, reference) {
  const [type, diagnostics] = program.resolveTypeReference(reference);
  assert.equal(type, undefined, `${reference} must not resolve`);
  assert.ok(diagnostics.length > 0, `${reference} must report an unresolved reference`);
}

test('official compiler and inventory agree on lexical dotted namespace composition', async () => {
  const source = `
    namespace Demo {
      model OuterModel {}
      namespace Demo.Inner {
        model WeatherReading {}
        namespace Demo.Inner.Deep {
          model FullyQualifiedDeep {}
        }
        namespace Innerish {
          model RelativeDeep {}
        }
      }
      namespace Demo2 {
        model PrefixCollision {}
      }
      namespace Relative {
        model LocalReading {}
      }
    }
    namespace Same { model Same {} }
  `;

  const inventory = inventoryTypeSpecSource(source, 'compiler-parity.tsp');
  assert.deepEqual(inventory.errors, []);
  assert.deepEqual(
    inventory.declarations.map((item) => item.qualifiedName),
    [
      'Demo.OuterModel',
      'Demo.Demo.Inner.WeatherReading',
      'Demo.Demo.Inner.Demo.Inner.Deep.FullyQualifiedDeep',
      'Demo.Demo.Inner.Innerish.RelativeDeep',
      'Demo.Demo2.PrefixCollision',
      'Demo.Relative.LocalReading',
      'Same.Same',
    ],
  );

  const program = await compileSource(source, 'compiler-parity.tsp');
  for (const reference of inventory.declarations.map((item) => item.qualifiedName)) {
    requireModel(program, reference);
  }
  requireNamespace(program, 'Same');
  for (const oldAbsoluteReference of [
    'Demo.Inner.WeatherReading',
    'Demo.Inner.Deep.FullyQualifiedDeep',
    'Demo.Inner.Innerish.RelativeDeep',
  ]) {
    requireAbsent(program, oldAbsoluteReference);
  }
});

test('file-level namespace keeps later dotted namespace lexical', async () => {
  const source = 'namespace Root.Space; namespace Root.Space.Area { model Item {} }';
  const inventory = inventoryTypeSpecSource(source, 'blockless-parity.tsp');
  assert.deepEqual(inventory.errors, []);
  assert.deepEqual(
    inventory.declarations.map((item) => item.qualifiedName),
    ['Root.Space.Root.Space.Area.Item'],
  );

  const program = await compileSource(source, 'blockless-parity.tsp');
  requireModel(program, 'Root.Space.Root.Space.Area.Item');
  requireAbsent(program, 'Root.Space.Area.Item');
});
