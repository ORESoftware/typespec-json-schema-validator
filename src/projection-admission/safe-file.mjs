import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { parse, resolve, sep } from 'node:path';

export function fileLimit(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function sameIdentity(left, right) {
  if (left.ino !== right.ino) return false;
  // On Windows, path-based lstat/stat can report dev=0 while handle-based
  // fstat reports the real volume serial for the same file. Keep inode/file-id
  // strict everywhere, and keep device strict whenever both views provide it.
  if (left.dev !== 0n && right.dev !== 0n && left.dev !== right.dev) return false;
  return true;
}

function samePathFile(left, right) {
  return sameIdentity(left, right) && left.nlink === right.nlink && left.size === right.size
    && left.mtimeNs === right.mtimeNs;
}

function sameOpenedFile(left, right) {
  return samePathFile(left, right) && left.mode === right.mode && left.ctimeNs === right.ctimeNs;
}

async function inspectPath(absolute) {
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  const directories = [];
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = resolve(current, part);
    const info = await lstat(current, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('projection evidence ancestors must be non-symlink directories');
    }
    directories.push({ path: current, info });
  }
  const file = await lstat(absolute, { bigint: true });
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1n) {
    throw new Error('projection evidence path must be a singly linked regular file');
  }
  return { directories, file };
}

/** Bounded reads in a trusted, quiescent workspace; not a filesystem sandbox. */
export async function readProjectionFile(path, maxBytes) {
  fileLimit(maxBytes, 'maxBytes');
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
    throw new TypeError('projection evidence path must be a nonempty string');
  }
  const absolute = resolve(path);
  const before = await inspectPath(absolute);
  if (before.file.size > BigInt(maxBytes)) {
    throw new Error('projection evidence file exceeds the configured byte limit');
  }
  // O_NOFOLLOW protects the leaf where supported. Ancestors are checked
  // separately; these checks do not provide openat-style race-proof traversal.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const handle = await open(absolute, flags);
  try {
    const opened = await handle.stat({ bigint: true });
    // Windows can expose different mode/ctime metadata and a zero path-based
    // device id for the same file. Identity plus link/size/mtime remain the
    // portable cross-view snapshot checks; stricter metadata is still compared
    // between two handle-based stats below.
    if (!samePathFile(before.file, opened)) throw new Error('projection evidence file changed before it was read');
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) throw new Error('projection evidence file changed while it was read');
      offset += result.bytesRead;
    }
    // At most one extra byte is read, so growth cannot create an unbounded read.
    const extra = await handle.read(Buffer.alloc(1), 0, 1, offset);
    const after = await handle.stat({ bigint: true });
    const current = await inspectPath(absolute);
    if (extra.bytesRead !== 0 || !sameOpenedFile(opened, after) || !samePathFile(after, current.file)
      || before.directories.length !== current.directories.length
      || before.directories.some((directory, index) =>
        directory.path !== current.directories[index].path
        || !sameIdentity(directory.info, current.directories[index].info))) {
      throw new Error('projection evidence file or ancestor changed while it was read');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
