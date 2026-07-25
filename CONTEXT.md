# RoomRecall / Nestory Context

RoomRecall is the prototype name. Nestory is the current working product direction.

Core thesis:

> A memory system for your home.

Nestory helps a user remember belongings, containers, spaces, evidence, and real-life operations such as moving, unpacking, travel, fitness, cleaning, repair, and seasonal reset.

## Product Rules

- The first product goal is searchable memory, not perfect 3D reconstruction.
- The product should earn maintenance by attaching memory to real operations such as moving, packing, unpacking, and kit preparation.
- Treat 3D, AR, LiDAR, and transparent room views as later interface layers over a useful item graph.
- Every location answer should expose confidence and evidence when the system may be wrong.
- Preserve containment: an item can be inside a drawer, inside a box, on a shelf, under a bed, or in a bag.
- Broad intents should expand into child items, then merge duplicates into one checklist.
- Avoid pretending the system saw an object move unless there is explicit evidence from the user, a scan, or a confirmed update.

## Language

**Home Memory**:
The user's structured, searchable memory of their home, belongings, containers, evidence, and operations.
_Avoid_: pitching the product as only a 3D room model or a single-item finder.

**Belonging**:
A physical thing the user cares about enough to remember, prepare, pack, insure, lend, repair, or recover.
_Avoid_: tracking every cheap object as if it needs precise coordinates.

**Operation**:
A real-life workflow that uses home memory, such as move, unpack, gym, travel, camping, cleaning, repair, seasonal reset, or insurance record.
_Avoid_: treating kits and packing flows as mere tags.

**Spatial Inventory**:
The user's searchable map of rooms, zones, containers, items, placements, and evidence.
_Avoid_: plain shopping-list app, generic note-taking app.

**Place Graph**:
The underlying graph that connects places, containers, items, and user intents.
_Avoid_: treating the home as only a flat list of objects.

**Room**:
A top-level physical area such as bedroom, bathroom, kitchen, entryway, balcony, or storage room.

**Zone**:
A smaller area inside a room, such as desk area, wardrobe area, bed area, shoe area, or bathroom shelf.

**Furniture**:
A movable or fixed physical anchor with dimensions and orientation, such as a bed, desk, wardrobe, cabinet, shelf unit, shoe rack, or table.
_Avoid_: mixing furniture anchors with small containers or free-text zones.

**Container**:
A place that can hold items, such as drawer, box, cabinet, shelf, suitcase, basket, or storage bag.

**Item Kind**:
A normalized category for objects that may have many instances or substitutes, such as training shirt, charger, towel, passport, or medicine.
_Avoid_: treating every search word as a separate physical object.

**Item**:
A physical object the user may want to find, prepare, pack, or remember.

**Item Group**:
A repeated or fungible set of objects tracked together, such as socks, towels, cables, shirts, or batteries.
_Avoid_: forcing exact instance tracking when the user only needs a usable member of the group.

**Placement**:
The relationship between an item and a place, including containment, relative position, timestamp, and confidence.

**Default Home**:
The place where an item is expected to return when life is normal. It can differ from the item's current place.
_Avoid_: assuming last-seen location is the item's home.

**Current Place**:
The system's current best projection from placement records: where an item is believed to be now, or which non-room state it is in.
_Avoid_: permanent location, fixed location.

**Last-Seen Place**:
The most recent place where an item was observed, even if that place is not trusted as the current place.
_Avoid_: treating last seen as current without confidence and freshness checks.

**Expected Return**:
Whether and when an item is expected to return to its default home after an activity, trip, laundry cycle, loan, or packing session.
_Avoid_: assuming every moved item should immediately be back home.

**Non-Room State**:
A current state outside the normal room hierarchy, such as with me, packed, in transit, laundry, drying, lent out, consumed, missing, or retired.
_Avoid_: representing every object state as a fake room.

**Placement Record**:
An append-only record of where an item or item group was believed to be at a moment in time.
_Avoid_: silently overwriting placement history.

**Evidence**:
The source supporting a placement, such as photo, scan, manual note, voice note, timestamp, or user confirmation.

**Observation**:
A raw or interpreted signal from a scan, photo, voice note, command, drag action, or manual edit that may propose a change to the Place Graph.
_Avoid_: treating every observation as a confirmed fact.

**Scan Session**:
A bounded capture event for a room, furniture area, container, or item, including scope, source media, coverage, scale anchors, privacy status, and failure reasons.
_Avoid_: mixing multiple unrelated captures into one silent model update.

**Coordinate Frame**:
A local coordinate system for a room, furniture item, container, or scan session, including origin, axes, parent frame, transform, unit, and scale evidence.
_Avoid_: raw unscoped x/y/z values.

**Geometry Record**:
An append-only record describing the size, shape, pose, footprint, clearance envelope, and dimension evidence for a room, furniture item, container, or item.
_Avoid_: treating geometry as an untracked mutable property.

**Dimension Source**:
The provenance of a dimension value, such as manual measurement, scan estimate, product specification, derived value, or user-confirmed measurement.
_Avoid_: mixing measurement source with confidence.

**Dimension Verification Status**:
The review state of a dimension value, such as unverified, reviewed, confirmed, or conflicted.
_Avoid_: using source labels such as scanned or product-derived to imply verification.

**Spatial Relation**:
The spatial or containment relation in a placement, such as inside, on surface, under, attached to, adjacent to, in front of, behind, left of, right of, or near.
_Avoid_: mixing lifecycle states such as laundry or with me into spatial relations.

**Place Reference**:
A typed reference to a room, zone, furniture item, container, or non-room state.
_Avoid_: free-text location strings as canonical references.

**Vision Scan Proposal**:
A visual scan result that proposes rooms, zones, furniture, containers, items, dimensions, placements, evidence, and confidence before user review.
_Avoid_: treating a scan as automatic truth that silently overwrites the Place Graph.

**Commit Ledger**:
The append-only history of confirmed mutations to the Place Graph or layout model, including before/after diff, source proposals or observations, affected records, and undo boundary.
_Avoid_: untraceable in-place edits.

**Container Snapshot**:
A timestamped visual or manual record of what a container appears to contain at a given time.
_Avoid_: requiring a full-room rescan for a drawer, box, shelf, or bag update.

**Product Intake**:
The flow for creating an item from product or manual information such as name, dimensions, tags, default place, and kit membership.
_Avoid_: scan-only item creation.

**Review Inbox**:
The queue of uncertain observations and proposals that need user confirmation before they become trusted memory.
_Avoid_: silent automatic truth writes.

**Layout Layer**:
The editable furniture and storage geometry layer used for custom dimensions, dragging, rotation, collision detection, path clearance, storage scoring, and visual openness planning.
_Avoid_: turning RoomRecall into a general-purpose interior design CAD tool.

**Intent Kit**:
A broad activity or goal that expands into child items, such as `fitness`, `business trip`, `winter clothes`, or `repair`.

**Kit Requirement**:
A required, optional, substitute, shared, or consumable need inside an intent kit.
_Avoid_: treating kit membership as only a tag.

**Retrieval Plan**:
The merged checklist of needed items plus where to get each item.

**Sensitive Evidence**:
Evidence that can expose private home details, documents, addresses, medical labels, screens, faces, receipts, or identity information.
_Avoid_: allowing raw sensitive media into Agent context by default.

**Transparent Home Model**:
A later interface that lets the user see through rooms, shelves, drawers, and boxes to locate hidden objects.
_Avoid_: making transparent 3D a prerequisite for the first usable version.

## Product Map

- `README.md`: idea seed and product framing.
- `docs/nestory-product-vision.zh-CN.md`: current product vision draft; use it for long-term value and experience principles, not as a build spec.
- `docs/nestory-roomrecall-handoff.md`: 10-minute handoff for the next person or agent taking over the project.
- `docs/nestory-v1-prd.md`: canonical V1 PRD — decided wedge (moving/unpacking + kits), P0 acceptance criteria, release gates.
- `docs/nestory-product-framework.md`: strategic product framework around home memory, moving, kits, containers, and operations.
- `prototype-v2/`: current runnable V1 console (TypeScript: `src/types.ts` contract + store + UI + `src/verify.ts`).
- `prototype/`: frozen V40 proof archive for 3D/scan/layout contracts.
- `docs/vision-scan-and-layout-layer.md`: visual scan, typed mapping, and furniture layout planning requirements.
- `docs/scan-algorithm-options.md`: scan pipeline route options and current prototype decision.
- `docs/archive/`: retired documents, provenance only — superseded requirement contracts plus the pre-Matt "self-loop" iteration process. Nothing there is current; never follow its instructions.
- `.scratch/room-recall-v1x/map.md`: current `wayfinder` map for durable product value, five-minute activation, and the first honest visual capture -> review -> commit loop.
- `.scratch/room-recall-v1x/issues/`: decision tickets on the map frontier; these are not implementation tickets.
- `.scratch/<feature>/spec.md`: future ready-for-agent build contract produced by `to-spec` after its decision map is clear.
- `docs/adr/`: durable decisions about data model, product scope, AR/3D strategy, and privacy.
- `docs/agents/`: workflow configuration for future agents.

## Validation

Validate with product walkthroughs and the verified prototypes. The V1 console answers all of the original prototype questions and is asserted by `node prototype-v2/src/verify.ts` (mapped to `docs/nestory-v1-prd.md` §5):

- Can the user add a room, zone, container, and item quickly? — P0.1
- Can the user ask where something is and get a credible answer? — P0.3
- Can an intent like `fitness` expand into child items? — P0.4
- Can duplicate child items merge into a single retrieval plan? — P0.4
- Can the system explain uncertainty instead of inventing certainty? — P0.2/P0.3
- Can a move be packed, tracked, and unpacked without losing memory? — P0.5
- Does every uncertain capture pass through review before becoming truth? — P0.6
- Can a brand-new user set up a home and start an operation in one guided session? — P0.9
- Can an agent answer only through tools, with decisions gated on user consent? — §6 (Ask surface, runtime, CLI)
- Can the memory outlive the browser tab and expose the same contract over HTTP? — P0.10 (sync service)
- Can a real model be scored against the answer contract, repeatably? — §6 (eval harness)
