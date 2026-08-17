# Full-stack low-latency and loss-safe runtime

Status: ready-for-agent
Branch: `codex/full-stack-low-latency`

## Outcome

Make the current Nestory V1 console feel immediate at household scale without weakening its trust model. The preserved domain path is:

`Observation -> Proposal -> Review -> Commit Ledger -> Place Graph`

Three.js remains a read-only projection adapter. A UI, HTTP route, agent tool, cache, or spatial scene must never become a second mutation path.

## Confirmed public seams

Tests observe behavior only through:

1. `Store` domain commands, queries, subscription, export/import, and reload.
2. `StorageLike` and the file-backed storage adapter as persistence boundaries.
3. The local HTTP API as a transport adapter over the same domain commands.
4. Browser-visible routes, focus, canvas lifecycle, network resources, and one-paint-per-action behavior.

Implementation helpers, indexes, cache keys, and scheduling primitives are not test seams.

## Invariants

- Within one Store / single-writer boundary, an acknowledged command is either durably stored and projected, or reports a persistence error. It must never report success after a failed write. Concurrent browser tabs and independent Store instances are explicitly outside this prototype guarantee because `localStorage` has no cross-instance atomic compare-and-swap.
- A failed write does not publish a new projection or notify subscribers.
- A corrupt durable payload is distinguishable from an empty home; it never silently falls back to seed and overwrites the damaged file.
- One logical Store command publishes at most one coherent state notification.
- Listener failures are isolated from the durable command result and from other listeners.
- Import is validated and staged before it can replace durable or in-memory state.
- The current JSON export remains schema version 2 compatible.
- File persistence uses a cached in-process image and atomic replacement. The prototype remains a documented single-writer service.
- HTTP request bodies are bounded. Cross-origin mutation is not enabled by wildcard CORS.
- One browser action causes at most one full view commit. Stale focus or spatial callbacks cannot act on a newer view.
- Non-spatial entry routes do not load Three.js. A settled static spatial scene consumes no continuous animation frames.
- Mobile primary navigation retains access to every major surface.

## Performance contract

Benchmark both the seed fixture and a household-scale fixture of about 10,000 ledger records / 2,000 belongings. Report p50, p95, p99, maximum, throughput where applicable, fixture size, runtime version, and durability level.

- warm in-process query p95: `< 5 ms`
- in-memory domain write p95: `< 10 ms`
- local file write p95: `< 25 ms` (prototype atomic rename; no fsync claim)
- localhost HTTP `/locate` and opt-in bounded `/search?limit=...` p95 at concurrency 32: `< 50 ms`; the backward-compatible full `/search` array is measured as an explicit unbounded residual, not generalized into this claim
- ordinary UI interaction to next paint p95: `< 100 ms`
- settled static 3D: zero continuous RAF
- non-spatial cold entry: zero Three.js requests

Correctness gates are deterministic. Performance thresholds are reported by the benchmark command and become hard CI gates only after a stable runner is selected.

For the selected local browser runner, the UI threshold is measured conservatively from a native navigation-button action until Chrome returns pixels from `Page.captureScreenshot({ fromSurface: true })`. That path includes DOM/style/layout, compositing, surface readback, PNG encoding, two CDP round trips, and controller overhead. DOM-commit time and raw headless RAF latency remain separately labeled diagnostics; neither is allowed to stand in for presentation. Physical-display scan-out is not claimed.

## Chosen design

This slice deepens the existing runtime rather than replacing every caller at once:

- A single transactional append path owns stage -> persist -> publish ordering.
- Read indexes and revision-scoped memoization stay private to the Store.
- A render coordinator coalesces synchronous Store notifications and handler requests into one commit and owns cancellation of stale scheduled work.
- Spatial loading is a dynamic adapter boundary.
- File and browser persistence remain replaceable adapters.

The target external runtime shape is `recall(intent)` plus `apply(input, metadata)` opened by a composition root. Revision/idempotency, append-only framed journals, IndexedDB media storage, remote event cursors, and multi-device conflict semantics are follow-up architecture, not speculative requirements for this bounded prototype hardening pass.

## Out of scope

- Claiming production-grade crash durability or multi-process file locking.
- Remote sync, authentication accounts, household sharing, or offline conflict resolution.
- Replacing the UI with a framework or building a general virtual DOM.
- Making 3D a write surface or a product requirement.
- Replacing the validated V1 domain vocabulary with generic CRUD terminology.
- Treating technical benchmarks as evidence of product desirability.

## Delivery

- All existing verification assertions pass.
- New failure, recovery, request-boundary, render-coalescing, lazy-load, mobile-nav, and scale tests pass.
- `npm run check`, `npm run build`, `npm run verify`, and `git diff --check` pass.
- A before/after benchmark report and desktop/mobile browser evidence are regenerated.
- Standards and spec reviews run independently against this spec and repository guidance.
