# 05 - Optimize projections and agent payloads

Type: implementation
Status: ready-for-agent
Blocked by: 02

Remove repeated query work using private indexes or revision-scoped memoization where the household-scale benchmark proves value. Keep media out of default Agent results, bound serialized tool output before allocation grows without limit, and add time/abort limits at the LLM boundary.

Done when incremental/cached results remain replay-equivalent, 10k-record query/write metrics meet the target or have an evidence-backed residual explanation, and Sensitive Evidence is not sent to the model by default.
