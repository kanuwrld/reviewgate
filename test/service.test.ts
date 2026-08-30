import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { validatePolicy } from "../src/policy.js";
import { decide, exportApproved, listProposals, propose } from "../src/service.js";

let directory: string;
let ledger: string;

const policy = validatePolicy({
  version: 1,
  actions: {
    "support.reply.draft": {
      risk: "medium",
      mode: "approval_required",
      allowedTargets: ["ticket:*"],
    },
  },
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reviewgate-test-"));
  ledger = join(directory, "events.jsonl");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test("proposal is idempotent and conflicting reuse fails", () => {
  const request = {
    action: "support.reply.draft",
    target: "ticket:ABC-20",
    payload: { body: "Draft one" },
    idempotencyKey: "ticket-abc-20-v1",
  };
  const first = propose(ledger, policy, request, () => "2026-08-30T10:00:00.000Z");
  const repeated = propose(ledger, policy, request, () => "2026-08-30T10:01:00.000Z");
  assert.deepEqual(repeated, first);
  assert.equal(readFileSync(ledger, "utf8").trim().split("\n").length, 1);
  assert.throws(
    () => propose(ledger, policy, { ...request, payload: { body: "Changed" } }),
    /different request/,
  );
});

test("approved proposal can be exported once reviewed", () => {
  const proposal = propose(
    ledger,
    policy,
    {
      action: "support.reply.draft",
      target: "ticket:ABC-21",
      payload: { body: "Reviewed draft" },
      idempotencyKey: "ticket-abc-21-v1",
      requestedBy: "triage-agent",
    },
    () => "2026-08-30T10:00:00.000Z",
  );
  assert.equal(proposal.status, "pending");
  assert.throws(() => exportApproved(ledger, proposal.id), /Only approved/);

  const approved = decide(
    ledger,
    proposal.id,
    "approved",
    "reviewer@example.invalid",
    "Policy checked",
    () => "2026-08-30T10:05:00.000Z",
  );
  assert.equal(approved.status, "approved");
  const envelope = exportApproved(ledger, proposal.id);
  assert.equal(envelope.approvedBy, "reviewer@example.invalid");
  assert.equal(envelope.action, "support.reply.draft");
  assert.equal(listProposals(ledger, "approved").length, 1);
  assert.throws(
    () => decide(ledger, proposal.id, "rejected", "another-reviewer"),
    /only pending proposals/,
  );
});
