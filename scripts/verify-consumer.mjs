// Internal action entrypoint: no public CLI flags and no receipt-selected paths.
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { verifyConsumerContract } from '../src/consumer-verification.mjs';

async function main() {
  if (process.argv.length !== 2) throw new Error('this action entrypoint accepts no command-line options');
  const workspace = await realpath(process.env.GITHUB_WORKSPACE || process.cwd());
  async function input(name) {
    const value = process.env[name];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing ${name}`);
    const path = await realpath(resolve(workspace, value));
    const local = relative(workspace, path);
    if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local)) {
      throw new Error(`${name} must remain inside the checked-out workspace`);
    }
    return path;
  }
  const [irPath, reportPath, typespec, generatedSchema, authoredSchema] = await Promise.all([
    input('TSJSV_VERIFY_IR'), input('TSJSV_VERIFY_REPORT'), input('TSJSV_VERIFY_TYPESPEC'),
    input('TSJSV_VERIFY_GENERATED'), input('TSJSV_VERIFY_AUTHORED'),
  ]);
  const [contractIr, report] = await Promise.all([irPath, reportPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const expectedDeclarations = JSON.parse(process.env.TSJSV_VERIFY_DECLARATIONS || 'null');
  const result = await verifyConsumerContract({ contractIr, report, typespec, generatedSchema, authoredSchema, expectedDeclarations });
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(`Contract IR consumer verification stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
