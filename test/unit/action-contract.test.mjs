import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const actionUrl = new URL("../../action.yml", import.meta.url);
const action = (await readFile(actionUrl, "utf8")).replace(/\r\n?/gu, "\n");

test("fleet action remains composite and lockfile-pinned", () => {
  assert.match(action, /runs:\n  using: composite/);
  assert.match(action, /npm ci --omit=dev/);
  assert.doesNotMatch(action, /npm install\b/);
  assert.doesNotMatch(action, /npm ci[^\n]*--ignore-scripts/);
});

test("fleet action requires both authored authorities", () => {
  assert.match(action, /inputs:\n  typespec:[\s\S]*?required: true/);
  assert.match(action, /\n  schema:[\s\S]*?required: true/);
  assert.match(action, /--typespec=\$\{TSJSV_TYPESPEC_INPUT\}/);
  assert.match(action, /--schema=\$\{TSJSV_SCHEMA_INPUT\}/);
});

test("fleet action isolates generated evidence and emits JSON and SARIF artifacts", () => {
  assert.match(action, /--report=\$\{TSJSV_REPORT_INPUT\}/);
  assert.match(action, /--sarif=\$\{TSJSV_SARIF_INPUT\}/);
  assert.match(action, /--output-dir=\$\{TSJSV_OUTPUT_DIR_INPUT\}/);
  assert.match(action, /\.typespec-json-schema-validator\/generated/);
  assert.match(action, /\.typespec-json-schema-validator\/report\.sarif/);
  assert.doesNotMatch(action, /cp .*TSJSV_(?:TYPESPEC|SCHEMA)_INPUT/);
});

test("fleet action exposes opt-in parity-approved Contract IR", () => {
  assert.match(action, /\n  contract_ir:[\s\S]*?default: ""/);
  assert.match(action, /TSJSV_CONTRACT_IR_INPUT: \$\{\{ inputs\.contract_ir \}\}/);
  assert.match(action, /--contract-ir=\$\{TSJSV_CONTRACT_IR_INPUT\}/);
  assert.match(action, /if \[\[ -n "\$\{TSJSV_CONTRACT_IR_INPUT\}" \]\]/);
});

test("fleet action exposes reviewed official-emitter strategies", () => {
  assert.match(action, /\n  int64_strategy:[\s\S]*?default: string/);
  assert.match(action, /\n  seal_object_schemas:[\s\S]*?default: "true"/);
  assert.match(action, /\n  polymorphic_models_strategy:[\s\S]*?default: oneOf/);
  assert.match(action, /--int64-strategy=\$\{TSJSV_INT64_STRATEGY_INPUT\}/);
  assert.match(action, /--seal-object-schemas=\$\{TSJSV_SEAL_OBJECT_SCHEMAS_INPUT\}/);
  assert.match(
    action,
    /--polymorphic-models-strategy=\$\{TSJSV_POLYMORPHIC_MODELS_STRATEGY_INPUT\}/,
  );
  assert.doesNotMatch(action, /TSJSV_INT64_STRATEGY_INPUT:-/);
});

test("fleet action invokes the reviewed validator without eval", () => {
  assert.match(action, /bin\/typespec-json-schema-validator\.mjs/);
  assert.match(action, /"\$\{args\[@\]\}"/);
  assert.doesNotMatch(action, /\beval\b/);
});
