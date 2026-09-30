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

test("fleet action supports legacy authority inputs and manifest mode without a second parser", () => {
  assert.match(action, /inputs:\n  typespec:[\s\S]*?required: false[\s\S]*?default: ""/);
  assert.match(action, /\n  schema:[\s\S]*?required: false[\s\S]*?default: ""/);
  assert.match(action, /\n  consumer_manifest:[\s\S]*?default: ""/);
  assert.match(action, /\n  contract:[\s\S]*?default: ""/);
  assert.match(action, /--typespec=\$\{TSJSV_TYPESPEC_INPUT\}/);
  assert.match(action, /--schema=\$\{TSJSV_SCHEMA_INPUT\}/);
  assert.match(action, /--consumer-manifest=\$\{TSJSV_CONSUMER_MANIFEST_INPUT\}/);
  assert.match(action, /--contract=\$\{TSJSV_CONTRACT_INPUT\}/);
  assert.match(action, /omit both to use \.ores-tjsv\.toml/);
  assert.doesNotMatch(action, /parseConsumerManifest|parseStructured|eval/);
});

test("manifest mode keeps repository config authoritative instead of forwarding action defaults", () => {
  assert.match(action, /Existing action defaults are deliberately not forwarded in manifest/);
  assert.match(action, /manifest mode does not accept legacy action configuration inputs/);
  assert.match(action, /TSJSV_\* job environment variables/);
  const manifestBlock = action.slice(
    action.indexOf('if [[ -n "${TSJSV_CONSUMER_MANIFEST_INPUT}"'),
    action.indexOf('        else\n          if [[ -z "${TSJSV_TYPESPEC_INPUT}"'),
  );
  assert.doesNotMatch(manifestBlock, /--report=/);
  assert.doesNotMatch(manifestBlock, /--output-dir=/);
  assert.doesNotMatch(manifestBlock, /--int64-strategy=/);
  assert.doesNotMatch(manifestBlock, /--seal-object-schemas=/);
});

test("legacy action mode preserves generated evidence and JSON/SARIF defaults", () => {
  assert.match(action, /--report=\$\{TSJSV_REPORT_INPUT\}/);
  assert.match(action, /--sarif=\$\{TSJSV_SARIF_INPUT\}/);
  assert.match(action, /--output-dir=\$\{TSJSV_OUTPUT_DIR_INPUT\}/);
  assert.match(action, /\.typespec-json-schema-validator\/generated/);
  assert.match(action, /\.typespec-json-schema-validator\/report\.sarif/);
  assert.doesNotMatch(action, /cp .*TSJSV_(?:TYPESPEC|SCHEMA)_INPUT/);
});

test("fleet action exposes opt-in parity-approved Contract IR in legacy mode", () => {
  assert.match(action, /\n  contract_ir:[\s\S]*?default: ""/);
  assert.match(action, /TSJSV_CONTRACT_IR_INPUT: \$\{\{ inputs\.contract_ir \}\}/);
  assert.match(action, /--contract-ir=\$\{TSJSV_CONTRACT_IR_INPUT\}/);
  assert.match(action, /if \[\[ -n "\$\{TSJSV_CONTRACT_IR_INPUT\}" \]\]/);
});

test("fleet action preserves reviewed official-emitter defaults for legacy callers", () => {
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
