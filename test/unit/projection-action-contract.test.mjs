import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const actionUrl = new URL("../../actions/verify-projection/action.yml", import.meta.url);
const action = (await readFile(actionUrl, "utf8")).replace(/\r\n?/gu, "\n");

test("projection action passes the required positional CLI command", () => {
  assert.match(
    action,
    /bin\/typespec-json-schema-validator\.mjs" verify-projection/,
    "the composite action must invoke the verify-projection subcommand explicitly",
  );
  assert.doesNotMatch(
    action,
    /TSJSV_COMMAND:/,
    "an environment variable cannot stand in for the required positional subcommand",
  );
});

test("projection action fails closed when no receipt is produced", () => {
  const invocation = action.indexOf('bin/typespec-json-schema-validator.mjs" verify-projection');
  const receiptCheck = action.indexOf('test -s "${receipt_path}"');
  const receiptParse = action.indexOf('JSON.parse(fs.readFileSync(process.argv[1], "utf8"))');
  assert.ok(invocation >= 0, "missing projection-verification invocation");
  assert.ok(receiptCheck > invocation, "receipt existence must be checked after verification");
  assert.ok(receiptParse > receiptCheck, "receipt must exist before it is parsed");
});

test("projection action publishes outputs only from an admissible passed receipt", () => {
  assert.match(action, /receipt\.status !== "passed"/);
  assert.match(action, /receipt\.admissible !== true/);
  const admissibilityCheck = action.indexOf('receipt.status !== "passed"');
  const outputWrite = action.indexOf("printf 'verification=%s\\n'");
  assert.ok(admissibilityCheck >= 0);
  assert.ok(outputWrite > admissibilityCheck, "outputs must be written only after admissibility is proven");
});

test("projection action keeps both human-authored authority inputs distinct", () => {
  assert.match(action, /TSJSV_TYPESPEC: \$\{\{ inputs\.typespec \}\}/);
  assert.match(action, /TSJSV_AUTHORED_SCHEMA: \$\{\{ inputs\.authored_schema \}\}/);
  assert.match(action, /TSJSV_GENERATED_SCHEMA: \$\{\{ inputs\.generated_schema \}\}/);
  assert.match(action, /comparison-only JSON Schema B/);
  assert.match(action, /independently authored JSON Schema A/);
});
