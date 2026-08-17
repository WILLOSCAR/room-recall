# 01 - Freeze spatial-polish test contract

Type: test
Status: done
Blocked by: none

Add browser assertions (red against current behavior) for the new interactions before implementing them, and one guard locking the event-not-render selection path. Cover: 2D plan furniture is selectable (data-action/role/tabindex) and shows a selection outline; selecting in 2D, the anchor list, or 3D agree (bidirectional parity); 3D hover sets cursor/hover outline; committed selection uses a fitted outline (not the AABB helper); a layer toggle hides its group; an x-ray toggle changes wall/furniture opacity; a locate result auto-selects the matching object and pairs the pin; preset changes are announced; objects are keyboard-selectable in both projections; and toggling selection/preset/hover does NOT change the spatialSceneData signature or increment scene mounts.

Done when the new assertions exist, fail for the intended current behavior, assert only through public seams (DOM/SVG, data-spatial-* telemetry, events, ARIA), and no private helper is asserted directly.

## Comments
- Anchors: verify.ts spatial block ~1986-2118; signature/mount guard around app.ts:356-390 + 731-759.