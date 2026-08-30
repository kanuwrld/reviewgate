# Contributing

ReviewGate changes must preserve deny-by-default behavior and the separation
between approval and execution.

1. Open an issue for policy or ledger behavior changes.
2. Add a failing test before the fix when practical.
3. Use fictional targets and payloads in all fixtures.
4. Run `npm test` and `npm run check`.
5. Document new trust boundaries in the README and security policy.

Security reports belong in a private advisory.
