# 03 - Bound and streamline HTTP

Type: implementation
Status: ready-for-agent
Blocked by: 01

Keep the HTTP service a transport adapter over Store/AgentToolkit. Add bounded bodies, explicit error/status mapping, same-origin/local origin policy, cheap health metadata, request abort handling, and cache/security headers without creating a second write model.

Done when oversized/malformed requests are deterministic, wildcard CORS is gone, health avoids cloning the Ledger, all existing routes behave compatibly, and concurrency benchmarks meet or clearly report the contract.
