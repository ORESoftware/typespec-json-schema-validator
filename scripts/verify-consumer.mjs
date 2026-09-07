// Internal action entrypoint: no public CLI flags and no receipt-selected paths.
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { verifyConsumerContract } from '../src/consumer-verification.mjs';
import {
  createConsumerVerificationReceipt,
  failedConsumerVerificationReceipt,
  writeConsumerVerificationReceipt,
} from '../src/consumer-verification-receipt.mjs';

function assertInside(workspace, path, name) {
  const local = relative(workspace, path);
  if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local)) {
    throw new Error(`${name} must remain inside the checked-out workspace`);
  }
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error('this action entrypoint accepts no command-line options');
  }
  const workspace = await realpath(process.env.GITHUB_WORKSPACE || process.cwd());

  async function input(name, fileOnly = false) {
    const value = process.env[name];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing ${name}`);
    const lexical = resolve(workspace, value);
    assertInside(workspace, lexical, name);
    const info = await lstat(lexical);
    if (info.isSymbolicLink()) throw new Error(`${name} must not be a symbolic link`);
    if (fileOnly && (!info.isFile() || info.nlink !== 1)) {
      throw new Error(`${name} must be a singly linked regular file`);
    }
    if (!fileOnly && !info.isFile() && !info.isDirectory()) {
      throw new Error(`${name} must be a regular file or directory`);
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

  const receiptPath = await output(
    'TSJSV_VERIFY_VERIFICATION',
    '.typespec-json-schema-validator/consumer-verification.json',
  );
  let contractIr = null;
  let report = null;
  let expectedDeclarations = null;
  try {
    const [irPath, reportPath, typespec, generatedSchema, authoredSchema] = await Promise.all([
      input('TSJSV_VERIFY_IR', true),
      input('TSJSV_VERIFY_REPORT', true),
      input('TSJSV_VERIFY_TYPESPEC'),
      input('TSJSV_VERIFY_GENERATED'),
      input('TSJSV_VERIFY_AUTHORED'),
    ]);
    [contractIr, report] = await Promise.all(
      [irPath, reportPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
    );
    try {
      expectedDeclarations = JSON.parse(process.env.TSJSV_VERIFY_DECLARATIONS || 'null');
    } catch {
      throw new Error('expected declaration scope is not valid JSON');
    }
    const result = await verifyConsumerContract({
      contractIr,
      report,
      typespec,
      generatedSchema,
      authoredSchema,
      expectedDeclarations,
    });
    const receipt = createConsumerVerificationReceipt(result);
    if (receipt.status !== 'passed') {
      throw new Error('consumer verification receipt could not be admitted');
    }
    await writeConsumerVerificationReceipt(receiptPath, receipt);
    console.log(JSON.stringify(receipt));
  } catch (error) {
    await writeConsumerVerificationReceipt(
      receiptPath,
      failedConsumerVerificationReceipt({ contractIr, report, expectedDeclarations }),
    );
    throw error;
  }
}

main().catch((error) => {
  console.error(
    `Contract IR consumer verification stopped: ${error instanceof Error ? error.message : 'unexpected failure'}`,
  );
  process.exitCode = 2;
});
