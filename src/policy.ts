import { readFileSync } from "node:fs";

import { ReviewGateError } from "./errors.js";
import type { ActionRule, Policy, ProposalRequest, Risk } from "./types.js";

export interface PolicyDecision {
  status: "pending" | "approved" | "blocked";
  risk: Risk | "unknown";
  reason: string;
}

const RISKS = new Set<Risk>(["low", "medium", "high"]);
const MODES = new Set(["auto_approve", "approval_required", "block"]);
const SECRET_KEY = /(?:password|secret|token|api[_-]?key|authorization|cookie)/i;

export function loadPolicy(path: string): Policy {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ReviewGateError(
      `Cannot read policy ${path}: ${error instanceof Error ? error.message : String(error)}`,
      400,
      "invalid_policy",
    );
  }
  return validatePolicy(value);
}

export function validatePolicy(value: unknown): Policy {
  if (!isRecord(value) || !Number.isInteger(value.version) || !isRecord(value.actions)) {
    throw new ReviewGateError(
      "Policy requires an integer version and an actions object",
      400,
      "invalid_policy",
    );
  }

  const actions: Record<string, ActionRule> = {};
  for (const [action, rawRule] of Object.entries(value.actions)) {
    if (!action.trim() || !isRecord(rawRule)) {
      throw new ReviewGateError(`Invalid policy rule for ${action || "<empty>"}`, 400, "invalid_policy");
    }
    if (!RISKS.has(rawRule.risk as Risk) || !MODES.has(String(rawRule.mode))) {
      throw new ReviewGateError(`Rule ${action} has invalid risk or mode`, 400, "invalid_policy");
    }
    if (rawRule.risk === "high" && rawRule.mode === "auto_approve") {
      throw new ReviewGateError(
        `Rule ${action} cannot auto-approve a high-risk action`,
        400,
        "invalid_policy",
      );
    }
    const rule: ActionRule = {
      risk: rawRule.risk as Risk,
      mode: rawRule.mode as ActionRule["mode"],
    };
    if (rawRule.allowedTargets !== undefined) {
      if (!Array.isArray(rawRule.allowedTargets) || !rawRule.allowedTargets.every(isNonEmptyString)) {
        throw new ReviewGateError(
          `Rule ${action}.allowedTargets must be a non-empty string array`,
          400,
          "invalid_policy",
        );
      }
      rule.allowedTargets = [...rawRule.allowedTargets];
    }
    if (rawRule.maxPayloadBytes !== undefined) {
      if (!Number.isInteger(rawRule.maxPayloadBytes) || Number(rawRule.maxPayloadBytes) <= 0) {
        throw new ReviewGateError(
          `Rule ${action}.maxPayloadBytes must be a positive integer`,
          400,
          "invalid_policy",
        );
      }
      rule.maxPayloadBytes = Number(rawRule.maxPayloadBytes);
    }
    actions[action] = rule;
  }
  return { version: Number(value.version), actions };
}

export function evaluatePolicy(policy: Policy, request: ProposalRequest): PolicyDecision {
  const rule = policy.actions[request.action];
  if (!rule) {
    return { status: "blocked", risk: "unknown", reason: "action is not declared in policy" };
  }

  if (rule.allowedTargets && !rule.allowedTargets.some((pattern) => globMatches(pattern, request.target))) {
    return { status: "blocked", risk: rule.risk, reason: "target is outside the action allowlist" };
  }

  const payloadText = stableStringify(request.payload);
  const payloadBytes = Buffer.byteLength(payloadText, "utf8");
  if (rule.maxPayloadBytes !== undefined && payloadBytes > rule.maxPayloadBytes) {
    return {
      status: "blocked",
      risk: rule.risk,
      reason: `payload is ${payloadBytes} bytes; limit is ${rule.maxPayloadBytes}`,
    };
  }

  const secretPath = findSecretLikeKey(request.payload);
  if (secretPath) {
    return {
      status: "blocked",
      risk: rule.risk,
      reason: `payload contains a secret-like key at ${secretPath}`,
    };
  }

  if (rule.mode === "block") {
    return { status: "blocked", risk: rule.risk, reason: "action is disabled by policy" };
  }
  if (rule.mode === "auto_approve") {
    return { status: "approved", risk: rule.risk, reason: "low-risk action approved by policy" };
  }
  return { status: "pending", risk: rule.risk, reason: "human approval required" };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

function findSecretLikeKey(value: unknown, path = "payload"): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecretLikeKey(value[index], `${path}.${index}`);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SECRET_KEY.test(key)) return childPath;
    const found = findSecretLikeKey(child, childPath);
    if (found) return found;
  }
  return undefined;
}

function globMatches(pattern: string, value: string): boolean {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`, "i").test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
