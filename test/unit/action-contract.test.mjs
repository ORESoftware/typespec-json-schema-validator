import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const actionUrl = new URL("../../action.yml", import.meta.url);
const action = await readFile(actionUrl, "utf8");

test("fleet action remains composite and lockfile-pinned", () => {
  assert.match(action, /runs:\n  using: composite/);
  assert.match(action, /npm ci --omit=dev --ignore-scripts/);
  assert.doesNotMatch(action, /npm install\b/);
});

test("fleet action requires both authored authorities", () => {
  assert.match(action, /inputs:\n  typespec:[\s\S]*?required: true/);
  assert.match(action, /\n  schema:[\s\S]*?required: true/);
  assert.match(action, /--typespec=\$\{TSJSV_TYPESPEC_INPUT\}/);
  assert.match(action, /--schema=\$\{TSJSV_SCHEMA_INPUT\}/);
});

test("fleet action isolates generated evidence and emits a receipt", () => {
  assert.match(action, /--report=\$\{TSJSV_REPORT_INPUT\}/);
  assert.match(action, /--output-dir=\$\{TSJSV_OUTPUT_DIR_INPUT\}/);
  assert.match(action, /\.typespec-json-schema-validator\/generated/);
  assert.doesNotMatch(action, /cp .*TSJSV_(?:TYPESPEC|SCHEMA)_INPUT/);
});

test("fleet action invokes the reviewed validator without eval", () => {
  assert.match(action, /bin\/typespec-json-schema-validator\.mjs/);
  assert.match(action, /"\$\{args\[@\]\}"/);
  assert.doesNotMatch(action, /\beval\b/);
});
