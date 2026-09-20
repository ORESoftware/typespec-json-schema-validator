import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`missing patch anchor: ${label}`);
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`ambiguous patch anchor: ${label}`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

const sourcePath = 'src/contract-ir.mjs';
let source = await readFile(sourcePath, 'utf8');
source = replaceOnce(
  source,
  `function reportDigest(report) {\n  return digestJson(report);\n}`,
  `function semanticConfiguration(configuration) {\n  if (!isObject(configuration)) return configuration ?? null;\n  const projected = structuredClone(configuration);\n  if (isObject(projected.emitterOptions)) {\n    delete projected.emitterOptions['emitter-output-dir'];\n  }\n  projected.executionMode = null;\n  if (isObject(projected.differential)) {\n    projected.differential.instanceCorpus = null;\n  }\n  return projected;\n}\n\nfunction semanticToolchain(toolchain) {\n  if (!isObject(toolchain)) return toolchain ?? null;\n  return {\n    ...structuredClone(toolchain),\n    typespecCompiler: {\n      version: toolchain.typespecCompiler?.version ?? null,\n    },\n  };\n}\n\nexport function semanticReportProjection(report) {\n  const projected = structuredClone(report);\n  projected.configuration = semanticConfiguration(projected.configuration);\n  projected.toolchain = semanticToolchain(projected.toolchain);\n  if (isObject(projected.inputs)) {\n    for (const lane of ['typespec', 'authoredJsonSchema', 'generatedJsonSchema']) {\n      if (isObject(projected.inputs[lane])) {\n        projected.inputs[lane] = { ...projected.inputs[lane], input: null };\n      }\n    }\n    if (Object.hasOwn(projected.inputs, 'mapping')) projected.inputs.mapping = null;\n  }\n  return projected;\n}\n\nfunction reportDigest(report) {\n  return digestJson(semanticReportProjection(report));\n}`,
  'report digest',
);
source = replaceOnce(
  source,
  `    toolchain: report.toolchain ?? null,\n    configuration: report.configuration ?? null,`,
  `    toolchain: semanticToolchain(report.toolchain),\n    configuration: semanticConfiguration(report.configuration),`,
  'Contract IR diagnostic projections',
);
await writeFile(sourcePath, source);

const testPath = 'test/unit/contract-ir.test.mjs';
let test = await readFile(testPath, 'utf8');
test = replaceOnce(
  test,
  `  createContractIr,\n  verifyContractIrEvidence,`,
  `  createContractIr,\n  semanticReportProjection,\n  verifyContractIrEvidence,`,
  'test import',
);
test = replaceOnce(
  test,
  `test('binds the exact receipt and all three input digests', () => {\n  const { report } = fixtures();\n  const ir = build();\n  assert.equal(ir.admission.receipt.runId, report.runId);\n  assert.equal(ir.admission.receipt.digest, sha256(canonicalStringify(report)));\n  assert.equal(ir.provenance.typespec.digest, report.inputs.typespec.digest);\n  assert.equal(ir.provenance.generatedJsonSchema.digest, report.inputs.generatedJsonSchema.digest);\n  assert.equal(ir.provenance.authoredJsonSchema.digest, report.inputs.authoredJsonSchema.digest);\n});`,
  `test('binds the semantic receipt and all three input digests', () => {\n  const { report } = fixtures();\n  const ir = build();\n  assert.equal(ir.admission.receipt.runId, report.runId);\n  assert.equal(ir.admission.receipt.digest, sha256(canonicalStringify(semanticReportProjection(report))));\n  assert.equal(ir.provenance.typespec.digest, report.inputs.typespec.digest);\n  assert.equal(ir.provenance.generatedJsonSchema.digest, report.inputs.generatedJsonSchema.digest);\n  assert.equal(ir.provenance.authoredJsonSchema.digest, report.inputs.authoredJsonSchema.digest);\n});\n\ntest('Contract IR identity ignores host-only receipt paths but keeps semantic changes', () => {\n  const linux = fixtures();\n  linux.report.configuration = {\n    mode: 'check',\n    emitterOptions: { 'emitter-output-dir': '/home/runner/_temp/witness', 'seal-object-schemas': 'true' },\n    executionMode: 'subprocess',\n    differential: { instanceCorpus: '/home/runner/_temp/instances', instanceCorpusDigest: hex('4') },\n  };\n  linux.report.toolchain = {\n    validator: { name: '@oresoftware/typespec-json-schema-validator', version: '0.1.0' },\n    typespecCompiler: { command: '/home/runner/node_modules/.bin/tsp', available: true, version: '1.16.0' },\n    jsonSchemaEmitter: '@typespec/json-schema',\n  };\n  linux.report.inputs.typespec.input = '/home/runner/work/contracts/main.tsp';\n  linux.report.inputs.generatedJsonSchema.input = '/home/runner/_temp/witness/schema.json';\n  linux.report.inputs.authoredJsonSchema.input = '/home/runner/work/contracts/authored.schema.json';\n  linux.report.inputs.mapping = '/home/runner/work/contracts/tjsv.mapping.json';\n\n  const mac = structuredClone(linux);\n  mac.report.configuration.emitterOptions['emitter-output-dir'] = '/Users/runner/work/_temp/witness';\n  mac.report.configuration.executionMode = 'pinned-compiler-fallback';\n  mac.report.configuration.differential.instanceCorpus = '/Users/runner/work/_temp/instances';\n  mac.report.toolchain.typespecCompiler.command = '/Users/runner/work/node_modules/.bin/tsp';\n  mac.report.inputs.typespec.input = '/Users/runner/work/contracts/main.tsp';\n  mac.report.inputs.generatedJsonSchema.input = '/Users/runner/work/_temp/witness/schema.json';\n  mac.report.inputs.authoredJsonSchema.input = '/Users/runner/work/contracts/authored.schema.json';\n  mac.report.inputs.mapping = '/Users/runner/work/contracts/tjsv.mapping.json';\n\n  const linuxIr = createContractIr(linux);\n  const macIr = createContractIr(mac);\n  assert.equal(linuxIr.irId, macIr.irId, 'host diagnostics must not perturb Contract IR identity');\n  assert.deepEqual(linuxIr.toolchain, macIr.toolchain);\n  assert.deepEqual(linuxIr.configuration, macIr.configuration);\n\n  const changed = structuredClone(mac);\n  changed.report.configuration.emitterOptions['seal-object-schemas'] = 'false';\n  assert.notEqual(\n    createContractIr(changed).irId,\n    linuxIr.irId,\n    'semantic emitter options must remain Contract IR identity-bearing',\n  );\n});`,
  'receipt identity test',
);
await writeFile(testPath, test);

const docsPath = 'docs/contract-ir.md';
let docs = await readFile(docsPath, 'utf8');
docs = replaceOnce(
  docs,
  `- the exact receipt, source, toolchain, configuration, and coverage evidence that admitted it.`,
  `- the semantic receipt identity, source, toolchain, configuration, and coverage evidence that admitted it. Host-only diagnostic paths remain in the parity report but are projected out of Contract IR identity.`,
  'artifact evidence docs',
);
docs = replaceOnce(
  docs,
  `2. the SHA-256 digest of the complete canonical receipt;`,
  `2. the SHA-256 digest of the canonical **semantic receipt projection** (diagnostic filesystem/process paths removed);`,
  'digest chain docs',
);
docs = replaceOnce(
  docs,
  `Any changed source, mapping, emitter option, validator version, or generated witness invalidates that chain and requires a new parity run and new IR.`,
  `Any changed source, semantic mapping, semantic emitter option, validator/compiler version, or generated witness invalidates that chain and requires a new parity run and new IR. Moving the same evidence between checkout/temp directories or invoking the same compiler from a different absolute path does not.`,
  'identity semantics docs',
);
await writeFile(docsPath, docs);
