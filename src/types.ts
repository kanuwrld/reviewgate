export type Risk = "low" | "medium" | "high";
export type PolicyMode = "auto_approve" | "approval_required" | "block";
export type ProposalStatus = "pending" | "approved" | "rejected" | "blocked";

export interface ActionRule {
  risk: Risk;
  mode: PolicyMode;
  allowedTargets?: string[];
  maxPayloadBytes?: number;
}

export interface Policy {
  version: number;
  actions: Record<string, ActionRule>;
}

export interface ProposalRequest {
  action: string;
  target: string;
  payload: unknown;
  idempotencyKey: string;
  requestedBy?: string;
}

export interface ProposalState {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  action: string;
  target: string;
  payload: unknown;
  requestedBy: string;
  risk: Risk | "unknown";
  status: ProposalStatus;
  reason: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
}

export interface ProposalEvent {
  type: "proposal.created";
  at: string;
  proposal: ProposalState;
}

export interface DecisionEvent {
  type: "proposal.decided";
  at: string;
  proposalId: string;
  decision: "approved" | "rejected";
  actor: string;
  note: string;
}

export type LedgerEvent = ProposalEvent | DecisionEvent;

export interface ApprovedEnvelope {
  proposalId: string;
  idempotencyKey: string;
  action: string;
  target: string;
  payload: unknown;
  approvedAt: string;
  approvedBy: string;
}
