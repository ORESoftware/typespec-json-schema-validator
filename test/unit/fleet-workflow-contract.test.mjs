import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../docs/fleet-peer-authority-workflow.yml", import.meta.url);
const docsUrl = new URL("../../docs/fleet-action.md", import.meta.url);
const workflow = (await readFile(workflowUrl, "utf8")).replace(/\r\n?/gu, "\n");
const docs = (await readFile(docsUrl, "utf8")).replace(/\r\n?/gu, "\n");

function step(named) {
  const escaped = named.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = workflow.match(
    new RegExp(`\\n      - name: ${escaped}\\n[\\s\\S]*?(?=\\n      - name:|$)`, "u"),
  );
  assert.ok(match, `missing workflow step: ${named}`);
  return match[0];
}

test("canonical fleet workflow verifies the exact checked-out head", () => {
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /git rev-parse HEAD/u);
});

test("semantic comparison and admission remain fail-closed", () => {
  const comparison = step("Generate Schema B and compare both peer authorities");
  const admission = step("Require current evidence and canonical consumer-admission refusals");

  assert.match(comparison, /typespec-json-schema-validator@<40-character-commit>/u);
  assert.match(admission, /test-consumer-admission@<40-character-commit>/u);
  assert.doesNotMatch(comparison, /continue-on-error:/u);
  assert.doesNotMatch(admission, /continue-on-error:/u);
});

test("authored authorities cannot be rewritten by validation", () => {
  const immutability = step("Verify authored authorities were not modified");
  assert.match(immutability, /git diff --exit-code -- schema-authority\//u);
});

test("diagnostic artifact transport is best-effort and always attempted", () => {
  const retention = step("Retain diagnostic receipt, IR and comparison witness");

  assert.match(retention, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(retention, /continue-on-error: true/u);
  assert.match(
    retention,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u,
  );
  assert.match(retention, /include-hidden-files: true/u);
});

test("fleet guidance explicitly separates semantic admission from evidence transport", () => {
  assert.match(docs, /parity action and consumer-admission action are semantic gates/u);
  assert.match(docs, /Artifact upload is diagnostic transport, not semantic admission/u);
  assert.match(docs, /continue-on-error: true/u);
  assert.match(docs, /must not convert a successful peer-authority comparison into a false red/u);
});
