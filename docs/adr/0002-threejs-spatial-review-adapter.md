# ADR 0002: Three.js is the browser spatial-review adapter

Date: 2026-08-11

Status: accepted

## Context

ADR 0001 deferred real scanning, automatic reconstruction, and 3D as a V1 value proposition. The V1.4 console subsequently added a read-only Three.js projection over the same room coordinates as the 2D Plan. The product still needs a clear implementation decision for presenting that projection without allowing rendering state to become Home Memory truth.

The current product priority remains searchable Home Memory, moving/unpacking, Intent Kits, and trustworthy correction. A richer spatial presentation is useful only when it helps a user inspect rooms, anchors, moving boxes, confidence, or reviewable proposals.

## Decision

1. Use **Three.js as the browser adapter for spatial review** in `prototype-v2/`. Its interface consumes `SpatialSceneData` and returns a disposal function; the Place Graph and Store do not depend on Three.js objects.
2. Three.js may render rooms, Furniture, boxes, confidence pins, labels, and proposal states. It remains a projection and never becomes a mutation path.
3. Capture, vision, SLAM, and reconstruction remain separate future modules. Their output must still follow `Observation -> Proposal -> Review -> Commit Ledger -> Place Graph` before the adapter can present it as trusted memory.
4. The 3D Home preview and Plan remain optional trust and orientation surfaces. They do not replace search, container memory, or Operations, and they are not evidence that real reconstruction is validated.

## Consequences

- Visual improvements can stay local to the spatial adapter while 2D and 3D continue to consume the same coordinates.
- Picking or editing added later must emit typed proposals rather than mutating meshes as canonical state.
- Browser verification must continue to cover canvas rendering, responsive layout, and the locate pin; non-deterministic reconstruction quality requires a separate evaluation seam.
- Re-entering real room reconstruction, automatic object recognition, or spatial correction as a product requirement still needs its own evidence and ADR.
