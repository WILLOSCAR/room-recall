# Nestory performance report

Generated: 2026-08-17T14:18:18.449Z
Runtime: node v26.3.1
Fixture: 10066 records / 2021 belongings
Durability: same-directory atomic rename acknowledged by the OS page cache; no fsync claim
HTTP workloads: two keys explicitly prewarmed before measurement; 320 unique exact fixture names; query cache cold; lazy search-index construction included; 320 unique exact fixture names; legacy partial-token semantics make each a broad match set; opt-in /search?limit=100 returns 100 summaries; 64 broad repeated /search?q=shared%20term requests preserve the original full bare-array compatibility response.

Performance budgets are reported locally and are not deterministic correctness gates.

| Fixture | Metric | p50 ms | p95 ms | p99 ms | max ms | budget ms | result |
|---|---|---:|---:|---:|---:|---:|---|
| seed | locate | 0.000 | 0.001 | 0.002 | 0.424 | < 5 | pass |
| seed | attention | 0.000 | 0.000 | 0.006 | 0.513 | < 5 | pass |
| seed | containers | 0.000 | 0.000 | 0.002 | 0.013 | < 5 | pass |
| seed | memory write | 0.196 | 0.308 | 1.191 | 5.623 | < 10 | pass |
| seed | cold Store start | 0.661 | 1.121 | 1.935 | 1.935 | < 25 | pass |
| seed | compact export text | 0.063 | 0.064 | 0.097 | 0.097 | < 10 | pass |
| seed | export transfer clone | 0.176 | 0.178 | 0.184 | 0.184 | < 25 | pass |
| household | locate | 0.000 | 0.000 | 0.001 | 0.038 | < 5 | pass |
| household | attention | 0.000 | 0.000 | 0.000 | 6.120 | < 5 | pass |
| household | containers | 0.000 | 0.000 | 0.000 | 0.003 | < 5 | pass |
| household | memory write | 2.729 | 4.094 | 9.552 | 9.559 | < 10 | pass |
| household | cold Store start | 22.424 | 28.537 | 28.537 | 28.537 | < 100 | pass |
| household | compact export text | 5.352 | 5.938 | 5.992 | 5.992 | < 10 | pass |
| household | export transfer clone | 14.737 | 15.897 | 16.375 | 16.375 | < 25 | pass |
| household | atomic file write | 15.866 | 16.884 | 20.463 | 20.463 | < 25 | pass |
| household | HTTP locate warm repeated @32 | 4.133 | 11.356 | 12.732 | 12.985 | < 50 | pass |
| household | HTTP locate 320 distinct @32 | 8.728 | 33.749 | 38.206 | 38.880 | < 50 | pass |
| household | HTTP bounded search 320 distinct @32 | 9.888 | 25.686 | 30.001 | 31.180 | < 50 | pass |
| household | HTTP full search compatibility residual @32 | 180.235 | 340.233 | 349.871 | 349.871 | not budgeted | compatibility residual |

HTTP warm-repeated throughput: 5141.595 requests/s
HTTP 320-distinct throughput: 2531.113 requests/s
HTTP bounded-search throughput: 2467.391 requests/s
HTTP response bytes (mean / max): bounded search 22239.000 / 22239; full compatibility search 2528001.000 / 2528001.
HTTP full-search compatibility throughput: 118.025 requests/s
Compatibility note: GET /search without limit still returns the original full bare array and may exceed the 50 ms budget for broad household queries.
Household export bytes: compact 2584795 / pretty 4180824
