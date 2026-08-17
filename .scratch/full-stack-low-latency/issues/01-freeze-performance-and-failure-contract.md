# 01 - Freeze performance and failure contract

Type: test
Status: done
Blocked by: none

Add public-seam regression tests and a repeatable benchmark for seed and household-scale fixtures. Cover persistence failure, corrupt load, subscriber isolation, import staging, body size, duplicate render, lazy Three loading, and complete mobile navigation before changing the corresponding implementation.

Done when the new assertions fail for the intended current behavior, the benchmark records fixture/runtime/durability metadata, and no private helper is asserted directly.

## Comments

- 2026-08-17: Done. `src/benchmark.ts`, `src/browser-benchmark.ts`, and `src/scale-fixture.ts` (≈10k-record / 2k-belonging household fixture) landed; `src/verify.ts` carries the public-seam regression assertions (persistence failure, corrupt load, subscriber FIFO/reentrancy, import staging, body bounds, render coalescing, lazy Three, mobile nav, household pagination). Reports record fixture/runtime/durability metadata. Verified at 459/459.
