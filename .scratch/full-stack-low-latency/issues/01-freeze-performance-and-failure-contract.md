# 01 - Freeze performance and failure contract

Type: test
Status: ready-for-agent
Blocked by: none

Add public-seam regression tests and a repeatable benchmark for seed and household-scale fixtures. Cover persistence failure, corrupt load, subscriber isolation, import staging, body size, duplicate render, lazy Three loading, and complete mobile navigation before changing the corresponding implementation.

Done when the new assertions fail for the intended current behavior, the benchmark records fixture/runtime/durability metadata, and no private helper is asserted directly.
