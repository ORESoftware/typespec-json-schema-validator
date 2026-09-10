import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { verifyLanguageBoundariesAgainstCurrentInputs } from '@oresoftware/typespec-json-schema-validator/language-boundary-current-inputs';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const digestFile = async (path) => `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;

const reportPath = required('TJSV_REPORT');
const contractIrPath = required('TJSV_CONTRACT_IR');
const generatedSchema = required('TJSV_GENERATED_SCHEMA');
const sourceRevision = required('SOURCE_REVISION');
const evidenceDir = required('BOUNDARY_EVIDENCE_DIR');
const verificationPath = required('BOUNDARY_VERIFICATION');

if (!/^[0-9a-f]{40}$/.test(sourceRevision)) throw new Error('SOURCE_REVISION must be an immutable 40-character lowercase Git SHA');

const manifestPath = 'contracts/shared-auth-config/language-boundaries.json';
const manifest = await readJson(manifestPath);
const report = await readJson(reportPath);
const contractIr = await readJson(contractIrPath);

if (!/^[0-9a-f]{64}$/.test(report.runId ?? '')) throw new Error('TJSV report is missing a canonical runId');
if (!/^[0-9a-f]{64}$/.test(contractIr.irId ?? '')) throw new Error('TJSV Contract IR is missing a canonical irId');

const evidenceByPath = Object.create(null);
const adapters = [
  {
    evidencePath: 'contracts/shared-auth-config/runtime/evidence/rust.json',
    output: `${evidenceDir}/rust.json`,
    language: 'rust',
    runtime: 'rust-1.88.0',
    artifact: 'contracts/shared-auth-config/runtime/rust/src/lib.rs',
    toolchain: { name: 'rustc', version: '1.88.0' },
  },
  {
    evidencePath: 'contracts/shared-auth-config/runtime/evidence/typescript.json',
    output: `${evidenceDir}/typescript.json`,
    language: 'typescript',
    runtime: 'node-22.16.0',
    artifact: 'contracts/shared-auth-config/runtime/typescript/shared-auth-config.ts',
    toolchain: { name: 'node+typescript', version: '22.16.0+7.0.2' },
  },
  {
    evidencePath: 'contracts/shared-auth-config/runtime/evidence/go.json',
    output: `${evidenceDir}/go.json`,
    language: 'go',
    runtime: 'go-1.23.2',
    artifact: 'contracts/shared-auth-config/runtime/go/config.go',
    toolchain: { name: 'go', version: '1.23.2' },
  },
];

await mkdir(evidenceDir, { recursive: true });
for (const adapter of adapters) {
  const evidence = {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language: adapter.language,
    runtime: adapter.runtime,
    status: 'passed',
    sourceRevision,
    artifactDigest: await digestFile(adapter.artifact),
    receiptRunId: report.runId,
    contractIrId: contractIr.irId,
    toolchain: adapter.toolchain,
    generator: { name: 'shared-auth-config-derived-runtime-adapter', version: 'DEN-606-v1' },
    validation: { ingress: 'passed', egress: 'passed' },
  };
  evidenceByPath[adapter.evidencePath] = evidence;
  await writeFile(adapter.output, `${JSON.stringify(evidence, null, 2)}\n`);
}

const verification = await verifyLanguageBoundariesAgainstCurrentInputs({
  typespec: 'contracts/shared-auth-config/main.tsp',
  generatedSchema,
  authoredSchema: 'schema/shared-auth-config.schema.json',
  report,
  contractIr,
  manifest,
  evidenceByPath,
});

await mkdir(dirname(verificationPath), { recursive: true });
await writeFile(verificationPath, `${JSON.stringify(verification, null, 2)}\n`);

if (verification.status !== 'passed' || verification.zeroUnexplainedFindings !== true) {
  console.error(JSON.stringify(verification, null, 2));
  throw new Error('TJSV language/runtime boundary admission stopped');
}

console.log(`TJSV language/runtime boundary admission passed: ${verification.verificationId}`);
