# 02 - State-first selection across 2D, list, and 3D

Type: implementation
Status: ready-for-agent
Blocked by: 01

Make `ui.spatialSelectedId` the authoritative selection. A select from the 2D plan, the anchor list, or the 3D canvas sets it and directly patches DOM (aria-pressed, inspector title/detail); dispatch the 3D scene command only when a live 3D surface exists. Selection must work in 2D mode and after a lost/failed 3D mount. Keep selection OUT of `spatialSceneData()` so the scene signature stays stable and the WebGL context is not disposed/remounted.

Done when selecting in any of the three places agrees everywhere, selection survives 2D mode and a faulted 3D surface, and the signature-stability guard from ticket 01 passes.

## Comments
- Anchors: app.ts dispatchSpatialCommand:238-241, spatial-selection listener:252-263, spatial-select handler ~2160.