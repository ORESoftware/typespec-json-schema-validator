import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOUNDARY_PACKAGE_EXPORTS,
  BOUNDARY_RELEASE_PREFLIGHT_SCHEMA,
  REQUIRED_BOUNDARY_PACK_PATHS,
  validateBoundaryPackageContract,
} from '../../scripts/release-language-boundary-preflight.mjs';

function packageJson(overrides = {}) {
  return {
    name: '@oresoftware/typespec-json-schema-validator',
    version: '0.1.0',
    exports: {
      ...BOUNDARY_PACKAGE_EXPORTS,
    },
    ...overrides,
  };
}

function packOutput(paths = REQUIRED_BOUNDARY_PACK_PATHS) {
  return [{
    name: '@oresoftware/typespec-json-schema-validator',
    version: '0.1.0',
    filename: 'oresoftware-typespec-json-schema-validator-0.1.0.tgz',
    files: paths.map((path) => ({ path })),
  }];
}

test('language-boundary release contract is versioned and complete', () => {
  assert.equal(
    BOUNDARY_RELEASE_PREFLIGHT_SCHEMA,
    'ores.tjsv-language-boundary-release-preflight/v1',
  );
  assert.deepEqual(REQUIRED_BOUNDARY_PACK_PATHS, [
    'schema/language-boundaries.schema.json',
    'schema/language-boundary-evidence.schema.json',
    'schema/language-boundary-verification.schema.json',
    'src/language-boundary-verification.d.mts',
    'src/language-boundary-verification.mjs',
  ]);
});

test('valid public boundary exports and packed files are admitted', () => {
  const result = validateBoundaryPackageContract(packageJson(), packOutput());
  assert.equal(result.name, '@oresoftware/typespec-json-schema-validator');
  assert.equal(result.version, '0.1.0');
  assert.equal(result.filename, 'oresoftware-typespec-json-schema-validator-0.1.0.tgz');
  assert.ok(Object.isFrozen(result));
});

test('boundary verifier import target drift fails closed', () => {
  assert.throws(
    () => validateBoundaryPackageContract(packageJson({
      exports: {
        ...BOUNDARY_PACKAGE_EXPORTS,
        './language-boundary-verification': {
          import: './src/other.mjs',
          types: './src/language-boundary-verification.d.mts',
        },
      },
    }), packOutput()),
    /boundary package export is missing or changed/u,
  );
});

test('missing boundary schema or verifier artifact fails closed', () => {
  for (const missing of REQUIRED_BOUNDARY_PACK_PATHS) {
    const paths = REQUIRED_BOUNDARY_PACK_PATHS.filter((path) => path !== missing);
    assert.throws(
      () => validateBoundaryPackageContract(packageJson(), packOutput(paths)),
      /required language-boundary release file is absent/u,
      missing,
    );
  }
});

test('duplicate package paths and package identity drift fail closed', () => {
  const duplicated = [...REQUIRED_BOUNDARY_PACK_PATHS, REQUIRED_BOUNDARY_PACK_PATHS[0]];
  assert.throws(
    () => validateBoundaryPackageContract(packageJson(), packOutput(duplicated)),
    /duplicate file path/u,
  );

  const wrongIdentity = packOutput();
  wrongIdentity[0].name = '@oresoftware/not-tjsv';
  assert.throws(
    () => validateBoundaryPackageContract(packageJson(), wrongIdentity),
    /identity does not match/u,
  );
});
