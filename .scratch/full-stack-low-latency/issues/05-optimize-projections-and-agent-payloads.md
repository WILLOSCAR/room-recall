# 05 - Optimize projections and agent payloads

Type: implementation
Status: done
Blocked by: 02

Remove repeated query work using private indexes or revision-scoped memoization where the household-scale benchmark proves value. Keep media out of default Agent results, bound serialized tool output before allocation grows without limit, and add time/abort limits at the LLM boundary.

Done when incremental/cached results remain replay-equivalent, 10k-record query/write metrics meet the target or have an evidence-backed residual explanation, and Sensitive Evidence is not sent to the model by default.

## Comments

- 2026-08-17: Done. Private gram/token/kind search index + revision-scoped memoization in `store.ts`; index invalidates on every published revision. `agent.ts`/`boundedProjection` strip `media`/`dataUrl` so Sensitive Evidence never reaches the model by default; tool output is bounded before allocation grows; `agent-runtime.ts` adds time/abort limits at the LLM boundary. Spec-axis review confirmed the top-`limit` insertion sort in `indexedBelongingMatches` preserves the documented score/nameRank precedence (replay-equivalent) — the riskiest area, and it checks out. Household query/write metrics meet target; the compatibility full `/search` array is reported as an explicit unbounded residual, not folded into the bounded claim. 459/459.
