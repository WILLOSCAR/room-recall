# Nestory performance report

Generated: 2026-08-17T11:35:29.002Z
Runtime: node v26.3.1
Fixture: 10066 records / 2021 belongings
Durability: same-directory atomic rename acknowledged by the OS page cache; no fsync claim
HTTP workloads: two keys explicitly prewarmed before measurement; 320 unique exact fixture names; query cache cold; lazy search-index construction included; 320 unique exact fixture names; legacy partial-token semantics make each a broad match set; opt-in /search?limit=100 returns 100 summaries; 64 broad repeated /search?q=shared%20term requests preserve the original full bare-array compatibility response.

Performance budgets are reported locally and are not deterministic correctness gates.

| Fixture | Metric | p50 ms | p95 ms | p99 ms | max ms | budget ms | result |
|---|---|---:|---:|---:|---:|---:|---|
| seed | locate | 0.000 | 0.000 | 0.002 | 0.542 | < 5 | pass |
| seed | attention | 0.000 | 0.000 | 0.002 | 0.603 | < 5 | pass |
| seed | containers | 0.000 | 0.000 | 0.002 | 0.004 | < 5 | pass |
| seed | memory write | 0.248 | 0.664 | 2.579 | 8.669 | < 10 | pass |
| seed | cold Store start | 0.742 | 1.978 | 2.970 | 2.970 | < 25 | pass |
| seed | compact export text | 0.074 | 0.144 | 0.218 | 0.218 | < 10 | pass |
| seed | export transfer clone | 0.197 | 0.307 | 0.441 | 0.441 | < 25 | pass |
| household | locate | 0.000 | 0.000 | 0.002 | 0.045 | < 5 | pass |
| household | attention | 0.000 | 0.000 | 0.000 | 7.948 | < 5 | pass |
| household | containers | 0.000 | 0.000 | 0.000 | 0.001 | < 5 | pass |
| household | memory write | 3.219 | 5.176 | 9.548 | 10.746 | < 10 | pass |
| household | cold Store start | 25.295 | 31.220 | 31.220 | 31.220 | < 100 | pass |
| household | compact export text | 5.815 | 6.198 | 6.235 | 6.235 | < 10 | pass |
| household | export transfer clone | 15.573 | 17.604 | 23.936 | 23.936 | < 25 | pass |
| household | atomic file write | 19.242 | 22.077 | 25.451 | 25.451 | < 25 | pass |
| household | HTTP locate warm repeated @32 | 4.292 | 11.441 | 13.043 | 13.319 | < 50 | pass |
| household | HTTP locate 320 distinct @32 | 8.700 | 29.190 | 33.263 | 34.300 | < 50 | pass |
| household | HTTP bounded search 320 distinct @32 | 10.729 | 29.642 | 34.561 | 35.651 | < 50 | pass |
| household | HTTP full search compatibility residual @32 | 213.805 | 410.069 | 419.747 | 419.747 | not budgeted | compatibility residual |

HTTP warm-repeated throughput: 4846.823 requests/s
HTTP 320-distinct throughput: 2528.857 requests/s
HTTP bounded-search throughput: 2232.052 requests/s
HTTP response bytes (mean / max): bounded search 22239.000 / 22239; full compatibility search 2528001.000 / 2528001.
HTTP full-search compatibility throughput: 99.764 requests/s
Compatibility note: GET /search without limit still returns the original full bare array and may exceed the 50 ms budget for broad household queries.
Household export bytes: compact 2584795 / pretty 4180824
