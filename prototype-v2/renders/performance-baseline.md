# Nestory pre-optimization performance baseline

Captured: 2026-08-11, before the Store query cache and render/runtime hardening

Runtime: Node v26.3.1 on the same local machine used for the final report

Fixture: 10,118 Commit Ledger records / 2,021 Belongings

This was the read-only diagnostic probe that motivated the work. It retained p95 (and one observed file maximum), not the full sample series, so missing p50/p99 values are intentionally not reconstructed. The final `npm run benchmark` report is the repeatable full-distribution measurement.

| Metric | Baseline p95 ms | Budget ms | Baseline result |
|---|---:|---:|---|
| warm locate | 5.180 | < 5 | fail |
| attention projection | 7.830 | < 5 | fail |
| in-memory domain write | 19.590 | < 10 | fail |
| local file write | 33.617 | < 25 | fail (observed max 108 ms) |
| localhost HTTP locate @32 | 124.349 | < 50 | fail |

An intermediate formal run after atomic file persistence but before query memoization measured HTTP locate @32 at 90.999 ms p95 and 480.25 requests/s. That early workload, and the checkpoint below, repeatedly queried only a tiny key set; they are retained as warm-path history and are not evidence for distinct-query latency.

Durability at baseline: synchronous whole-image JSON replacement; failures were swallowed by the Store. This is not semantically equivalent to the final stage -> validate -> persist -> publish contract, so latency is never presented as the only success criterion.

## Checkpoint before the second system pass

The first hardened implementation (355/355 assertions) was measured again on the same 10,066-record / 2,021-belonging fixture before this pass:

| Metric | Checkpoint p95 ms |
|---|---:|
| in-memory domain write | 6.052 |
| atomic local file write | 21.081 |
| localhost HTTP locate @32 (warm repeated) | 32.284 |
| HTTP throughput | 3,382.7 requests/s |

Independent browser probes at that checkpoint found the remaining UI bottleneck: Belongings rendered 2,021 rows / 40,600 elements at 135.9 ms p95, while Commit Ledger rendered 8,039 rows / 74,523 elements in 480.8 ms. A 10,066-record persisted Store start measured 56.6 ms p95. Those probes motivated fixed, replacing presentation pages and removal of the redundant post-parse ledger clone in the current report.

The final repeatable benchmark names the workloads separately. On the same 10,066-record / 2,021-belonging fixture, 320 distinct, query-cache-cold `/locate` requests at concurrency 32 include lazy search-index construction; the opt-in bounded `/search?limit=100` projection is measured independently. The legacy no-limit `/search` response remains a deliberately unbudgeted compatibility residual and its latency and response bytes are reported rather than hidden. The independent browser report likewise separates DOM/layout, raw RAF, FCP, controller-ready, and compositor-surface metrics instead of treating one as another.
