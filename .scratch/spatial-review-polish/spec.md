# Spatial review polish — interactive, elegant, read-only

Status: ready-for-agent
Branch: `codex/full-stack-low-latency` (continues the current effort)

## Outcome

Make the Nestory 2D Plan and 3D Home feel **interactive and elegant** while staying
strict **read-only projections** of confirmed Home Memory. Selecting, hovering,
toggling layers, seeing through walls, and following a locate result must all feel
alive and cohere between 2D and 3D — without any of them becoming a mutation path.

The preserved domain path is unchanged:

`Observation -> Proposal -> Review -> Commit Ledger -> Place Graph`

ADR 0002 binds: Three.js and the SVG plan consume shared room/furniture coordinates
and stay projections. Selection/preset/hover/layer/x-ray are **view-local state or
CustomEvents only** — never Store writes, never folded into the scene payload.

## Confirmed public seams

Behavior is observed only through:

1. Browser-visible DOM/SVG: `[data-testid="plan-3d"]`, `[data-testid="plan-svg"]`,
   `[data-testid="plan-pin"]`, `[data-action="spatial-select"|"spatial-preset"|"plan-mode"]`,
   the inspector `[data-spatial-selection-title|detail]`, and the anchor list.
2. Canvas telemetry datasets already used by verify: `data-spatial-*`
   (rendered-frames, draw-calls, triangles, textures, camera-state, preset,
   archetypes, reduced-motion, damping, label-size, visible/total-labels).
3. `mountSpatialScene(container, SpatialSceneData) -> dispose` and the
   `spatial-selection` / `spatial-preset-change` / `spatial-command` event contract.
4. Focus, ARIA roles/pressed/live regions, and keyboard reachability.

New view-local UI state (`ui.spatialXray`, `ui.spatialLayers`, hover) is not a test
seam except through its DOM/telemetry effects. `spatialSceneData()`'s JSON signature
must not gain selection/preset/hover/layer/x-ray fields.

## Invariants (must hold — the guardrail contract)

Every existing spatial/responsive/mobile assertion in `verify.ts` keeps passing.
The load-bearing ones this effort is most likely to threaten:

- **Read-only projection (ADR 0002):** no 2D/3D interaction writes to Store or Place
  Graph; picking emits events / sets view-local state only.
- **Event-not-render selection path:** selection, preset, hover, layer, and x-ray
  state stay OUT of `spatialSceneData()` so the signature is stable and
  `reconcileSpatialSurfaces`/`retainSpatialContainer` never dispose/remount the WebGL
  context on those changes (`unrelated-update-preserves-spatial-canvas`,
  `home-locate-preserves-mounted-spatial-context`).
- **Zero settled RAF:** `settled-spatial-scene-has-zero-continuous-raf` — every new
  animation (hover pulse, eased orbit, pin re-pulse) is time-boxed or decays via
  `settleFrames`; never an unconditional per-frame reschedule.
- **GPU budget:** `spatial-furnished-scene-stays-within-gpu-budget`
  (drawCalls ≤ 180, triangles ≤ 40 000, textures ≤ 8) and
  `spatial-room-geometry-budget` (≤ 300). Outline glow, rim light, x-ray, and any
  patch quad count against this.
- **No in-canvas labels for confirmed furniture:** `data-spatial-label-size==="0x0"`,
  `visible/total-labels===0` — labels remain proposal-only HTML/sprite.
- **Reduced motion:** `reduced-motion-disables-orbit-damping`,
  `reduced-motion-keyboard-orbit-has-no-settle-raf` (≤1 RAF) — gate all easing on
  `!reduceMotion`.
- **Preset/selection accessibility:** `spatial-camera-presets-change-the-mounted-view`,
  `spatial-object-list-selects-and-describes-furniture` keep working (no remount,
  aria-pressed + inspector title/detail update).
- **Responsive:** no document overflow and critical-content-visible at 320/390/761
  across all views; `mobile-2d-plan-fits-and-keeps-furniture-readable`,
  `mobile-plan-canvas-remains-usable`, mobile home mounts no `[data-spatial-scene]`.
- **Fault path:** `spatial-fault-path-cleans-partial-mount`,
  `spatial-recovers-after-faulted-mount` still hold; selection must work in 2D mode
  and when no live 3D surface exists.

## Chosen design

Deepen the existing surfaces; do not rebuild them.

- **Selection is state-first.** `ui.spatialSelectedId` is authoritative. A select from
  the 2D plan, the anchor list, or the 3D canvas all set it and patch DOM
  (aria-pressed, inspector, 2D outline) directly; the 3D scene command is dispatched
  only when a live 3D surface exists. Works in 2D mode and after a lost context.
- **2D plan becomes interactive.** `planFurnitureSymbol` groups get
  `data-action="spatial-select"`, `role`, `tabindex`, and a selection outline driven
  by `ui.spatialSelectedId`; hover/selected CSS transitions (reduced-motion safe).
- **3D hover + fitted outline.** A throttled pointermove raycast against
  `interactiveMeshes` sets `cursor:pointer` and a dim hover outline; committed
  selection uses a fitted `EdgesGeometry` outline (rebuilt on select, disposed on
  deselect) instead of the AABB `Box3Helper`. All routed through
  `scheduleRender`/`settleFrames`.
- **Layers + x-ray.** Parented Groups (furniture / boxes / proposals / pin) toggled by
  a `spatial-command {type:"layer"}` handler; a `{type:"xray"}` handler drops wall +
  furniture opacity. Both are view-local, one `scheduleRender` per toggle.
- **Locate ↔ inspect.** When `ui.lastAnswer` resolves to a spatial object, auto-select
  it and pair the pin with the outline in both surfaces; the pin orb becomes pickable
  (re-focus, read-only camera move); re-pulse is time-boxed (~800 ms).
- **Elegance is token-driven.** Spatial/plan chrome adopts `--line`/`--shadow-lift`/
  `--radius*`/`--sage*`; preset bar unifies onto `.segmented`; 2D and 3D base palettes
  and pin/box/label colors cohere; softer shadows, a cool rim light, tone-map tune.
- **A11y.** One live-region channel (keep `announce()`, drop the inspector
  `aria-live`); announce preset changes; keyboard-select objects in both projections.

## Out of scope

- Any mutation/edit/correction path from 2D or 3D (needs its own ADR + evidence).
- Layout-health overlay (keep-out/clearance/collision) — deferred to a later effort.
- What-if placement preview ghost driven by live pointer manipulation.
- Real reconstruction, recognition, LiDAR, AR, drag/rotate/resize, layout commits.
- Replacing the domain vocabulary or the review→commit path.

## Delivery

- New browser assertions cover: 2D plan selection + 2D↔3D parity, hover affordance,
  fitted outline present, layer toggle hides a group, x-ray changes opacity, locate
  auto-selects, preset announced, keyboard object selection, and the event-not-render
  signature-stability guard — added test-first (red) before implementation.
- All existing verification passes; `npm run check`, `npm run build`, `npm run verify`,
  `git diff --check` clean; settled RAF stays 0; GPU budget respected.
- A before/after benchmark and desktop/mobile browser evidence are regenerated.
- Independent Standards and Spec reviews run against this spec before commit.
