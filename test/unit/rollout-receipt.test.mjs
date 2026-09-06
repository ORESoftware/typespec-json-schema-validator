import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const receiptUrl = new URL("../../rollout/den-3982-2026-09-06.json", import.meta.url);
const receipt = JSON.parse(await readFile(receiptUrl, "utf8"));
const sha40 = /^[0-9a-f]{40}$/;
const prUrl = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)$/;

test("DEN-3982 receipt covers at least 30 repositories in at least five organizations", () => {
  assert.equal(receipt.linear_issue, "DEN-3982");
  assert.equal(receipt.scope.repositories, receipt.repositories.length);
  assert.equal(receipt.scope.pull_requests, receipt.repositories.length);
  assert.ok(receipt.repositories.length >= 30);

  const repositories = new Set(receipt.repositories.map((entry) => entry.repository));
  const organizations = new Set(
    receipt.repositories.map((entry) => entry.repository.split("/", 1)[0]),
  );
  assert.equal(repositories.size, receipt.repositories.length);
  assert.ok(organizations.size >= 5);
  assert.deepEqual([...organizations].sort(), receipt.scope.organization_names);
  assert.equal(receipt.scope.organizations, organizations.size);
});

test("receipt preserves independent peer authority semantics", () => {
  assert.equal(receipt.authority_contract.typespec, "independently_authored_peer_authority");
  assert.equal(
    receipt.authority_contract.json_schema_draft_2020_12,
    "independently_authored_peer_authority",
  );
  assert.equal(
    receipt.authority_contract.typespec_generated_json_schema_b,
    "comparison_evidence_only",
  );
  assert.equal(receipt.authority_contract.mismatch_policy, "stop_for_evaluation");
  assert.equal(receipt.authority_contract.preferred_fallback_authority, null);
  assert.equal(receipt.authority_contract.certifies_unrelated_domain_contracts, false);
  assert.equal(receipt.rollout_defaults.authority_model, "independent_peer_authorities");
  assert.equal(receipt.rollout_defaults.canary_scope, "gate_execution_only");
  assert.match(receipt.rollout_defaults.branch, /DEN-3982/);
  assert.match(receipt.validator.action_commit, sha40);
  assert.equal(receipt.validator.generated_schema_role, "comparison_evidence_only");
  assert.deepEqual(receipt.validator.exit_states, {
    0: "passed",
    2: "stopped_for_evaluation",
    3: "failed",
  });
});

test("every rollout entry has immutable evidence and a real pull request", () => {
  for (const entry of receipt.repositories) {
    assert.match(entry.head_sha, sha40);

    const match = entry.pull_request.url.match(prUrl);
    assert.ok(match, `${entry.repository} has an invalid pull-request URL`);
    assert.equal(`${match[1]}/${match[2]}`, entry.repository);
    assert.equal(Number(match[3]), entry.pull_request.number);
    assert.ok(["open", "merged"].includes(entry.pull_request.state));

    if (entry.pull_request.state === "merged") {
      assert.match(entry.pull_request.merge_sha, sha40);
      assert.equal(entry.checks.peer_authority_parity, "success");
      assert.equal(entry.checks.repository_native, "success");
      assert.equal(entry.blocker_ref, undefined);
    } else {
      assert.ok(entry.blocker_ref, `${entry.repository} must explain why it remains open`);
      assert.ok(
        receipt.blocker_catalog[entry.blocker_ref],
        `${entry.repository} references an unknown blocker`,
      );
    }
  }
});

test("recorded scope totals and zero-finding evidence are internally consistent", () => {
  const merged = receipt.repositories.filter(
    (entry) => entry.pull_request.state === "merged",
  ).length;
  assert.equal(receipt.scope.merged_repositories, merged);
  assert.equal(receipt.scope.open_repositories, receipt.repositories.length - merged);
  assert.equal(
    receipt.verified_canary_result.agreements,
    receipt.verified_canary_result.bidirectional_probes,
  );
  assert.equal(receipt.verified_canary_result.findings, 0);
  assert.equal(receipt.verified_canary_result.divergences, 0);
});
