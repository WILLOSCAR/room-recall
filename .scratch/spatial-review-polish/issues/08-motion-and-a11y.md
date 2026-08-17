# 08 - Motion + accessibility polish

Type: implementation
Status: done
Blocked by: 02, 03

Motion: route non-reduced-motion keyboard orbit through eased `setLookAt`/rotate-with-transition to match pointer damping, keeping `settleFrames` decay; add reduced-motion-safe selection/pin micro-transitions. A11y: resolve the double live-region announcement (keep the composed `announce()` channel, drop `aria-live` from the inspector `<p>`); announce preset changes with a concise message; make individual objects keyboard-selectable in both projections (Tab/Arrow or `[`/`]` cycling + Enter/Space, advertised via `aria-keyshortcuts`; roving tabindex over 2D furniture once interactive).

Done when arrow-key orbit glides (and still issues ≤1 RAF under prefers-reduced-motion), a screen reader hears each selection and preset once, and objects are keyboard-selectable in both 2D and 3D.

## Comments
- Anchors: spatial.ts orbitFromKeyboard:1014-1018, onCanvasKeyDown:1022-1038; app.ts announce:262, preset listener:243-250, inspector aria-live:1844; nestory.css prefers-reduced-motion:1196.