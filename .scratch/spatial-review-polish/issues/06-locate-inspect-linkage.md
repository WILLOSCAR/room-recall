# 06 - Locate ↔ inspect linkage across 2D and 3D

Type: implementation
Status: done
Blocked by: 02, 04

When `ui.lastAnswer` resolves to a furniture/container that exists as a spatial object, auto-select it and visually pair the confidence pin with the selection outline in BOTH surfaces. Make the pin orb pickable so clicking it re-focuses the located item (read-only camera move). Re-arm the pin pulse on selection change (reset `pinAnimationStartedAt=null`), time-boxed to ~800 ms so the loop still quiesces.

Done when a locate result auto-selects and highlights the item in 2D and 3D, the pin is clickable and re-focuses, the pulse re-arms once and settles, and no store write occurs (derive from lastAnswer/planPin only).

## Comments
- Anchors: spatial.ts addPin:455, app.ts 3D pin gating:380-388, 2D pin:1811-1817.