# 06 - Verify, review, and hand off

Type: review
Status: done
Blocked by: 02, 03, 04, 05

Run deterministic verification, benchmark before/after, desktop/mobile browser QA, WebGL fallback and mount/unmount checks, then independent Standards and Spec reviews. Fix all P0/P1 findings or record an explicit bounded residual.

Done when the branch is reproducible, the report distinguishes correctness from measured performance, and no commit, push, deployment, or hosting claim is made without separate evidence.

## Comments

- 2026-08-17: Done. Gates all green on branch `codex/full-stack-low-latency`:
  - `npm run verify` → 459/459 (strict tsc gate + PRD-mapped assertions + browser smoke). Settled spatial RAF callbacks: 0.
  - `npm run check`, `npm run build`, `git diff --check` → clean.
  - `npm run benchmark` (runtime) → budgeted metrics pass; full `/search` array reported as an explicit unbounded residual.
  - `npm run browser-benchmark` → `allSurfaceBudgetsPass: true` (interaction→captured-compositor-surface p95 70.7 ms < 100 ms). Correctness (deterministic assertions) and measured performance are reported separately, as ADR 0003 §11 requires. No push/deploy/hosting claim made.
- Independent **Standards + Spec** reviews ran as parallel sub-agents against baseline `main` (266c9ea).
  - Standards: no hard documented-standard violations; the diff faithfully implements ADR 0003 and honors the AGENTS.md read-only-projection rule (3D emits only CustomEvents/telemetry, no second mutation path). Judgement-call smells noted.
  - Spec: 0 correctness defects; all 12 invariants + performance contract met; over-reach traps (single-writer, no-fsync, not-DB-pagination, corrupt-vs-empty) correctly hedged, not over-promised.
- Findings actioned in `4a11640` (two zero-risk fixes; verify stayed 459/459):
  1. Removed dead `persist()`/`notify()` no-ops superseded by `transact()`.
  2. Centralized the triplicated domain vocab in `types.ts` (exported `OPERATION_STATUSES`/`CONTAINER_KINDS`; store + validator now import it).
- Recorded residuals (not fixed this pass — no correctness/standards impact):
  - **HTTP request-abort handling** (ticket 03): no `req` abort/close listener in `server.ts`; queued idempotent work runs after client disconnect. Outside ticket 03's "Done when"; low severity.
  - **Idempotency-Key subsystem is scope creep**: `spec.md` line 66 parks revision/idempotency as follow-up architecture and no ticket asks for it, yet the diff ships a full `IdempotencyGuard`. Kept because its ADR §9 hedging is careful and does not over-promise (at-most-once inside one process only); flagged so it is a deliberate, not silent, expansion.
  - Standards judgement-calls left as-is: duplicated pager handlers in `app.ts` (×4), repeated archetype-fallback expression, ~400-line `mountSpatialScene` (Divergent Change). Cleanup candidates, not blockers.
