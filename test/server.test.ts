import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { validatePolicy } from "../src/policy.js";
import { createReviewGateServer } from "../src/server.js";

const directory = mkdtempSync(join(tmpdir(), "reviewgate-server-"));
const ledger = join(directory, "events.jsonl");
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
const server = createReviewGateServer(ledger, policy);
let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  rmSync(directory, { recursive: true, force: true });
});

test("HTTP flow proposes, approves, and exports an envelope", async () => {
  const createResponse = await fetch(`${baseUrl}/v1/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "support.reply.draft",
      target: "ticket:HTTP-1",
      payload: { body: "Fictional reply" },
      idempotencyKey: "http-1-v1",
    }),
  });
  assert.equal(createResponse.status, 201);
  const proposal = (await createResponse.json()) as { id: string; status: string };
  assert.equal(proposal.status, "pending");

  const decisionResponse = await fetch(`${baseUrl}/v1/proposals/${proposal.id}/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve", actor: "http-reviewer" }),
  });
  assert.equal(decisionResponse.status, 200);

  const exportResponse = await fetch(`${baseUrl}/v1/proposals/${proposal.id}/export`);
  assert.equal(exportResponse.status, 200);
  const envelope = (await exportResponse.json()) as { approvedBy: string };
  assert.equal(envelope.approvedBy, "http-reviewer");
});
