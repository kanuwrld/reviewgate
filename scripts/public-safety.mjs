#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { execFileSync } from "node:child_process";

const SECRET_PATTERNS = [
  ["GitHub token", /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})/],
  ["OpenAI-style key", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Stripe live key", /(?:sk|rk)_live_[A-Za-z0-9]{16,}/],
  ["PyPI token", /pypi-AgEIcHlwaS5vcmcC[A-Za-z0-9_-]{20,}/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["credential-bearing URL", /[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i],
];

const FORBIDDEN_SUFFIXES = new Set([".key", ".keystore", ".p12", ".pem", ".pfx"]);
const FORBIDDEN_NAMES = new Set([
  ".env",
  "credentials.json",
  "credentials.yaml",
  "credentials.yml",
  "id_ed25519",
  "id_rsa",
  "secret.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
]);

function git(...arguments_) {
  return execFileSync("git", arguments_, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isForbiddenPath(path) {
  const name = basename(path).toLowerCase();
  if (FORBIDDEN_NAMES.has(name) || FORBIDDEN_SUFFIXES.has(extname(path).toLowerCase())) return true;
  return name.startsWith(".env.") && name !== ".env.example";
}

function scanText(label, text) {
  const findings = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const [ruleName, pattern] of SECRET_PATTERNS) {
      if (pattern.test(line)) findings.push(`${label}:${index + 1} matches ${ruleName}`);
    }
  }
  return findings;
}

const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
const historicalPaths = git("log", "--all", "--name-only", "--pretty=format:")
  .split(/\r?\n/)
  .map((item) => item.trim())
  .filter(Boolean);
const findings = [...new Set([...tracked, ...historicalPaths])]
  .filter(isForbiddenPath)
  .map((path) => `forbidden tracked or historical path: ${path}`);

for (const path of tracked) {
  try {
    findings.push(...scanText(path, readFileSync(path).toString("utf8")));
  } catch (error) {
    findings.push(`cannot inspect tracked file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

findings.push(...scanText("git-history", git("log", "--all", "-p", "--format=")));

if (findings.length > 0) {
  process.stderr.write("Public safety check failed. Matched values are intentionally hidden.\n");
  for (const finding of findings) process.stderr.write(`- ${finding}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Public safety check passed: ${tracked.length} tracked files and full Git history scanned.\n`,
  );
}
