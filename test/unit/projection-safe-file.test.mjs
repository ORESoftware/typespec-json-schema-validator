import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileLimit, readProjectionFile } from '../../src/projection-admission/safe-file.mjs';
import { hashProjectionFiles, loadProjectionManifest } from '../../src/projection-admission/io.mjs';

async function fixture(t) {
  // Canonicalize only our fixture: macOS temp paths can start with /var -> /private/var.
  // The production reader must still reject symlinks supplied as evidence paths.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tsjsv-safe-file-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'nested'));
  const file = join(root, 'nested/evidence.json');
  await writeFile(file, '{"value":"é"}');
  return { root, file };
}

for (const value of [NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '32', null, undefined, {}, []]) {
  test(`rejects invalid limit ${String(value)}`, async () => {
    assert.throws(() => fileLimit(value, 'budget'), /non-negative safe integer/);
    await assert.rejects(readProjectionFile('/not-read', value), /non-negative safe integer/);
  });
}

test('reads exact raw bytes at the inclusive limit and leaves the file untouched', async (t) => {
  const { file } = await fixture(t);
  const expected = await readFile(file);
  assert.deepEqual(await readProjectionFile(file, expected.length), expected);
  assert.deepEqual(await readFile(file), expected);
  await assert.rejects(readProjectionFile(file, expected.length - 1), /byte limit/);
});

test('zero byte budget permits only empty files', async (t) => {
  const { file } = await fixture(t);
  await assert.rejects(readProjectionFile(file, 0), /byte limit/);
  await writeFile(file, '');
  assert.equal((await readProjectionFile(file, 0)).length, 0);
});

for (const scope of ['leaf', 'parent', 'root']) {
  test(`rejects ${scope} symlinks instead of reading their target`, async (t) => {
    const { root, file } = await fixture(t);
    let path;
    if (scope === 'leaf') {
      path = join(root, 'alias.json'); await symlink(file, path);
    } else if (scope === 'parent') {
      await symlink(join(root, 'nested'), join(root, 'alias'), 'dir');
      path = join(root, 'alias/evidence.json');
    } else {
      await mkdir(join(root, 'container'));
      await symlink(join(root, 'nested'), join(root, 'container/root'), 'dir');
      path = join(root, 'container/root/evidence.json');
    }
    await assert.rejects(readProjectionFile(path, 1024), /non-symlink|regular file/);
    await assert.rejects(loadProjectionManifest(path), /non-symlink|regular file/);
  });
}

test('rejects an ancestor link to a directory outside the requested tree', async (t) => {
  const { root, file } = await fixture(t);
  await mkdir(join(root, 'workspace'));
  await symlink(join(root, 'nested'), join(root, 'workspace/escape'), 'dir');
  await assert.rejects(readProjectionFile(join(root, 'workspace/escape/evidence.json'), 1024), /non-symlink/);
  await assert.rejects(hashProjectionFiles(join(root, 'workspace'), [{ path: 'escape/evidence.json' }]), /non-symlink/);
  assert.equal((await readFile(file, 'utf8')), '{"value":"é"}');
});

test('rejects multiply linked evidence', async (t) => {
  const { root, file } = await fixture(t);
  await link(file, join(root, 'hard.json'));
  await assert.rejects(readProjectionFile(file, 1024), /singly linked/);
});

test('rejects missing files and directories', async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(readProjectionFile(join(root, 'missing'), 1024), { code: 'ENOENT' });
  await assert.rejects(readProjectionFile(root, 1024), /regular file/);
});

for (const path of ['', null, undefined, {}, 'a\0b']) {
  test(`rejects invalid file path ${String(path)}`, async () => {
    await assert.rejects(readProjectionFile(path, 1024), /nonempty string/);
  });
}

for (const key of ['maxBytes', 'maxFiles', 'maxTotalFileBytes']) {
  for (const value of [NaN, Infinity, -1, 0.5, '1', null]) {
    test(`public hash API refuses ${key}=${String(value)} before I/O`, async () => {
      await assert.rejects(hashProjectionFiles('/not-read', [], { [key]: value }), /non-negative safe integer/);
    });
  }
}

test('public loader refuses an invalid byte budget', async () => {
  await assert.rejects(loadProjectionManifest('/not-read', { maxBytes: NaN }), /non-negative safe integer/);
});

for (const bytes of [
  Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
  Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc0, 0xaf, 0x22, 0x7d]),
  Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
  Buffer.from('{"x":'),
]) {
  test(`rejects malformed encoding or JSON ${bytes.toString('hex')}`, async (t) => {
    const { file } = await fixture(t);
    await writeFile(file, bytes);
    await assert.rejects(loadProjectionManifest(file), /valid UTF-8 JSON/);
    assert.deepEqual(await readFile(file), bytes);
  });
}

test('accepts ordinary Unicode and preserves the literal replacement character', async (t) => {
  const { file } = await fixture(t);
  await writeFile(file, '{"value":"é😀�"}');
  assert.deepEqual(await loadProjectionManifest(file), { value: 'é😀�' });
});

test('hashes raw bytes, overrides copied hashes, and freezes sorted results', async (t) => {
  const { root, file } = await fixture(t);
  await writeFile(join(root, 'a.bin'), Buffer.from([0xff, 0x00]));
  const descriptors = Object.freeze([
    Object.freeze({ path: 'nested/evidence.json', sha256: 'forged', size: 0, projection: 'proto', mediaType: 'application/json' }),
    Object.freeze({ path: 'a.bin', projection: 'proto', mediaType: 'application/octet-stream' }),
  ]);
  const results = await hashProjectionFiles(root, descriptors);
  const raw = await readFile(file);
  assert.deepEqual(results.map((item) => item.path), ['a.bin', 'nested/evidence.json']);
  assert.equal(results[1].sha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(results[1].size, raw.length);
  assert.equal(results[1].projection, 'proto');
  assert.ok(Object.isFrozen(results) && results.every(Object.isFrozen));
  assert.equal(descriptors[0].sha256, 'forged');
});

test('enforces aggregate budget before reading the next file', async (t) => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'a.bin'), '123');
  await writeFile(join(root, 'b.bin'), '456');
  const files = [{ path: 'a.bin' }, { path: 'b.bin' }];
  assert.equal((await hashProjectionFiles(root, files, { maxBytes: 3, maxTotalFileBytes: 6 })).length, 2);
  await assert.rejects(hashProjectionFiles(root, files, { maxBytes: 3, maxTotalFileBytes: 5 }), /aggregate byte limit/);
  await assert.rejects(hashProjectionFiles(root, files, { maxFiles: 1 }), /file count/);
});

test('snapshots caller descriptors before yielding for filesystem work', async (t) => {
  const { root } = await fixture(t);
  const descriptors = [{ path: 'nested/evidence.json', projection: 'original' }];
  const pending = hashProjectionFiles(root, descriptors);
  descriptors[0].path = '../escape';
  descriptors[0].projection = 'mutated';
  const results = await pending;
  assert.equal(results[0].path, 'nested/evidence.json');
  assert.equal(results[0].projection, 'original');
});

for (const path of ['../outside', '/absolute', './a', 'a//b', 'a/../b', 'a\\b']) {
  test(`rejects unsafe descriptor ${path} before I/O`, async () => {
    await assert.rejects(hashProjectionFiles('/not-read', [{ path }]), /normalized relative POSIX/);
  });
}

test('rejects duplicate and inherited file identities before I/O', async () => {
  await assert.rejects(hashProjectionFiles('/not-read', [{ path: 'a' }, { path: 'a' }]), /duplicated/);
  await assert.rejects(hashProjectionFiles('/not-read', [Object.create({ path: 'a' })]), /normalized relative POSIX/);
});
