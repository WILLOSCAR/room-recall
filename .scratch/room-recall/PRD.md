# RoomRecall Legacy PRD Seed

Status: superseded

This file preserves the first product framing for provenance. It is not the current build contract. The decided V1 wedge lives in `docs/nestory-v1-prd.md`; the next planning effort is indexed by `../room-recall-v1x/map.md` and will produce a current `spec.md` only after its decision frontier is clear.

## Summary

RoomRecall helps a person living in a rented room remember where physical things are and assemble activity-based retrieval plans. The first version should prove the item graph, containment model, natural-language search, and intent-kit expansion before investing in precise 1:1 3D reconstruction.

See `docs/product-requirements.md` for the structured product requirements.
See `docs/requirements-discovery.md` for the post-prototype requirement discovery.
See `docs/vision-scan-and-layout-layer.md` for the visual scan, product intake, 3D proposal review, and furniture layout planning layer.
See `docs/requirements-agent-synthesis.md` for the multi-agent requirements review summary.
See `docs/coordinate-prototype-synthesis.md` for the coordinate-frame and prototype verification synthesis.

## Problem

After living in a rented home for a long time, objects accumulate in drawers, shelves, bags, boxes, and corners. The user often remembers owning something but not where it was placed. Broad activities such as going to the gym also require many small objects, and the user has to mentally reconstruct the checklist every time.

## Target User

A person living in a rented room or small apartment who wants the home to become searchable without building a heavy inventory system.

## Jobs To Be Done

- Find a specific object quickly.
- Remember what is inside a container.
- Ask for an activity such as `fitness` and get all needed child items.
- Merge duplicate child items into one checklist.
- Understand when the system is uncertain.

## MVP

- Create rooms, zones, containers, and items.
- Record placements with text, optional photo, timestamp, and confidence.
- Search for an item by natural language.
- Define an intent kit such as `fitness`.
- Expand an intent kit into child items.
- Merge child items into a retrieval plan.
- Show uncertainty and evidence for each answer.

## Post-Prototype Direction

The prototype showed that 3D, 2D plan editing, search, kit expansion, object movement, rotation, evidence, and confidence can fit into one experience. The next product risk is not whether the room can be rendered; it is whether the memory stays useful after normal life changes it.

Prioritize:

- Default home versus current location.
- Low-friction updates through text, voice, drag, or quick confirmation.
- Object states such as dirty, drying, in bag, on me, lent out, packed, and missing.
- Kit readiness and retrieval progress, not only kit item listing.
- Wrong-location recovery through `Not there`, alternative candidates, and placement correction.
- Evidence freshness, confidence explanation, and stale placement review.
- Visual scanning as a proposal engine: scan -> review -> commit, not scan -> overwrite truth.
- Layout planning with custom furniture dimensions, 2D footprint collision, path clearance, storage volume, and openness metrics.

## Out Of Scope For MVP

- Perfect 1:1 3D room reconstruction.
- Fully automatic visual reconstruction without user review.
- Real-time object tracking.
- Automatic object recognition from every photo.
- Multi-user inventory.
- Purchase recommendations.

## Example Intent Kit

`fitness` may expand into:

- Training shirt
- Shorts
- Socks
- Gym shoes
- Towel
- Water bottle
- Earphones
- Resistance band
- Gym card
- Laundry bag

## Open Questions

- Should the first interface be mobile-first, desktop-first, or a simple local web app?
- How much friction is acceptable when adding a new item?
- Should photos be required for confidence, or optional evidence?
- How should the Agent ask for clarification when several objects match?
- What privacy boundary should be assumed for home scans and item photos?
