# RoomRecall Coordinate and Prototype Synthesis

Status: synthesis

Date: 2026-07-01

This note records the parallel review focused on coordinate contracts, scan calibration, layout constraints, prototype interaction, and verification.

## Main Decisions

1. The Place Graph remains the semantic source of truth.
2. Geometry needs its own committed record layer: `GeometryRecord`.
3. `Current Place` is a projection from placement and geometry records, not a direct authority over x/z.
4. `location` strings and breadcrumbs are display fields.
5. `RoomFrame`, `PlanFrame`, and `ScreenFrame` must stay separate.
6. Screen, pointer, camera, and DOM coordinates are interaction state only and must not enter the Place Graph.
7. Product dimensions are geometry priors until scan, drag, or confirmation grounds the object.
8. Scan confidence must be constrained by anchor quality, coverage, occlusion, and privacy redaction.

## Prototype Changes

The prototype now shows:

- room-local coordinate frame
- 2D plan origin and 1m scale marker
- world x/z and 2D projection readout
- scan session coverage, anchor, occlusion, and quality status
- confidence reasons on scan proposals
- keep-out zones
- named main routes
- main path clearance
- gross, usable, and accessible storage volume
- product default place preserved after current-place movement

The prototype also exposes:

- `window.roomRecallDemo.worldToPlan(x, z)`
- `window.roomRecallDemo.planPercentToWorld(left, top)`
- `window.roomRecallDemo.coordinateSnapshot()`

## Verification Changes

`prototype/verify.mjs` now asserts:

- room-to-plan coordinate round trip stays within 1cm
- coordinate frame uses meters
- main routes are modeled
- keep-out zones are modeled
- main path clearance is measured
- usable storage is lower than gross storage
- scan session coverage is visible
- proposals expose confidence reasons
- product default place survives current-place movement
- mobile viewport has no horizontal overflow

## Follow-Up Requirements

- Add explicit `GeometryRecord` and `CoordinateFrame` issue slices.
- Add support-surface handling for 3D drag.
- Add opening envelopes for drawer pull-out, cabinet door swing, and chair pull-back.
- Add pointer-level verification for real furniture drag.
- Add mobile plan/layout verification screenshots.
- Add privacy-aware scan session fields for raw media, OCR, embeddings, and redacted regions.
