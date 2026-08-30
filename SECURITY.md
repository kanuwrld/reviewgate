# Security Policy

## Supported scope

This repository is a local reference implementation. Its HTTP server has no
authentication and must not be exposed directly to a public or shared network.
The ledger may contain sensitive business payloads; store only minimized,
sanitized data and restrict filesystem access.

## Reporting a vulnerability

Use GitHub private vulnerability reporting. Do not include live credentials,
customer payloads, or an unpatched exploit in a public issue. Include affected
versions, reproduction steps, impact, and a suggested mitigation when possible.
