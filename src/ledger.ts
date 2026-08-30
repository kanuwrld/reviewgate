import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { ReviewGateError } from "./errors.js";
import type { LedgerEvent, ProposalState } from "./types.js";

export function initializeLedger(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
}

export function readEvents(path: string): LedgerEvent[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as LedgerEvent;
    } catch (error) {
      throw new ReviewGateError(
        `Ledger ${path} is invalid at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        500,
        "ledger_corrupt",
      );
    }
  });
}

export function appendEvent(path: string, event: LedgerEvent): void {
  initializeLedger(path);
  const lockPath = `${path}.lock`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
    appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    const code = isNodeError(error) ? error.code : undefined;
    if (code === "EEXIST") {
      throw new ReviewGateError("Ledger is busy; retry the request", 409, "ledger_busy");
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (descriptor !== undefined && existsSync(lockPath)) unlinkSync(lockPath);
  }
}

export function rebuildState(events: LedgerEvent[]): Map<string, ProposalState> {
  const proposals = new Map<string, ProposalState>();
  for (const event of events) {
    if (event.type === "proposal.created") {
      if (proposals.has(event.proposal.id)) {
        throw new ReviewGateError(
          `Ledger contains duplicate proposal ${event.proposal.id}`,
          500,
          "ledger_corrupt",
        );
      }
      proposals.set(event.proposal.id, structuredClone(event.proposal));
      continue;
    }
    if (event.type !== "proposal.decided") {
      throw new ReviewGateError("Ledger contains an unknown event", 500, "ledger_corrupt");
    }
    const proposal = proposals.get(event.proposalId);
    if (!proposal || proposal.status !== "pending") {
      throw new ReviewGateError(
        `Ledger contains an invalid decision for ${event.proposalId}`,
        500,
        "ledger_corrupt",
      );
    }
    proposal.status = event.decision;
    proposal.decidedAt = event.at;
    proposal.decidedBy = event.actor;
    proposal.decisionNote = event.note;
    proposal.reason = event.decision === "approved" ? "approved by human reviewer" : "rejected by human reviewer";
  }
  return proposals;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
