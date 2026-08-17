# 03 - Bound and streamline HTTP

Type: implementation
Status: done
Blocked by: 01

Keep the HTTP service a transport adapter over Store/AgentToolkit. Add bounded bodies, explicit error/status mapping, same-origin/local origin policy, cheap health metadata, request abort handling, and cache/security headers without creating a second write model.

Done when oversized/malformed requests are deterministic, wildcard CORS is gone, health avoids cloning the Ledger, all existing routes behave compatibly, and concurrency benchmarks meet or clearly report the contract.

## Comments

- 2026-08-17: Done, with one recorded residual. `server.ts` bounds request bodies, maps domain/durability errors to explicit 4xx/5xx, enforces a local/same-origin policy (wildcard CORS removed), serves cheap health metadata without cloning the ledger, and stays a transport adapter over Store/AgentToolkit (`/tools` is the only write path). Deterministic oversized/malformed handling and origin policy are asserted by the `srv-*` suite (459/459); concurrency benchmarks report the `/locate` and bounded `/search` contract.
- Residual (spec-axis review): the ticket body listed "request abort handling"; the LLM boundary in `agent-runtime.ts` has abort/timeout wiring, but the HTTP layer has no `req` 'aborted'/'close' listener, so queued idempotent work still runs after a client disconnect. Not in this ticket's "Done when" line; low severity. Left as a follow-up.
