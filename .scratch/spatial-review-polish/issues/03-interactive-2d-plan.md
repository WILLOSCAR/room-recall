# 03 - Interactive 2D plan + selection outline

Type: implementation
Status: done
Blocked by: 02

Give `planFurnitureSymbol` groups `data-action="spatial-select"`, `data-id`, `role`, and `tabindex`, and render a selection outline in the SVG driven by `ui.spatialSelectedId`. Extend the `spatial-selection` listener to also outline the matching plan-object. Add hover/selected CSS transitions (reduced-motion safe). Keep the 2D plan fitting its container with no horizontal overflow and all furniture labels readable.

Done when 2D furniture is clickable/keyboard-focusable, selecting it drives the shared selection (parity with 3D and the list), the outline tracks `ui.spatialSelectedId`, and `mobile-2d-plan-fits-and-keeps-furniture-readable` + responsive overflow guards still pass.

## Comments
- Anchors: app.ts planFurnitureSymbol:1770, renderPlan:1773-1867; nestory.css .plan-object:230.