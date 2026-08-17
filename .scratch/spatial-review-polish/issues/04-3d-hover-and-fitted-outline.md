# 04 - 3D hover affordance + fitted selection outline

Type: implementation
Status: done
Blocked by: 02

Add a throttled pointermove raycast against `interactiveMeshes` that sets `cursor:pointer` over a hit and shows a dim hover outline distinct from the committed selection. Replace the AABB `Box3Helper` selection cage with a fitted `EdgesGeometry` outline (or subtle emissive lift) of the selected root, rebuilt on select and disposed on deselect. Add focus-on-select parity: a canvas double-click (or second click on the selected object) frames it via the eased `focusObject` path.

Done when hovering highlights and sets the cursor, the committed selection reads as a fitted outline (not a box), the settled scene still draws zero continuous RAF, and drawCalls/triangles/textures stay within the GPU budget.

## Comments
- Anchors: spatial.ts onCanvasClick:1132, interactiveMeshes:821, Box3Helper:1040, setSelected:1072, focusObject:1053.