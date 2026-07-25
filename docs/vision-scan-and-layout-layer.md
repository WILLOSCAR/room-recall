# RoomRecall Vision Scan and Layout Layer

Status: discovery

Canonical product behavior lives in `docs/nestory-v1-prd.md`. Algorithm route tradeoffs live in `docs/scan-algorithm-options.md`; this file focuses on how scan and layout should feel in the product.

## Core Position

RoomRecall should support visual scanning, but the scanner should be a proposal engine, not an automatic truth engine.

The product flow should be:

1. Capture room or container with phone camera.
2. Convert visual evidence into proposed rooms, zones, furniture, containers, items, dimensions, tags, and placements.
3. Show the proposal as editable 3D ghost geometry first, then expose the same facts as a precise 2D plan.
4. Let the user confirm, correct, merge, or reject.
5. Commit confirmed facts into the Place Graph as append-only placement records with evidence and confidence.

The source of truth is not a dense 3D mesh. The source of truth is a typed Place Graph plus placement history.

## Visual Scan Pipeline

### 1. Room Scan

- Input: 20-40 second phone video around the room, plus a few still frames from corners.
- Optional anchor: one known measurement, such as desk width, door width, bed length, or wall length.
- Output: room boundary, rough wall/floor layout, door/window openings, large furniture candidates, and camera coverage.
- MVP: a single room, one known size anchor, editable 2D plan, and rough 3D cutaway.

### 2. Furniture Scan

- Input: the same room video plus closer views of desk, bed, wardrobe, shelf, shoe rack, and cabinets.
- Output: furniture cuboids, footprint, height estimate, orientation, wall attachment, and confidence.
- MVP: detect or propose 5-10 large furniture anchors, then require user review.

### 3. Container Scan

- Input: short close-up video or photo for an opened drawer, shelf layer, basket, box, suitcase, or bag.
- Output: container nodes, rough internal slots, visible item candidates, unknown contents, and photo evidence.
- MVP: container snapshots should be first-class. The user should not need to rescan the whole room to update one drawer.

### 4. Item Scan

- Input: container photo, close-up object photo, or video frame.
- Output: item or item group candidates, labels, aliases, tags, location proposal, evidence, and confidence.
- MVP: unique/high-value items become `Item`; repeated low-value things become `ItemGroup`.

### 5. Product or Manual Item Intake

- Input: product name, item type, custom dimensions, tags, kit membership, and default place.
- Output: a mapped item with footprint, default home, search aliases, source, and placement evidence.
- MVP: manual product intake should be the fallback when visual scan cannot identify an object or when the user wants exact dimensions from a product page, box label, or measurement.

This matters because not every useful object starts from a camera scan. Some objects are better initialized from purchase information, product dimensions, receipts, screenshots, or quick manual entry, then later grounded into the room model by scan or drag placement.

## Place Graph Mapping

Use typed nodes instead of a flat location string.

- `Room`: top-level physical space.
- `Zone`: semantic area, such as desk area or wardrobe area.
- `Furniture`: large movable or semi-fixed anchor, such as bed, desk, wardrobe, shelf.
- `Container`: actionable place where something can be found, such as second drawer, desk-right-surface, middle basket, shoe-rack-bottom-level, backpack-front-pocket.
- `ItemKind`: normalized type, such as training shirt, charger, socks, passport.
- `Item`: physical instance.
- `ItemGroup`: repeated or fungible group, such as socks, cables, towels.
- `PlacementRecord`: append-only record linking item or group to container, relation, timestamp, evidence, confidence, and status.
- `Evidence`: scan, photo, manual note, voice note, user confirmation, or not-there report.

Important rule: `location` is only a display field. The real mapping is:

```text
item -> container -> parent container? -> furniture? -> zone -> room
```

## Scan Review Flow

Scanning should never silently overwrite the current model.

1. New scan creates a `ScanSession`.
2. The scan session creates append-only `Observation` records.
3. Observations create typed `ScanProposal` diffs.
4. The user reviews uncertain objects, furniture, containers, and private items.
5. Accepted proposals can be committed.
6. Commit creates ledger entries and new `PlacementRecord` or layout records.
7. Old records are marked `superseded`, `contradicted`, or `stale`, not silently deleted.
8. Low-confidence, occluded, unknown, or conflicting results remain visible as uncertainty.

This protects the memory system from false confidence.

### Proposal State Machine

Each scan proposal should have a review state:

- `pending`: created by visual scan, not yet trusted.
- `accepted`: user agrees this proposal should be applied.
- `rejected`: user rejects the proposal, but the evidence can remain as scan history.
- `committed`: accepted proposal has updated the canonical Place Graph or layout model.

Prototype proposal shape:

```text
ScanProposal {
  id
  type: furniture_update | furniture_create | container_create | item_placement
  targetId?
  action: update | create | place
  confidence
  evidence
  patch
  status
}
```

Important rule: `commit` is the only step that changes the canonical model.

### Scan Session Quality

Each scan session should record:

- scan scope: room, furniture area, container, item, or product evidence
- input type: video, still photos, close-up image, or imported product/media evidence
- known size anchor status
- coverage score
- occlusion and unknown areas
- privacy status and sensitive regions
- failure reason or partial-success status

Room scans should not produce high-confidence geometry without enough coverage and at least one scale anchor. Container scans can produce partial proposals without requiring a full-room rescan.

### 3D Scan Proposal Review

The prototype should make scan proposals visible in 3D before they become truth.

- Pending proposals render as translucent candidate cuboids.
- Accepted proposals change visual state but still do not mutate the model.
- Rejected proposals disappear from the active draft but remain available as scan history.
- Commit applies only accepted proposals to furniture, containers, item placements, or dimensions.

3D is the trust review layer: the user can quickly tell whether the scanner understood the room shape, furniture orientation, and approximate volume. 2D is the correction layer: the user can precisely drag, resize, rotate, and inspect collision.

## Layout Layer

The layout layer is not a full interior design CAD tool. It helps the user answer:

- Can this desk/cabinet/shelf fit here?
- Will it collide with other furniture?
- Is there enough path clearance?
- Does this layout create more usable storage?
- Does the room feel visually more open?

## Coordinate and Dimension Contract

- Canonical room coordinates use meters.
- V1 `RoomFrame` origin is the room center on the floor.
- `+x` points right in the 2D plan, `+z` points down in the 2D plan, and `+y` points up in 3D.
- In the single-room prototype, `WorldFrame` and `RoomFrame` can be treated as the same frame.
- `PlanFrame` and `ScreenFrame` are UI/input frames and must not be stored as canonical Place Graph facts.
- Product intake can accept centimeters, but stores a normalized meter footprint.
- 2D plan and 3D cutaway are projections of the same geometry.
- Room, furniture, container, and item dimensions should carry both a dimension source and verification status.
- Geometry updates should state which child containers and placements are affected.
- `location` is a display field. Geometry updates can create placement proposals, but cannot silently rewrite semantic containment.

### Frame Conversion Acceptance

- Room-to-plan and plan-to-room transforms should round-trip within 1cm for in-bounds points.
- Screen, pointer, and camera coordinates are rendering/input state only.
- 3D drag should resolve the current support surface. If support surface is unknown, the update should become a draft or be blocked.
- Items inside shelves, drawers, boxes, and bags should prefer parent-local offsets instead of fake room-level precision.

## Furniture Model

Each furniture object should have:

- id and label
- kind: bed, desk, cabinet, shelf, rack, table, custom block
- width, depth, height
- x/z position
- rotation
- source: vision draft, manual layout, scripted layout, confirmed scan
- confidence
- footprint
- optional opening clearance, such as drawer pull-out or chair pull-back
- optional internal containers, such as shelves, drawers, baskets, slots

MVP can use 2D footprints and 90-degree rotation. 3D can remain a trust layer.

## Item Product Model

Each user-created or product-imported item should have:

- id and label
- kind: object, clothing, device, document, container, consumable, custom
- dimensions: width, depth, height
- footprint and optional approximate volume
- default place and current place
- tags, aliases, and kit membership
- source: manual intake, product page, receipt, scan, voice note, or confirmed user edit
- evidence and confidence

Manual intake does not replace scan. It gives the system an object identity and size prior, so later visual observations can attach to the right item instead of creating a duplicate.

## Collision and Space Scoring

### Hard Collisions

- Furniture outside room boundary.
- Furniture footprint overlapping another furniture footprint.
- Furniture blocking a fixed door/opening.
- Furniture or storage blocking a keep-out zone.
- Door swing, drawer pull-out, cabinet opening, or chair pull-back envelope blocked.

### Soft Warnings

- Path clearance below 75cm.
- Drawer, chair, or cabinet opening zone too tight.
- Tall furniture blocks central sightline or window-side openness.
- Storage increases but high-frequency access worsens.

### MVP Metrics

- Narrowest path clearance:
  - `< 60cm`: blocked
  - `60-75cm`: tight
  - `>= 75cm`: clear
- Main path clearance for user-defined routes such as entry -> desk, entry -> wardrobe, bed -> door.
- Center open ratio.
- Gross storage volume.
- Usable storage volume.
- Frequently accessible storage volume.
- Hard conflict count.
- Furniture scan confidence.

## Prototype Slices

1. Vision Draft Import

- Add a sample scan draft that produces editable furniture.
- Mark all scan-derived objects as proposals until reviewed.
- Show scan proposals as 3D ghost cuboids before commit.

2. Editable Furniture

- Select furniture in 2D.
- Edit width, depth, height.
- Drag in 2D plan.
- Rotate in 90-degree steps.

3. Collision and Clearance

- Show red hard collision state.
- Show narrowest path clearance.
- Keep furniture inside room bounds.

4. Storage and Openness

- Show storage volume.
- Show center open percentage.
- Suggest 2-3 rule-based fixes later.

5. Place Graph Commit

- Confirm reviewed furniture and containers.
- Keep evidence, source, and confidence.
- Lower confidence of child placements when a container or furniture dimension changes.

6. Product Intake

- Create an item from name, type, dimensions, default place, tags, and kit.
- Convert dimensions into a footprint in the model.
- Preserve product/manual source as evidence.
- Let later scan or drag placement update the current place without losing the default home.

## Technical Risks

- Monocular scale drift: require at least one known measurement.
- Clutter and occlusion: prefer container-level scans over pretending to see everything.
- Duplicate small objects: default to item groups.
- Mirrors, white walls, and low texture: guide capture and show scan quality warnings.
- Privacy: local-first by default, with explicit opt-in for heavy cloud models.

## Validation Metrics

- First searchable room draft in under 5 minutes.
- Fewer than 12 manual corrections for one room draft.
- Normal moved-item update under 5 seconds.
- Room footprint error below 8% after one size anchor.
- Large furniture footprint error below 15cm or 10%.
- At least 80% correct mapping at `room > zone > container`.
- High-confidence placements should be materially more accurate than medium-confidence placements.
