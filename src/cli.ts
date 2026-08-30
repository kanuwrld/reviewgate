#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ReviewGateError } from "./errors.js";
import { initializeLedger } from "./ledger.js";
import { loadPolicy } from "./policy.js";
import { createReviewGateServer } from "./server.js";
import { decide, exportApproved, listProposals, propose } from "./service.js";
import type { ProposalStatus } from "./types.js";

const HELP = `ReviewGate — human approval for AI-proposed actions

Usage:
  reviewgate init --ledger <events.jsonl>
  reviewgate propose --policy <policy.json> --ledger <events.jsonl> --action <name> --target <target> --payload <json-file> --idempotency-key <key> [--requested-by <name>]
  reviewgate list --ledger <events.jsonl> [--status pending|approved|rejected|blocked]
  reviewgate decide <proposal-id> --ledger <events.jsonl> (--approve|--reject) --actor <name> [--note <text>]
  reviewgate export <proposal-id> --ledger <events.jsonl> [--output <file>]
  reviewgate serve --policy <policy.json> --ledger <events.jsonl> [--host 127.0.0.1] [--port 8788]
  reviewgate demo --policy <policy.json> --ledger <events.jsonl>
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (!command || command === "help" || command === "--help") {
      process.stdout.write(HELP);
      return 0;
    }
    if (command === "init") {
      const ledger = requiredOption(args, "--ledger");
      initializeLedger(ledger);
      print({ ledger: resolve(ledger), initialized: true });
      return 0;
    }
    if (command === "propose") {
      const policy = loadPolicy(requiredOption(args, "--policy"));
      const ledger = requiredOption(args, "--ledger");
      const payloadPath = requiredOption(args, "--payload");
      const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as unknown;
      const requestedBy = option(args, "--requested-by");
      const request = {
        action: requiredOption(args, "--action"),
        target: requiredOption(args, "--target"),
        payload,
        idempotencyKey: requiredOption(args, "--idempotency-key"),
        ...(requestedBy ? { requestedBy } : {}),
      };
      print(propose(ledger, policy, request));
      return 0;
    }
    if (command === "list") {
      const rawStatus = option(args, "--status");
      const status = rawStatus as ProposalStatus | undefined;
      if (status && !["pending", "approved", "rejected", "blocked"].includes(status)) {
        throw new ReviewGateError("Invalid status filter");
      }
      print({ proposals: listProposals(requiredOption(args, "--ledger"), status) });
      return 0;
    }
    if (command === "decide") {
      const proposalId = positional(args, 0, "proposal id");
      const approve = args.includes("--approve");
      const reject = args.includes("--reject");
      if (approve === reject) throw new ReviewGateError("Choose exactly one of --approve or --reject");
      print(
        decide(
          requiredOption(args, "--ledger"),
          proposalId,
          approve ? "approved" : "rejected",
          requiredOption(args, "--actor"),
          option(args, "--note") ?? "",
        ),
      );
      return 0;
    }
    if (command === "export") {
      const envelope = exportApproved(
        requiredOption(args, "--ledger"),
        positional(args, 0, "proposal id"),
      );
      const output = option(args, "--output");
      if (output) {
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
      } else {
        print(envelope);
      }
      return 0;
    }
    if (command === "serve") {
      const ledger = requiredOption(args, "--ledger");
      const policy = loadPolicy(requiredOption(args, "--policy"));
      const host = option(args, "--host") ?? "127.0.0.1";
      const port = Number(option(args, "--port") ?? "8788");
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ReviewGateError("Port must be an integer between 1 and 65535");
      }
      const server = createReviewGateServer(ledger, policy);
      server.listen(port, host, () => {
        process.stdout.write(`ReviewGate listening on http://${host}:${port}\n`);
      });
      return 0;
    }
    if (command === "demo") {
      const ledger = requiredOption(args, "--ledger");
      if (existsSync(ledger)) rmSync(ledger);
      const policy = loadPolicy(requiredOption(args, "--policy"));
      const proposal = propose(ledger, policy, {
        action: "support.reply.draft",
        target: "ticket:DEMO-1042",
        payload: {
          subject: "Draft reply for fictional duplicate charge",
          body: "A human reviewer must approve this draft before any delivery connector can use it.",
        },
        idempotencyKey: "demo-1042-v1",
        requestedBy: "demo",
      });
      print({ proposal, pendingCount: listProposals(ledger, "pending").length });
      return proposal.status === "pending" ? 0 : 1;
    }
    throw new ReviewGateError(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`reviewgate: ${message}\n`);
    return error instanceof ReviewGateError ? (error.statusCode >= 500 ? 1 : 2) : 2;
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new ReviewGateError(`${name} requires a value`);
  return value;
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new ReviewGateError(`${name} is required`);
  return value;
}

function positional(args: string[], index: number, label: string): string {
  const positionals = args.filter((value, itemIndex) => {
    if (value.startsWith("--")) return false;
    return itemIndex === 0 || !args[itemIndex - 1]?.startsWith("--");
  });
  const value = positionals[index];
  if (!value) throw new ReviewGateError(`${label} is required`);
  return value;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
