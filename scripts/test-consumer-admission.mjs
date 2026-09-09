// Internal GitHub Action entrypoint. Public CLI parsing remains flags-2-env-owned.
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { testConsumerAdmission } from '../src/consumer-admission-regressions.mjs';
import { preflightAdmissionOutput } from '../src/consumer-admission-paths.mjs';
import {
  createConsumerVerificationReceipt,
  failedConsumerVerificationReceipt,
  writeConsumerVerificationReceipt,
} from '../src/consumer-verification-receipt.mjs';

async function main() {
  const workspace = await realpath(process.env.GITHUB_WORKSPACE || process.cwd());
  function contained(value) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error('missing action input');
    const path = resolve(workspace, value);
    const local = relative(workspace, path);
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error('action paths must remain inside the workspace');
    }
    return path;
  }
  async function noLinks(path) {
    let current = workspace;
    for (const segment of relative(workspace, path).split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      if ((await lstat(current)).isSymbolicLink()) throw new Error('symbolic links are not admitted');
    }
  }
  async function input(path, fileOnly = false) {
    await noLinks(path);
    const info = await lstat(path);
    if ((!info.isFile() && !info.isDirectory()) ||
        (fileOnly && (!info.isFile() || info.nlink !== 1))) {
      throw new Error('input is not an admitted regular file or directory');
    }
    return path;
  }
  // Snapshot every nominated input before side effects. Do not infer an input's
  // ownership from its bytes, and do not put preflight inside tombstone cleanup.
  const configured = Object.freeze({
    ir: contained(process.env.TSJSV_VERIFY_IR),
    report: contained(process.env.TSJSV_VERIFY_REPORT),
    typespec: contained(process.env.TSJSV_VERIFY_TYPESPEC),
    generatedSchema: contained(process.env.TSJSV_VERIFY_GENERATED),
    authoredSchema: contained(process.env.TSJSV_VERIFY_AUTHORED),
  });
  const output = contained(process.env.TSJSV_VERIFY_VERIFICATION ||
    '.typespec-json-schema-validator/regression-verification.json');
  await preflightAdmissionOutput(workspace, output, Object.values(configured));
  // Create output parents only after proving separation from input subtrees.
  let parent = workspace;
  for (const segment of relative(workspace, dirname(output)).split(sep).filter(Boolean)) {
    parent = resolve(parent, segment);
    try { await mkdir(parent); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(parent);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('unsafe output parent');
  }
  let contractIr = null;
  let report = null;
  let expectedDeclarations = null;
  try {
    // A malformed invocation must invalidate old success, but only at an
    // independent, safe, validator-owned destination established above.
    if (process.argv.length !== 2) throw new Error('no command-line arguments are accepted');
    const ir = await input(configured.ir, true);
    const receipt = await input(configured.report, true);
    const typespec = await input(configured.typespec);
    const generatedSchema = await input(configured.generatedSchema);
    const authoredSchema = await input(configured.authoredSchema);
    contractIr = JSON.parse(await readFile(ir, 'utf8'));
    report = JSON.parse(await readFile(receipt, 'utf8'));
    expectedDeclarations = JSON.parse(process.env.TSJSV_VERIFY_DECLARATIONS || 'null');
    const result = await testConsumerAdmission({
      contractIr, report, typespec, generatedSchema, authoredSchema, expectedDeclarations,
    });
    const verification = createConsumerVerificationReceipt(result.verification);
    if (verification.status !== 'passed') throw new Error('verification receipt is not admissible');
    await writeConsumerVerificationReceipt(output, verification);
    console.log(JSON.stringify({
      status: 'passed', positiveChecksPassed: 2, negativeCasesPassed: result.rejected.length,
      rejectedCases: result.rejected, verificationId: verification.verificationId,
      scope: 'explicitly-configured-declarations-only',
    }));
  } catch (error) {
    await writeConsumerVerificationReceipt(output,
      failedConsumerVerificationReceipt({ contractIr, report, expectedDeclarations }));
    throw error;
  }
}

main().catch(() => {
  console.error('TJSV consumer-admission regression gate failed; no promotion is authorized.');
  process.exitCode = 2;
});
