import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_PACK_PATHS,
  RELEASE_RECEIPT_SCHEMA,
  assertSafePackPath,
  normalizePackPath,
  packManifestDigest,
  validatePackMetadata,
} from '../../scripts/release-preflight.mjs';

const packageJson = Object.freeze({
  name: '@oresoftware/typespec-json-schema-validator',
  version: '0.1.0',
  publishConfig: { access: 'public' },
  bin: {
    tjsv: './bin/typespec-json-schema-validator.mjs',
    tsjsv: './bin/typespec-json-schema-validator.mjs',
    'typespec-json-schema-validator': './bin/typespec-json-schema-validator.mjs',
  },
});

function fileInventory(extra = []) {
  return [
    ...REQUIRED_PACK_PATHS.map((path, index) => ({
      path,
      size: index + 1,
      mode: path.startsWith('bin/') ? 0o755 : 0o644,
    })),
    ...extra,
  ];
}

function packResult(overrides = {}, extraFiles = []) {
  const files = fileInventory(extraFiles);
  return {
    name: packageJson.name,
    version: packageJson.version,
    filename: 'oresoftware-typespec-json-schema-validator-0.1.0.tgz',
    size: 4096,
    unpackedSize: files.reduce((total, file) => total + file.size, 0),
    shasum: 'a'.repeat(40),
    integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
    files,
    ...overrides,
  };
}

test('release receipt and required package surface are versioned', () => {
  assert.equal(RELEASE_RECEIPT_SCHEMA, 'ores.tjsv-release-preflight/v1');
  assert.ok(REQUIRED_PACK_PATHS.includes('.cli-flags.toml'));
  assert.ok(REQUIRED_PACK_PATHS.includes('src/index.mjs'));
  assert.ok(REQUIRED_PACK_PATHS.includes('schema/contract-ir.schema.json'));
});

test('pack metadata admission returns a deterministic bounded inventory', () => {
  const result = validatePackMetadata(packageJson, [packResult()]);
  assert.equal(result.name, packageJson.name);
  assert.equal(result.version, packageJson.version);
  assert.equal(result.fileCount, REQUIRED_PACK_PATHS.length);
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    result.files.map((entry) => entry.path),
    [...REQUIRED_PACK_PATHS].sort((left, right) => left.localeCompare(right)),
  );
});

test('manifest digest is independent of input order and binds file metadata', () => {
  const files = fileInventory();
  const forward = packManifestDigest(files);
  const reverse = packManifestDigest([...files].reverse());
  assert.equal(forward, reverse);
  assert.notEqual(
    forward,
    packManifestDigest(files.map((file, index) => (
      index === 0 ? { ...file, size: file.size + 1 } : file
    ))),
  );
});

test('package paths are normalized and development or secret files fail closed', () => {
  assert.equal(normalizePackPath('src\\index.mjs'), 'src/index.mjs');
  assert.equal(assertSafePackPath('docs/release.md'), 'docs/release.md');
  for (const path of [
    '../outside',
    '/absolute',
    '.npmrc',
    '.env.production',
    'env/dec/production.env',
    'scripts/release-preflight.mjs',
    'test/unit/example.test.mjs',
    'tmp/receipt.json',
    'certificates/release.pem',
    'credentials.json',
  ]) {
    assert.throws(() => assertSafePackPath(path), Error, path);
  }
});

test('pack admission rejects missing, duplicate, and forbidden inventory entries', () => {
  const missingFiles = fileInventory().filter((entry) => entry.path !== 'src/index.mjs');
  assert.throws(
    () => validatePackMetadata(packageJson, [{
      ...packResult(),
      files: missingFiles,
      unpackedSize: missingFiles.reduce((total, file) => total + file.size, 0),
    }]),
    /required release file is absent/u,
  );

  const duplicate = fileInventory([{ ...fileInventory()[0] }]);
  assert.throws(
    () => validatePackMetadata(packageJson, [{
      ...packResult(),
      files: duplicate,
      unpackedSize: duplicate.reduce((total, file) => total + file.size, 0),
    }]),
    /duplicate file path/u,
  );

  assert.throws(
    () => validatePackMetadata(packageJson, [packResult({}, [{
      path: '.npmrc',
      size: 10,
      mode: 0o600,
    }])]),
    /forbidden package file/u,
  );
});

test('pack admission binds identity, stable version, access policy, and aliases', () => {
  assert.throws(
    () => validatePackMetadata(packageJson, [packResult({ name: '@oresoftware/other' })]),
    /identity does not match/u,
  );
  assert.throws(
    () => validatePackMetadata({ ...packageJson, version: '0.1.0-beta.1' }, [packResult({
      version: '0.1.0-beta.1',
    })]),
    /stable semantic version/u,
  );
  assert.throws(
    () => validatePackMetadata({
      ...packageJson,
      publishConfig: { access: 'restricted' },
    }, [packResult()]),
    /publishConfig.access/u,
  );
  assert.throws(
    () => validatePackMetadata({
      ...packageJson,
      bin: { ...packageJson.bin, tsjsv: './bin/other.mjs' },
    }, [packResult()]),
    /canonical executable/u,
  );
});

test('pack admission refuses ambiguous and internally inconsistent npm output', () => {
  assert.throws(
    () => validatePackMetadata(packageJson, []),
    /exactly one package result/u,
  );
  assert.throws(
    () => validatePackMetadata(packageJson, [packResult(), packResult()]),
    /exactly one package result/u,
  );
  assert.throws(
    () => validatePackMetadata(packageJson, [packResult({ unpackedSize: 1 })]),
    /disagrees with file inventory/u,
  );
  assert.throws(
    () => validatePackMetadata(packageJson, [packResult({ shasum: 'not-a-digest' })]),
    /valid SHA-1/u,
  );
  assert.throws(
    () => validatePackMetadata(packageJson, [packResult({ integrity: 'sha256-nope' })]),
    /valid SHA-512/u,
  );
});
