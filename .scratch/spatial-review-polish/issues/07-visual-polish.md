# 07 - Visual polish: lighting, shadows, tokens, palette cohesion

Type: implementation
Status: done
Blocked by: none

Elegance pass, all presentational. 3D: PCFSoftShadowMap + `sun.shadow.radius` + slightly higher ShadowMaterial opacity for soft contact shadows; a low-intensity non-shadow cool rim light for silhouette separation; small ACESFilmic exposure / white-balance tune. CSS: tokenize spatial/plan chrome onto `--line`/`--line-strong`, `--shadow-lift`, and the `--radius*` scale; unify the sage selection + hairlines onto `--sage*` tokens; add an inspector depth seam; bump spatial micro-copy toward the 11px floor and raise overlay contrast; unify the preset bar onto the shared `.segmented` active treatment; cohere the 2D plan and 3D canvas base gradients and pull plan box/pin/label overlays onto accent/ink/sage tokens.

Done when the spatial surfaces read as one system with the console, contrast holds across camera angles, mapSize stays 1024² with no second shadow-casting light, and the GPU/texture budget and reduced-motion clamp still pass.

## Comments
- Anchors: spatial.ts PCFShadowMap:728, sun:797, ShadowMaterial:838, lighting rig:799, tone map:729-730; nestory.css .spatial-workspace:773, .spatial-preset-bar:780, .plan-* palette:228-244.