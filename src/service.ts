import { createHash } from "node:crypto";

import { ReviewGateError } from "./errors.js";
import { appendEvent, readEvents, rebuildState } from "./ledger.js";
import { evaluatePolicy, stableStringify } from "./policy.js";
import type {
  ApprovedEnvelope,
  Policy,
  ProposalRequest,
  ProposalState,
  ProposalStatus,
} from "./types.js";

export type Clock = () => string;

export function propose(
  ledgerPath: string,
  policy: Policy,
  request: ProposalRequest,
  clock: Clock = () => new Date().toISOString(),
): ProposalState {
  validateRequest(request);
  const requestHash = hash(
    stableStringify({ action: request.action, target: request.target, payload: request.payload }),
  );
  const proposals = rebuildState(readEvents(ledgerPath));
  const existing = [...proposals.values()].find(
    (proposal) => proposal.idempotencyKey === request.idempotencyKey,
  );
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ReviewGateError(
        "Idempotency key was already used for a different request",
        409,
        "idempotency_conflict",
      );
    }
    return existing;
  }

  const decision = evaluatePolicy(policy, request);
  const timestamp = clock();
  const state: ProposalState = {
    id: `rg_${hash(request.idempotencyKey).slice(0, 16)}`,
    idempotencyKey: request.idempotencyKey,
    requestHash,
    action: request.action,
    target: request.target,
    payload: request.payload,
    requestedBy: request.requestedBy?.trim() || "automation",
    risk: decision.risk,
    status: decision.status,
    reason: decision.reason,
    createdAt: timestamp,
  };
  if (decision.status === "approved") {
    state.decidedAt = timestamp;
    state.decidedBy = "policy";
    state.decisionNote = "low-risk auto-approval";
  }
  appendEvent(ledgerPath, { type: "proposal.created", at: timestamp, proposal: state });
  return state;
}

export function decide(
  ledgerPath: string,
  proposalId: string,
  decision: "approved" | "rejected",
  actor: string,
  note = "",
  clock: Clock = () => new Date().toISOString(),
): ProposalState {
  if (!actor.trim()) {
    throw new ReviewGateError("Decision actor is required", 400, "invalid_actor");
  }
  const proposals = rebuildState(readEvents(ledgerPath));
  const proposal = proposals.get(proposalId);
  if (!proposal) throw new ReviewGateError("Proposal not found", 404, "not_found");
  if (proposal.status !== "pending") {
    throw new ReviewGateError(
      `Proposal is ${proposal.status}; only pending proposals can be decided`,
      409,
      "invalid_state",
    );
  }
  const timestamp = clock();
  appendEvent(ledgerPath, {
    type: "proposal.decided",
    at: timestamp,
    proposalId,
    decision,
    actor: actor.trim(),
    note: note.trim(),
  });
  return getProposal(ledgerPath, proposalId);
}

export function listProposals(ledgerPath: string, status?: ProposalStatus): ProposalState[] {
  return [...rebuildState(readEvents(ledgerPath)).values()]
    .filter((proposal) => status === undefined || proposal.status === status)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getProposal(ledgerPath: string, proposalId: string): ProposalState {
  const proposal = rebuildState(readEvents(ledgerPath)).get(proposalId);
  if (!proposal) throw new ReviewGateError("Proposal not found", 404, "not_found");
  return proposal;
}

export function exportApproved(ledgerPath: string, proposalId: string): ApprovedEnvelope {
  const proposal = getProposal(ledgerPath, proposalId);
  if (proposal.status !== "approved" || !proposal.decidedAt || !proposal.decidedBy) {
    throw new ReviewGateError(
      "Only approved proposals can be exported",
      409,
      "not_approved",
    );
  }
  return {
    proposalId: proposal.id,
    idempotencyKey: proposal.idempotencyKey,
    action: proposal.action,
    target: proposal.target,
    payload: proposal.payload,
    approvedAt: proposal.decidedAt,
    approvedBy: proposal.decidedBy,
  };
}

function validateRequest(request: ProposalRequest): void {
  if (!request.action?.trim() || !request.target?.trim()) {
    throw new ReviewGateError("Action and target are required");
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(request.idempotencyKey ?? "")) {
    throw new ReviewGateError(
      "Idempotency key must be 1-128 letters, numbers, dots, underscores, colons, or hyphens",
    );
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
