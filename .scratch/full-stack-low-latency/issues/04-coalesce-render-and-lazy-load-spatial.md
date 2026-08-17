# 04 - Coalesce render and lazy-load spatial

Type: implementation
Status: done
Blocked by: 01

Introduce one render coordinator for Store notifications and UI handlers, cancel stale focus/spatial callbacks, retain stable shell DOM when its projection is unchanged, and dynamically import the Three adapter only for a visible spatial surface. Preserve full keyboard, screen-reader, fallback, and mobile navigation behavior.

Done when one action commits at most once, non-spatial entry requests no Three modules, stale scheduled work cannot remount an old scene, settled scenes use no continuous RAF, and all major routes remain reachable at mobile widths.

## Comments

- 2026-08-17: Done. `app.ts` runs one render coordinator that coalesces store notifications + handler requests into a single commit and cancels stale focus/spatial callbacks; unchanged shell/spatial islands keep DOM identity; `spatial.ts` is dynamically imported only for a visible spatial surface (welcome/non-spatial entry fetches no Three/camera-controls modules — asserted). Keyboard, screen-reader, WebGL-fallback, reduced-motion, and full mobile navigation preserved.
- The final "settled scenes use no continuous RAF" line was the last failing assertion (4 frames/250ms). Root cause: camera-controls' `update()` reports "changed" for any nonzero delta, so its exponential damping tail drifted sub-millimeter forever. Fixed in `2218bfa` by gating rescheduling on visible movement (>1e-3 world units/frame). Settled spatial RAF callbacks now 0; 459/459.
