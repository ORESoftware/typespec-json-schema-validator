// Internal action entrypoint: no public CLI flags and no receipt-selected paths.
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { verifyFormalContract } from '../src/formal-verification.mjs';
import { writeFormalVerificationReceipt } from '../src/formal-verification-receipt-file.mjs';

function assertInside(workspace, path, name) {
  const local = relative(workspace, path);
  if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local)) {
    throw new Error(`${name} must remain inside the checked-out workspace`);
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('this action entrypoint accepts no command-line options');
  const workspace = await realpath(process.env.GITHUB_WORKSPACE || process.cwd());

  async function input(name) {
    const value = process.env[name];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing ${name}`);
    const lexical = resolve(workspace, value);
    assertInside(workspace, lexical, name);
    const info = await lstat(lexical);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error(`${name} must be a singly linked regular non-symlink file`);
    }
    const path = await realpath(lexical);
    assertInside(workspace, path, name);
    return path;
  }

  async function output(name, fallback) {
    const value = process.env[name] || fallback;
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing ${name}`);
    const lexical = resolve(workspace, value);
    assertInside(workspace, lexical, name);
    await mkdir(dirname(lexical), { recursive: true });
    const parent = await realpath(dirname(lexical));
    assertInside(workspace, parent, name);
    return resolve(parent, basename(lexical));
  }

  const [typespec, behaviorPath, manifestPath, receiptPath] = await Promise.all([
    input('TSJSV_FORMAL_TYPESPEC'),
    input('TSJSV_FORMAL_BEHAVIOR'),
    input('TSJSV_FORMAL_MANIFEST'),
    output('TSJSV_FORMAL_VERIFICATION', '.typespec-json-schema-validator/formal-verification.json'),
  ]);
  const [behaviorContract, manifest] = await Promise.all(
    [behaviorPath, manifestPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
  );
  const dafnyBin = process.env.TSJSV_FORMAL_DAFNY_BIN || 'dafny';
  const receipt = await verifyFormalContract({
    root: workspace,
    typespec,
    behaviorContract,
    manifest,
    dafnyBin,
  });
  await writeFormalVerificationReceipt(receiptPath, receipt);
  console.log(JSON.stringify(receipt));
  if (receipt.status !== 'passed') throw new Error('formal verification stopped for evaluation');
}

main().catch((error) => {
  console.error(`Formal verification stopped: ${error instanceof Error ? error.message : 'unexpected failure'}`);
  process.exitCode = 2;
});
