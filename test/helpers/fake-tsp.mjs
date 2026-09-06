#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

if (process.argv.includes('--version')) {
  process.stdout.write('1.15.0-fake\n');
  process.exit(0);
}

const options = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === '--option') {
    const value = process.argv[index + 1] ?? '';
    const separator = value.indexOf('=');
    if (separator > 0) {
      options.set(value.slice(0, separator), value.slice(separator + 1));
    }
    index += 1;
  }
}
const outputDir = options.get('@typespec/json-schema.emitter-output-dir');
const bundleId = options.get('@typespec/json-schema.bundleId');
if (!outputDir || !bundleId) {
  process.stderr.write('fake-tsp: missing emitter-output-dir or bundleId\n');
  process.exit(2);
}
const fixture = resolve(import.meta.dirname, '../fixtures/pass/generated.schema.json');
const schema = JSON.parse(await readFile(fixture, 'utf8'));
schema.$id = bundleId;
const output = resolve(outputDir, bundleId);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(schema, null, 2)}\n`);
process.stdout.write(`fake emitted ${output}\n`);
