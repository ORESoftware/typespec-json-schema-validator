// Internal action entrypoint: no public CLI flags and no receipt-selected paths.
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { canonicalStringify } from '../src/canonical.mjs';
import { verifyLanguageBoundariesAgainstCurrentInputs } from '../src/language-boundary-current-inputs.mjs';

function assertInside(root, path, name) {
  const local = relative(root, path);

  if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local)) {
    throw new Error(`${name} must remain inside ${basename(root) || 'the admitted root'}`);
  }
}

async function regularPath(workspace, value, name, { directory = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`missing ${name}`);
  }

  const lexical = resolve(workspace, value);
  assertInside(workspace, lexical, name);

  const info = await lstat(lexical);
  const admittedKind = info.isFile() || (directory && info.isDirectory());

  if (!admittedKind || info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)) {
    throw new Error(
      directory
        ? `${name} must be a regular non-symlink file or directory`
        : `${name} must be a singly linked regular non-symlink file`,
    );
  }

  const path = await realpath(lexical);
  assertInside(workspace, path, name);

  return path;
}

async function regularFile(workspace, value, name) {
  return regularPath(workspace, value, name);
}

async function regularDirectory(workspace, value, name) {
  const path = await regularPath(workspace, value, name, { directory: true });
  const info = await lstat(path);

  if (!info.isDirectory()) {
    throw new Error(`${name} must be a regular non-symlink directory`);
  }

  return path;
}

async function jsonFile(workspace, value, name) {
  const path = await regularFile(workspace, value, name);

  return JSON.parse(await readFile(path, 'utf8'));
}

async function declaredEvidence(workspace, evidenceRoot, manifest) {
  if (!Array.isArray(manifest?.targets)) {
    throw new Error('language-boundary manifest targets must be an array');
  }

  const evidenceByPath = Object.create(null);
  const seen = new Set();

  for (const target of manifest.targets) {
    const evidence = target?.evidence;

    if (typeof evidence !== 'string' || evidence.trim() === '') {
      throw new Error('every language-boundary target must declare a non-empty evidence path');
    }

    if (seen.has(evidence)) {
      throw new Error('language-boundary evidence paths must be unique');
    }

    seen.add(evidence);

    const lexical = resolve(evidenceRoot, evidence);
    assertInside(evidenceRoot, lexical, 'manifest evidence');
    assertInside(workspace, lexical, 'manifest evidence');

    const info = await lstat(lexical);

    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error('manifest evidence must resolve to a singly linked regular non-symlink file');
    }

    const path = await realpath(lexical);
    assertInside(evidenceRoot, path, 'manifest evidence');
    assertInside(workspace, path, 'manifest evidence');
    evidenceByPath[evidence] = JSON.parse(await readFile(path, 'utf8'));
  }

  return evidenceByPath;
}

async function outputPath(workspace, value, fallback) {
  const selected = value || fallback;

  if (typeof selected !== 'string' || selected.trim() === '') {
    throw new Error('missing TSJSV_BOUNDARY_VERIFICATION');
  }

  const lexical = resolve(workspace, selected);
  assertInside(workspace, lexical, 'TSJSV_BOUNDARY_VERIFICATION');
  await mkdir(dirname(lexical), { recursive: true });

  const parent = await realpath(dirname(lexical));
  assertInside(workspace, parent, 'TSJSV_BOUNDARY_VERIFICATION');

  const output = resolve(parent, basename(lexical));

  try {
    const info = await lstat(output);

    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error('verification output must be absent or a singly linked regular non-symlink file');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  return output;
}

async function writeReceipt(path, receipt) {
  const temporary = `${path}.tmp-${process.pid}`;

  try {
    await writeFile(temporary, `${canonicalStringify(receipt)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error('this action entrypoint accepts no command-line options');
  }

  const workspace = await realpath(process.env.GITHUB_WORKSPACE || process.cwd());

  const [typespec, generatedSchema, authoredSchema, report, contractIr, manifest, evidenceRoot, verification] =
    await Promise.all([
      regularFile(workspace, process.env.TSJSV_BOUNDARY_TYPESPEC, 'TSJSV_BOUNDARY_TYPESPEC'),
      regularPath(
        workspace,
        process.env.TSJSV_BOUNDARY_GENERATED_SCHEMA,
        'TSJSV_BOUNDARY_GENERATED_SCHEMA',
        { directory: true },
      ),
      regularPath(
        workspace,
        process.env.TSJSV_BOUNDARY_AUTHORED_SCHEMA,
        'TSJSV_BOUNDARY_AUTHORED_SCHEMA',
        { directory: true },
      ),
      jsonFile(workspace, process.env.TSJSV_BOUNDARY_PARITY_REPORT, 'TSJSV_BOUNDARY_PARITY_REPORT'),
      jsonFile(workspace, process.env.TSJSV_BOUNDARY_CONTRACT_IR, 'TSJSV_BOUNDARY_CONTRACT_IR'),
      jsonFile(workspace, process.env.TSJSV_BOUNDARY_MANIFEST, 'TSJSV_BOUNDARY_MANIFEST'),
      regularDirectory(workspace, process.env.TSJSV_BOUNDARY_EVIDENCE_ROOT, 'TSJSV_BOUNDARY_EVIDENCE_ROOT'),
      outputPath(
        workspace,
        process.env.TSJSV_BOUNDARY_VERIFICATION,
        '.typespec-json-schema-validator/language-boundary-verification.json',
      ),
    ]);

  const evidenceByPath = await declaredEvidence(workspace, evidenceRoot, manifest);
  const receipt = await verifyLanguageBoundariesAgainstCurrentInputs({
    typespec,
    generatedSchema,
    authoredSchema,
    report,
    contractIr,
    manifest,
    evidenceByPath,
  });

  await writeReceipt(verification, receipt);
  console.log(JSON.stringify(receipt));

  if (receipt.status !== 'passed' || receipt.zeroUnexplainedFindings !== true) {
    throw new Error('language/runtime boundary verification stopped for evaluation');
  }
}

main().catch((error) => {
  console.error(`Language/runtime boundary verification stopped: ${error instanceof Error ? error.message : 'unexpected failure'}`);
  process.exitCode = 2;
});
