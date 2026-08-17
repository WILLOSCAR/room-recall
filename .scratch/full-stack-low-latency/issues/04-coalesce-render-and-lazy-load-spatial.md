# 04 - Coalesce render and lazy-load spatial

Type: implementation
Status: ready-for-agent
Blocked by: 01

Introduce one render coordinator for Store notifications and UI handlers, cancel stale focus/spatial callbacks, retain stable shell DOM when its projection is unchanged, and dynamically import the Three adapter only for a visible spatial surface. Preserve full keyboard, screen-reader, fallback, and mobile navigation behavior.

Done when one action commits at most once, non-spatial entry requests no Three modules, stale scheduled work cannot remount an old scene, settled scenes use no continuous RAF, and all major routes remain reachable at mobile widths.
