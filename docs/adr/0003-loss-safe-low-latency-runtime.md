# ADR 0003: Use one loss-safe low-latency runtime boundary

Date: 2026-08-11

Status: accepted

## Context

The prototype originally replayed and serialized the whole Commit Ledger on most public operations, rebuilt the browser shell on every notification, loaded Three.js on non-spatial entry paths, and treated persistence failures as if a write had succeeded. Those behaviors made household-scale latency unpredictable and could let the UI acknowledge state that was not durable.

The domain path remains `Observation -> Proposal -> Review -> Commit Ledger -> Place Graph`. Performance work must not introduce a mutable cache, HTTP route, browser component, Agent tool, or Three.js scene as a second source of truth.

## Decision

1. Within one Store / single-writer boundary, a command executes as one transaction: stage records, structurally validate new output, derive the candidate Place Graph, durably persist, then publish one revision. Failure restores the prior ledger and projection and is visible to the caller.
2. Import validates the complete record shape and replay semantics before replacement. Import also carries an expected Store revision so an asynchronous file or HTTP read cannot overwrite a command acknowledged in the meantime.
3. Reset appends one `reset_to_seed` Commit. Its immutable baseline is included in the schema-v2 envelope, with a deterministic prefix fallback for older v2 exports, so reload does not regenerate history from the current clock.
4. Subscriber delivery is synchronous and FIFO by immutable revision. A Store command invoked from inside a subscriber is rejected with a typed `ReentrantStoreCommandError` before it stages or persists anything; callers must schedule follow-up commands after the current notification returns. This fail-fast boundary keeps the synchronous API from acknowledging hidden queued writes or mixing query caches across revisions.
5. The local file adapter caches one in-process image and replaces a same-directory temporary file atomically. It is a single-writer prototype guarantee acknowledged at the operating-system page cache; it does not claim `fsync`, multi-process locking, or production crash durability.
6. Query indexes and time-aware caches remain private to Store. Public Catalog, Place Graph, and query projections are deeply read-only; exports are detached transfer copies. Time-derived caches expire at the exact next record-age boundary.
7. The browser uses one render coordinator, preserves unchanged shell and spatial islands, cancels stale focus/media/spatial work, and dynamically loads the Three.js adapter only for visible spatial surfaces. Belongings and Commit Ledger render complete query results through fixed 100-row pages; Review uses fixed 20-card pages because each evidence card is structurally heavier. Page changes replace rather than accumulate DOM and move focus to the first newly visible record. These browser windows are presentation state, never a second query truth.
8. HTTP and Agent adapters bound request bodies, tool-call rounds/counts, result projection, and LLM duration before dispatch. They call the same Store commands and do not own domain state. Existing `GET /search` keeps its full bare-array response for compatibility; callers can opt into `limit`/`offset`, which uses `Store.searchBelongingsPage` to rank the complete match set but materialize and serialize only the requested summary window. This is bounded transport projection, not database-level pagination or a sublinear search claim.
9. Mutating HTTP routes accept an optional `Idempotency-Key`. This includes `/ask`, because an otherwise conversational request can dispatch `start_operation`; read-only Ask requests remain compatible and may use the same optional guard. A process-local `WeakMap` gives every server exposing the same Store object one Store-scoped guard. The guard hashes the route plus recursively key-sorted canonical JSON, installs one shared in-flight promise before dispatch, replays the exact completed response for the same fingerprint, and rejects key reuse with different input. Completed response bodies are FIFO bounded to 256 entries and a hard aggregate 8 MiB budget; pending entries are never evicted to admit newer work. If one successful response alone exceeds that budget, both the first request and its retries receive the same 2xx bounded completion receipt (original status, byte count, and SHA-256) instead of an error or an immediately-evicted response. Ordinary responses keep their existing shape.
10. JSON export has two explicit seams: `exportJson()` returns a detached mutable transfer object, while `exportJsonText()` serializes the private ledger directly for browser download and HTTP transfer. The latter is compact by default and avoids a household-sized clone plus a second serialization.
11. Browser presentation performance is measured outside the deterministic correctness harness. The selected runner times a public navigation action until Chrome returns compositor-surface pixels and uses `<100 ms` as the only UI presentation budget. DOM/layout time, raw headless RAF scheduling, cache-bypassed FCP, and application-ready time are reported separately and never relabeled as paint evidence.

## Consequences

- Within the declared single-Store / single-writer boundary, an acknowledged write is either present after reload or the caller receives an error; subscriber failure cannot reverse a durable command.
- Old version-2 exports remain importable. New exports add `baselineRecords` without changing the version number.
- Local HTTP import returns a conflict instead of discarding a concurrent acknowledged write.
- Warm reads use revision/time-aware caches, while distinct cold text queries use a private gram/token/kind candidate index and the original ranking rules. Both remain projections over the Commit Ledger, and index invalidation follows every published revision.
- Opt-in bounded HTTP search avoids allocating and transferring full Belonging detail projections. The compatibility `/search` response without `limit` remains intentionally unbounded and is not covered by the bounded-search latency claim.
- The browser can stay responsive and idle at zero continuous spatial animation frames without weakening keyboard, screen-reader, WebGL fallback, or Review behavior.
- HTTP retries with the same key are at-most-once only inside one process, for servers sharing the same Store object, while the bounded receipt remains cached. A newly constructed Store, a process restart, or another process does not share receipts; durable/restart-safe or multi-process idempotency is not claimed.
- Browser tabs that independently open the same `localStorage` home are multiple writers: there is no atomic compare-and-swap across those Store instances, so concurrent tabs can overwrite one another. Cross-tab coordination, a framed append journal, IndexedDB media, remote event cursors, authentication, multi-device merge semantics, durable idempotency, and production durability remain follow-up decisions rather than claims of this prototype.
