import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatePolicy, validatePolicy } from "../src/policy.js";

const policy = validatePolicy({
  version: 1,
  actions: {
    "support.reply.draft": {
      risk: "medium",
      mode: "approval_required",
      allowedTargets: ["ticket:*"],
      maxPayloadBytes: 2048,
    },
    "crm.note.create": {
      risk: "low",
      mode: "auto_approve",
      allowedTargets: ["lead:*"],
    },
  },
});

test("unknown actions are blocked", () => {
  const decision = evaluatePolicy(policy, {
    action: "payment.refund",
    target: "payment:1",
    payload: {},
    idempotencyKey: "refund-1",
  });
  assert.equal(decision.status, "blocked");
  assert.equal(decision.risk, "unknown");
});

test("allowlisted draft actions require approval", () => {
  const decision = evaluatePolicy(policy, {
    action: "support.reply.draft",
    target: "ticket:ABC-10",
    payload: { body: "Fictional draft" },
    idempotencyKey: "draft-10",
  });
  assert.equal(decision.status, "pending");
  assert.equal(decision.risk, "medium");
});

test("secret-like keys block otherwise valid payloads", () => {
  const decision = evaluatePolicy(policy, {
    action: "support.reply.draft",
    target: "ticket:ABC-11",
    payload: { metadata: { apiKey: "must-not-enter-ledger" } },
    idempotencyKey: "draft-11",
  });
  assert.equal(decision.status, "blocked");
  assert.match(decision.reason, /secret-like key/);
});

test("high risk actions cannot be auto-approved", () => {
  assert.throws(
    () =>
      validatePolicy({
        version: 1,
        actions: { "email.send": { risk: "high", mode: "auto_approve" } },
      }),
    /cannot auto-approve/,
  );
});
