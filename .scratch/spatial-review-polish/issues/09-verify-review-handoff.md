# 09 - Verify, review, and hand off

Type: review
Status: done
Blocked by: 02, 03, 04, 05, 06, 07, 08

Run deterministic verification (target: all assertions green including the new ticket-01 contract, settled RAF = 0, GPU budget respected), regenerate runtime + browser benchmarks and desktop/mobile screenshots, then independent Standards and Spec reviews against this spec and ADR 0002. Fix all P0/P1 findings or record an explicit bounded residual. Update the tracker (mark tickets done) and the handoff.

Done when the branch is reproducible and green, the read-only-projection invariant is demonstrably intact (no new write path, signature-stable selection), and no push/deploy/hosting claim is made without separate evidence.

## Comments

- 2026-08-17: Done. Gates all green on branch `codex/full-stack-low-latency`:
  - `npm run verify` → **473/473** (strict tsc gate + PRD/spatial assertions + browser smoke). Settled spatial RAF: 0. GPU budget respected.
  - `npm run check`, `npm run build`, `git diff --check` → clean.
  - `npm run benchmark` (runtime) and `npm run browser-benchmark` → budgets pass (interaction→captured compositor surface p95 < 100 ms). No push/deploy/hosting claim made.
- Independent **Standards + Spec** reviews ran as parallel sub-agents against baseline `372fc23`.
  - Standards: **no hard violations**. Confirmed every new interaction (selection, hover, layers, x-ray, pin pairing) is view-local state or a CustomEvent — no Store write, nothing folded into the `spatialSceneData()` signature, no remount path (ADR 0002 / 0003 §7 intact).
  - Spec: **0 net correctness defects after fixes**; all invariants met.
- Findings actioned in `7e0fe34` (verify stayed green, +1 new test):
  1. Box selection named the wrong thing — `applySpatialSelection` resolved only furniture; added `resolveSpatialObject()` covering furniture + boxes.
  2. Duplicated pin-object derivation unified on one `sceneObjectIds()`/`spatialObjectIdForAnswer()` source so 2D outline and scene pin pairing can't diverge.
  3. Double announce with a live 3D surface (DOM click announced + scene echo) — announce only on a real selection change.
  4. Pin orb click now re-focuses the located item (ticket 06 "clicking … re-focuses"); plain furniture click stays select-only, dblclick frames.
- Recorded residuals (deliberate, no correctness/standards impact):
  - **2D roving tabindex**: ticket 08 named a roving-tabindex pattern; implemented as all-focusable plan objects (every `.plan-object` `tabindex="0"`) + Tab/Enter/Space. Valid a11y and simpler; the one-active-`0`/arrow-driven variant was not built. Keyboard-selectable-in-both-projections Done-when is met.
  - **Layer union restated 3×**: `"furniture"|"boxes"|"proposals"|"pin"` appears in `UIState`, the command union, and the click-handler guard. Minor shotgun-surgery smell; left as-is.
  - The DEFERRED layout-health overlay and OUT-of-scope what-if ghost from the map remain out of this effort.