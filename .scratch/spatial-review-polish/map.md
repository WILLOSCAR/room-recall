# Spatial Review Polish Wayfinder Map

Status: wayfinder:map

## Destination

A decision-complete foundation for one ready-for-agent build spec that makes the
2D Plan and 3D Home **more interactive and more elegant** as *read-only projections*
of confirmed Home Memory — without turning either surface into an edit/mutation path.

The spec must name, per improvement: the exact interaction or visual change, the
public test seam that proves it, and the invariant it must not break (read-only
projection, zero settled RAF, no 320/390 overflow, full keyboard/screen-reader).

## Notes

- Product thesis: **A memory system for your home.** 2D/3D are trust and orientation
  surfaces, never the source of truth (ADR 0001, ADR 0002).
- **Locked decision (2026-08-17):** target is *read-only projection, deeper interaction
  + visual polish*. No write path, no spatial correction, no new ADR required.
  Editing/selection that mutates is explicitly out of this effort.
- ADR 0002 binds: Three.js consumes `SpatialSceneData`, returns a dispose fn; the
  Place Graph never depends on Three objects. Any future picking must emit typed
  proposals — not in scope here.
- Both surfaces already read the same room/furniture plan coordinates. Improvements
  must keep 2D and 3D consistent with those shared coordinates.
- Current surfaces (baseline): 3D orbit/zoom, 3 camera presets, click-to-inspect
  furniture + inspector, confidence pin, reduced-motion, lazy load, zero settled RAF.
  2D SVG floor plan with room/furniture symbols, numbered boxes, locate pin (ring =
  uncertainty), legend, box quick-open.
- Verification must keep proving: canvas renders, responsive layout, locate pin,
  zero settled RAF, GPU budget, mobile nav — see verify.ts spatial + responsive suites.
- Effort skills available directly (orchestration skills not exposed by this client,
  so follow the tracker per AGENTS.md Runtime compatibility): `grilling`, `tdd`,
  `code-review`, `domain-modeling`, `diagnosing-bugs`, plus browser automation.

## Decisions so far

<!-- Append one gist + relative link per resolved child ticket. -->

- **2026-08-17 audit + decisions locked** (`spatial-review-audit` workflow, 6 area reads).
  Current-state map, 30 ranked opportunities, 34 verify guardrails captured. User
  directive: autonomous, default to the first/recommended option on every question.
  Decided scope for this build spec (all read-only projection, ADR-0002 safe):
  - **IN (impact-high core):** X-ray transparency toggle (3D); interactive 2D plan +
    bidirectional 2D↔3D selection parity; 3D hover highlight + cursor + tooltip;
    fitted EdgesGeometry selection outline replacing the AABB cage; layer-visibility
    toggles wired to the legend; locate↔inspect linkage (clickable pin, auto-select
    located item, pin paired with outline across both surfaces).
  - **IN (interaction/motion):** focus-on-select parity on canvas click; eased
    keyboard orbit (gated on !reduce-motion, ≤1 RAF under reduce-motion).
  - **IN (visual polish bundle):** soft contact shadows (PCFSoft + radius); cool rim
    light; tone-mapping tune; tokenize spatial chrome (--line/--shadow-lift/--radius);
    unify sage selection tokens; inspector depth seam; bump micro-copy size/contrast;
    unify preset bar onto shared .segmented; cohere 2D/3D base palettes.
  - **IN (a11y):** resolve double live-region (keep announce(), drop inspector
    aria-live); announce preset changes; keyboard-selectable objects in both views.
  - **IN (guardrail):** regression test locking the event-not-render selection path
    (selection/preset/hover must never enter spatialSceneData signature).
  - **DEFERRED:** layout-health overlay (keep-out/clearance/collision, L effort,
    display-only) — valuable but not blocking; revisit after the core parity lands.
  - **OUT:** what-if placement preview ghost (highest ADR risk); anything V40 that
    proposes furniture moves or needs a write/mutation path.
  - **Full audit artifact:** workflow result captured in this session; guardrail list
    (34 verify assertion ids) is the invariant contract the spec/tickets must cite.

## Fog

- Which specific interactions clear the bar for "interactive" in V1 vs. defer: hover
  highlight, layer toggles, 2D↔3D linked selection, smoother camera easing, locate
  spatial narrative, box focus. Graduates to a ticket once each is a precise yes/no.
- Which visual moves clear the bar for "elegant": materials/lighting, motion design,
  typography/labels, pin styling, empty states. Same graduation rule.
- Whether any change needs a disposable prototype to judge feel before spec, or the
  improvements are concrete enough to spec directly.
- Mobile-specific spatial interaction (touch orbit, 2D pan/zoom) as its own ticket.

## Out of scope

- Any mutation/edit/correction path from 2D or 3D (needs its own evidence + ADR).
- Real reconstruction, automatic recognition, LiDAR, AR.
- Making 3D a product requirement or a source of truth.
- General-purpose interior-design CAD, drag/rotate/resize, collision, layout commits.
- Replacing the domain vocabulary or the Observation→Proposal→Review→Commit path.
