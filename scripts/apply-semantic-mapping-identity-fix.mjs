import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`missing patch anchor: ${label}`);
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`ambiguous patch anchor: ${label}`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

const sourcePath = 'src/run.mjs';
let source = await readFile(sourcePath, 'utf8');
source = replaceOnce(
  source,
  `function buildRunId(material) {\n  return sha256(canonicalStringify(material));\n}`,
  `export function semanticMappingDigest(mapping) {\n  return sha256(canonicalStringify({\n    schema: mapping.schema,\n    declarations: mapping.declarations,\n    ignore: mapping.ignore,\n  }));\n}\n\nfunction buildRunId(material) {\n  return sha256(canonicalStringify(material));\n}`,
  'mapping digest helper',
);
source = replaceOnce(
  source,
  `    mappingSchema: mapping.schema,\n    differential: {`,
  `    mappingSchema: mapping.schema,\n    mappingDigest: semanticMappingDigest(mapping),\n    differential: {`,
  'mapping digest configuration',
);
await writeFile(sourcePath, source);

const testPath = 'test/unit/run-id-host-path.test.mjs';
let test = await readFile(testPath, 'utf8');
test = replaceOnce(
  test,
  `  runIdentityConfiguration,\n  runIdentityToolchain,`,
  `  runIdentityConfiguration,\n  runIdentityToolchain,\n  semanticMappingDigest,`,
  'mapping digest import',
);
test += `\n\ntest('run identity binds semantic mapping content but not mapping source location', () => {\n  const base = {\n    schema: 'ores.typespec-json-schema-validator.mapping/v1',\n    declarations: [{ typespec: 'Example.User', generated: 'User', authored: 'User' }],\n    ignore: { typespec: [], generated: [], authored: [] },\n    source: '/home/runner/work/contracts/tjsv.mapping.json',\n  };\n  const relocated = { ...structuredClone(base), source: '/Users/runner/work/contracts/tjsv.mapping.json' };\n  assert.equal(semanticMappingDigest(base), semanticMappingDigest(relocated));\n\n  const remapped = structuredClone(base);\n  remapped.declarations[0].authored = 'PublicUser';\n  assert.notEqual(semanticMappingDigest(base), semanticMappingDigest(remapped));\n\n  const ignored = structuredClone(base);\n  ignored.ignore.authored.push('LegacyUser');\n  assert.notEqual(semanticMappingDigest(base), semanticMappingDigest(ignored));\n\n  const left = identityConfiguration('/tmp/a', '/tmp/corpus-a');\n  const right = identityConfiguration('/tmp/b', '/tmp/corpus-b');\n  left.mappingDigest = semanticMappingDigest(base);\n  right.mappingDigest = semanticMappingDigest(remapped);\n  assert.notDeepEqual(\n    runIdentityConfiguration(left),\n    runIdentityConfiguration(right),\n    'semantic mapping changes must perturb run identity material',\n  );\n});\n`;
await writeFile(testPath, test);
