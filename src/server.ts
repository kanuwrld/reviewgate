import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { ReviewGateError } from "./errors.js";
import { decide, exportApproved, getProposal, listProposals, propose } from "./service.js";
import type { Policy, ProposalRequest, ProposalStatus } from "./types.js";

const MAX_BODY_BYTES = 1_048_576;

export function createReviewGateServer(ledgerPath: string, policy: Policy): Server {
  return createServer(async (request, response) => {
    try {
      await route(request, response, ledgerPath, policy);
    } catch (error) {
      const known = error instanceof ReviewGateError;
      sendJson(response, known ? error.statusCode : 500, {
        error: known ? error.code : "internal_error",
        message: known ? error.message : "Internal server error",
      });
    }
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  ledgerPath: string,
  policy: Policy,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://reviewgate.local");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/proposals") {
    const rawStatus = url.searchParams.get("status") ?? undefined;
    const status = parseStatus(rawStatus);
    sendJson(response, 200, { proposals: listProposals(ledgerPath, status) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/proposals") {
    const body = (await readJson(request)) as ProposalRequest;
    sendJson(response, 201, propose(ledgerPath, policy, body));
    return;
  }

  const decisionMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)\/decisions$/);
  if (request.method === "POST" && decisionMatch?.[1]) {
    const body = await readJson(request);
    if (!isRecord(body) || (body.decision !== "approve" && body.decision !== "reject")) {
      throw new ReviewGateError("decision must be approve or reject");
    }
    sendJson(
      response,
      200,
      decide(
        ledgerPath,
        decisionMatch[1],
        body.decision === "approve" ? "approved" : "rejected",
        typeof body.actor === "string" ? body.actor : "",
        typeof body.note === "string" ? body.note : "",
      ),
    );
    return;
  }

  const exportMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)\/export$/);
  if (request.method === "GET" && exportMatch?.[1]) {
    sendJson(response, 200, exportApproved(ledgerPath, exportMatch[1]));
    return;
  }

  const proposalMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)$/);
  if (request.method === "GET" && proposalMatch?.[1]) {
    sendJson(response, 200, getProposal(ledgerPath, proposalMatch[1]));
    return;
  }
  throw new ReviewGateError("Route not found", 404, "not_found");
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new ReviewGateError("Request body exceeds 1 MiB", 413, "body_too_large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ReviewGateError("Request body must be valid JSON");
  }
}

function parseStatus(status: string | undefined): ProposalStatus | undefined {
  if (status === undefined) return undefined;
  if (["pending", "approved", "rejected", "blocked"].includes(status)) {
    return status as ProposalStatus;
  }
  throw new ReviewGateError("Invalid status filter");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
