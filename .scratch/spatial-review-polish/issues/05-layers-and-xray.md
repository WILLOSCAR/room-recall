# 05 - Layer visibility toggles + X-ray transparency

Type: implementation
Status: done
Blocked by: 02

Parent scene content into Groups (furniture / boxes / proposals / pin) and wire the decorative inspector legend to a `spatial-command {type:"layer"}` handler that flips `group.visible` and fires exactly one render. Add a `{type:"xray"}` handler that drops wall + furniture material opacity for a see-through review model. Keep both states view-local (like `ui.spatialSelectedId`); never persist them into Store/Place Graph or the scene payload.

Done when toggling a layer hides/shows exactly that group, x-ray makes walls/furniture see-through and back, each toggle causes one render and the scene re-quiesces to zero RAF, and no toggle enters `spatialSceneData()`.

## Comments
- Anchors: app.ts layer-list:1854; spatial.ts content add:831-832, onSurfaceCommand:1121, createSolidMaterial:136, addRoom walls:343.