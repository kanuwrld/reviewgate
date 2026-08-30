# Security Policy

## Supported scope

This repository is a local reference implementation. Its HTTP server has no
authentication and must not be exposed directly to a public or shared network.
The ledger may contain sensitive business payloads; store only minimized,
sanitized data and restrict filesystem access.

Run `npm run security:public` before every public push. CI scans tracked files
and the full Git history and hides any matched value from its output.

## Reporting a vulnerability

Do not include live credentials, customer payloads, or an unpatched exploit in a
public issue. External reporters should use **Security → Report a vulnerability**;
GitHub private vulnerability reporting is enabled. Repository collaborators may
create a private draft advisory under **Security → Advisories**. Include affected
versions, reproduction steps, impact, and a suggested mitigation when possible.
