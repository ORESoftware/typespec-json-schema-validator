import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalStringify } from '../../src/canonical.mjs';
import { compareParity, loadMapping, MAPPING_SCHEMA } from '../../src/parity.mjs';

const schema = Object.freeze({
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
  unevaluatedProperties: false,
});

function typeSpecDeclaration(qualifiedName) {
  const pieces = qualifiedName.split('.');
  return {
    kind: 'model',
    name: pieces.at(-1),
    qualifiedName,
  };
}

function collection(names) {
  return {
    findings: [],
    declarations: names.map((name) => ({
      name,
      kind: 'model',
      schema,
      pointer: `#/$defs/${name}`,
    })),
  };
}

function mapping(overrides = {}) {
  return {
    schema: MAPPING_SCHEMA,
    declarations: [],
    ignore: { typespec: [], generated: [], authored: [] },
    ...overrides,
  };
}

function compare({
  declarations = [typeSpecDeclaration('Example.User')],
  generated = ['User'],
  authored = ['User'],
  mapping: mappingValue = mapping(),
  ambiguities = [],
  maxFindings = 250,
} = {}) {
  return compareParity({
    typespecInventory: {
      declarations,
      errors: [],
      ambiguities,
    },
    generatedCollection: collection(generated),
    authoredCollection: collection(authored),
    mapping: mappingValue,
    maxFindings,
  });
}

function ruleIds(result) {
  return new Set(result.findings.map((finding) => finding.ruleId));
}

async function writeMapping(value) {
  const directory = await mkdtemp(join(tmpdir(), 'tsjsv-mapping-integrity-'));
  const path = join(directory, 'mapping.json');
  const rendered = typeof value === 'string' ? value : JSON.stringify(value);
  await writeFile(path, rendered, 'utf8');
  return path;
}

test('default empty mapping remains a valid peer-authority configuration', async () => {
  assert.deepEqual(await loadMapping(), mapping());
  assert.equal(compare().findingCount, 0);
});

test('a unique simple TypeSpec mapping name remains supported', () => {
  const result = compare({
    generated: ['GeneratedUser'],
    authored: ['AccountUser'],
    mapping: mapping({
      declarations: [
        { typespec: 'User', generated: 'GeneratedUser', authored: 'AccountUser' },
      ],
    }),
  });
  assert.equal(result.findingCount, 0);
});

test('a qualified mapping resolves declarations with the same simple name', () => {
  const result = compare({
    declarations: [
      typeSpecDeclaration('Accounts.User'),
      typeSpecDeclaration('Administration.User'),
    ],
    generated: ['AccountsUser', 'AdministrationUser'],
    authored: ['Account', 'Administrator'],
    mapping: mapping({
      declarations: [
        { typespec: 'Accounts.User', generated: 'AccountsUser', authored: 'Account' },
        {
          typespec: 'Administration.User',
          generated: 'AdministrationUser',
          authored: 'Administrator',
        },
      ],
    }),
  });
  assert.equal(result.findingCount, 0);
});

test('a stale TypeSpec mapping entry stops evaluation', () => {
  const result = compare({
    mapping: mapping({ declarations: [{ typespec: 'Example.Ghost' }] }),
  });
  assert.ok(ruleIds(result).has('mapping-typespec-declaration-missing'));
});

test('an ambiguous simple TypeSpec mapping name stops evaluation', () => {
  const result = compare({
    declarations: [
      typeSpecDeclaration('Accounts.User'),
      typeSpecDeclaration('Administration.User'),
    ],
    mapping: mapping({ declarations: [{ typespec: 'User' }] }),
  });
  assert.ok(ruleIds(result).has('mapping-typespec-simple-name-ambiguous'));
});

test('a stale TypeSpec ignore entry cannot hide declaration drift', () => {
  const result = compare({
    mapping: mapping({
      ignore: { typespec: ['Example.Ghost'], generated: [], authored: [] },
    }),
  });
  assert.ok(ruleIds(result).has('mapping-ignore-typespec-stale'));
});

test('an ambiguous simple TypeSpec ignore entry must be qualified', () => {
  const result = compare({
    declarations: [
      typeSpecDeclaration('Accounts.User'),
      typeSpecDeclaration('Administration.User'),
    ],
    mapping: mapping({
      ignore: { typespec: ['User'], generated: [], authored: [] },
    }),
  });
  assert.ok(ruleIds(result).has('mapping-ignore-typespec-ambiguous'));
});

test('stale generated and authored ignore entries are reported independently', () => {
  const result = compare({
    mapping: mapping({
      ignore: { typespec: [], generated: ['GhostA'], authored: ['GhostB'] },
    }),
  });
  assert.ok(ruleIds(result).has('mapping-ignore-generated-stale'));
  assert.ok(ruleIds(result).has('mapping-ignore-authored-stale'));
});

test('a TypeSpec declaration cannot be both mapped and ignored', () => {
  const result = compare({
    mapping: mapping({
      declarations: [{ typespec: 'Example.User' }],
      ignore: { typespec: ['Example.User'], generated: [], authored: [] },
    }),
  });
  assert.ok(ruleIds(result).has('mapping-typespec-ignore-conflict'));
});

test('generated and authored mapping targets cannot also be ignored', () => {
  const result = compare({
    mapping: mapping({
      declarations: [
        { typespec: 'Example.User', generated: 'GeneratedUser', authored: 'AccountUser' },
      ],
      ignore: {
        typespec: [],
        generated: ['GeneratedUser'],
        authored: ['AccountUser'],
      },
    }),
    generated: ['GeneratedUser'],
    authored: ['AccountUser'],
  });
  assert.ok(ruleIds(result).has('mapping-generated-ignore-conflict'));
  assert.ok(ruleIds(result).has('mapping-authored-ignore-conflict'));
});

test('programmatic duplicate TypeSpec mappings produce a finding', () => {
  const result = compare({
    mapping: mapping({
      declarations: [
        { typespec: 'Example.User' },
        { typespec: 'Example.User', authored: 'AccountUser' },
      ],
    }),
  });
  assert.ok(ruleIds(result).has('mapping-typespec-duplicate'));
});

test('programmatic duplicate ignore entries produce a finding', () => {
  const result = compare({
    mapping: mapping({
      ignore: { typespec: [], generated: ['User', 'User'], authored: [] },
    }),
  });
  assert.ok(ruleIds(result).has('mapping-ignore-duplicate'));
});

test('programmatic empty ignore names produce a finding', () => {
  const result = compare({
    mapping: mapping({
      ignore: { typespec: [''], generated: [], authored: [] },
    }),
  });
  assert.ok(ruleIds(result).has('mapping-ignore-invalid-name'));
});

test('mapping integrity findings remain byte-stable across runs', () => {
  const options = {
    mapping: mapping({
      declarations: [{ typespec: 'Example.Ghost' }],
      ignore: { typespec: [], generated: ['Ghost'], authored: [] },
    }),
  };
  assert.equal(canonicalStringify(compare(options)), canonicalStringify(compare(options)));
});

test('mapping integrity findings participate in max-findings truncation', () => {
  const result = compare({
    mapping: mapping({
      declarations: [
        { typespec: 'Example.GhostA' },
        { typespec: 'Example.GhostB' },
      ],
    }),
    maxFindings: 1,
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.truncated, true);
  assert.ok(result.findingCount > result.findings.length);
});

test('loadMapping rejects unknown root properties from the closed mapping schema', async () => {
  const path = await writeMapping({
    schema: MAPPING_SCHEMA,
    declarations: [],
    surprise: true,
  });
  await assert.rejects(() => loadMapping(path), /contains unknown properties: surprise/u);
});

test('loadMapping rejects unknown declaration properties', async () => {
  const path = await writeMapping({
    schema: MAPPING_SCHEMA,
    declarations: [{ typespec: 'Example.User', typo: 'User' }],
  });
  await assert.rejects(
    () => loadMapping(path),
    /mapping declaration 0 contains unknown properties: typo/u,
  );
});

test('loadMapping rejects unknown ignore properties', async () => {
  const path = await writeMapping({
    schema: MAPPING_SCHEMA,
    declarations: [],
    ignore: { generatedSchema: ['User'] },
  });
  await assert.rejects(
    () => loadMapping(path),
    /mapping ignore contains unknown properties: generatedSchema/u,
  );
});

test('loadMapping rejects duplicate TypeSpec mapping entries', async () => {
  const path = await writeMapping({
    schema: MAPPING_SCHEMA,
    declarations: [
      { typespec: 'Example.User' },
      { typespec: 'Example.User', authored: 'AccountUser' },
    ],
  });
  await assert.rejects(
    () => loadMapping(path),
    /mapping declarations must not repeat TypeSpec name Example\.User/u,
  );
});

test('loadMapping rejects duplicate ignore names', async () => {
  const path = await writeMapping({
    schema: MAPPING_SCHEMA,
    declarations: [],
    ignore: { generated: ['User', 'User'] },
  });
  await assert.rejects(
    () => loadMapping(path),
    /mapping ignore\.generated must not contain duplicate name User/u,
  );
});

test('loadMapping rejects empty and whitespace-padded names', async () => {
  const empty = await writeMapping({
    schema: MAPPING_SCHEMA,
    declarations: [],
    ignore: { authored: [''] },
  });
  await assert.rejects(
    () => loadMapping(empty),
    /mapping ignore\.authored\[0\] must be a non-empty string/u,
  );

  const padded = await writeMapping({
    schema: MAPPING_SCHEMA,
    declarations: [{ typespec: ' Example.User' }],
  });
  await assert.rejects(
    () => loadMapping(padded),
    /must not contain leading or trailing whitespace/u,
  );
});

test('loadMapping rejects non-object roots and ignore values', async () => {
  const rootArray = await writeMapping([]);
  await assert.rejects(() => loadMapping(rootArray), /must contain a JSON object/u);

  const ignoreArray = await writeMapping({
    schema: MAPPING_SCHEMA,
    declarations: [],
    ignore: [],
  });
  await assert.rejects(
    () => loadMapping(ignoreArray),
    /mapping ignore must be an object when present/u,
  );
});

test('loadMapping preserves a normalized valid mapping and records its source', async () => {
  const path = await writeMapping({
    schema: MAPPING_SCHEMA,
    declarations: [
      { typespec: 'Example.User', generated: 'GeneratedUser', authored: 'AccountUser' },
    ],
    ignore: { typespec: [], generated: ['Legacy'], authored: [] },
  });
  const loaded = await loadMapping(path);
  assert.equal(loaded.schema, MAPPING_SCHEMA);
  assert.equal(loaded.source, path);
  assert.deepEqual(loaded.declarations, [
    { typespec: 'Example.User', generated: 'GeneratedUser', authored: 'AccountUser' },
  ]);
  assert.deepEqual(loaded.ignore, {
    typespec: [],
    generated: ['Legacy'],
    authored: [],
  });
});
