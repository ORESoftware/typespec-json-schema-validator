import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const included = ['bin', 'scripts', 'src', 'test'];
const files = [];

async function collect(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await collect(child);
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(child);
    }
  }
}

for (const directory of included) {
  await collect(join(root, directory));
}

function check(path) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--check', path], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`node --check failed for ${path} with exit code ${code}`));
      }
    });
  });
}

for (const file of files) {
  await check(file);
}
process.stdout.write(`syntax checked ${files.length} JavaScript modules\n`);
