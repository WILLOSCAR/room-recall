# Nestory performance report

Generated: 2026-08-11T15:53:21.706Z
Runtime: node v26.3.1
Fixture: 10066 records / 2021 belongings
Durability: same-directory atomic rename acknowledged by the OS page cache; no fsync claim
HTTP workloads: two keys explicitly prewarmed before measurement; 320 unique exact fixture names; query cache cold; lazy search-index construction included; 320 unique exact fixture names; legacy partial-token semantics make each a broad match set; opt-in /search?limit=100 returns 100 summaries; 64 broad repeated /search?q=shared%20term requests preserve the original full bare-array compatibility response.

Performance budgets are reported locally and are not deterministic correctness gates.

| Fixture | Metric | p50 ms | p95 ms | p99 ms | max ms | budget ms | result |
|---|---|---:|---:|---:|---:|---:|---|
| seed | locate | 0.000 | 0.001 | 0.005 | 0.465 | < 5 | pass |
| seed | attention | 0.000 | 0.000 | 0.002 | 0.584 | < 5 | pass |
| seed | containers | 0.000 | 0.000 | 0.002 | 0.004 | < 5 | pass |
| seed | memory write | 0.205 | 0.323 | 1.608 | 4.856 | < 10 | pass |
| seed | cold Store start | 0.688 | 1.151 | 2.138 | 2.138 | < 25 | pass |
| seed | compact export text | 0.063 | 0.071 | 0.104 | 0.104 | < 10 | pass |
| seed | export transfer clone | 0.180 | 0.198 | 0.204 | 0.204 | < 25 | pass |
| household | locate | 0.000 | 0.000 | 0.001 | 0.038 | < 5 | pass |
| household | attention | 0.000 | 0.000 | 0.000 | 6.999 | < 5 | pass |
| household | containers | 0.000 | 0.000 | 0.000 | 0.000 | < 5 | pass |
| household | memory write | 2.862 | 4.520 | 8.675 | 9.714 | < 10 | pass |
| household | cold Store start | 24.008 | 32.738 | 32.738 | 32.738 | < 100 | pass |
| household | compact export text | 5.512 | 5.851 | 5.946 | 5.946 | < 10 | pass |
| household | export transfer clone | 15.324 | 16.756 | 23.588 | 23.588 | < 25 | pass |
| household | atomic file write | 17.674 | 19.765 | 23.524 | 23.524 | < 25 | pass |
| household | HTTP locate warm repeated @32 | 4.455 | 9.107 | 10.756 | 11.177 | < 50 | pass |
| household | HTTP locate 320 distinct @32 | 7.570 | 29.348 | 33.101 | 33.749 | < 50 | pass |
| household | HTTP bounded search 320 distinct @32 | 9.928 | 29.728 | 34.316 | 35.071 | < 50 | pass |
| household | HTTP full search compatibility residual @32 | 201.255 | 244.502 | 251.349 | 251.349 | not budgeted | compatibility residual |

HTTP warm-repeated throughput: 4780.374 requests/s
HTTP 320-distinct throughput: 2746.302 requests/s
HTTP bounded-search throughput: 2322.405 requests/s
HTTP response bytes (mean / max): bounded search 22239.000 / 22239; full compatibility search 2528001.000 / 2528001.
HTTP full-search compatibility throughput: 140.507 requests/s
Compatibility note: GET /search without limit still returns the original full bare array and may exceed the 50 ms budget for broad household queries.
Household export bytes: compact 2584795 / pretty 4180824
