# RoomRecall Product Requirements

Status: draft, superseded for strategic framing by `docs/nestory-product-framework.md`

## Current Strategic Frame

The current product direction is `Nestory`:

> A memory system for your home.

This PRD still contains the detailed Place Graph, scan, 2D/3D, layout, and Agent requirements proven by the RoomRecall V40 prototype. The strategic frame has moved up one level: the product should not be sold as a 3D room model or a simple "find my stuff" app. It should be designed as a home memory system for belongings, containers, moving, unpacking, kits, and spatial review.

Use `docs/nestory-product-framework.md` for the current product hierarchy and V1 wedge. Use this document for detailed data contracts and acceptance criteria.

## Product Thesis

RoomRecall is a personal spatial memory system for rented rooms and small homes. Its job is not to create a perfect 3D replica of the home; its job is to make physical objects, containers, layouts, and activity kits recoverable.

The canonical model is the Place Graph. 2D, 3D, visual scan, product intake, and Agent chat are different ways to read or update that graph.

## Target User

The first user is a person living in a rented room or small apartment who has many objects spread across desks, wardrobes, bags, boxes, drawers, shelves, and corners. They want the room to become searchable without maintaining a heavy inventory database.

## Core Jobs

1. Find a specific object.
2. Understand what is inside a container.
3. Prepare for an activity such as fitness, travel, cleaning, repair, or work.
4. Update reality quickly when an object moves.
5. Reconstruct or plan the room enough to reason about storage, collisions, and usable space.
6. Understand whether an answer is trustworthy, stale, inferred, or uncertain.

## Product Principles

- Searchable memory first, photorealistic 3D second.
- Visual scan proposes; the user confirms; commit mutates the Place Graph.
- Every location answer should cite evidence and confidence.
- Containers are first-class. `inside the second drawer` is more useful than raw coordinates.
- Default home and current place are different fields.
- A wrong answer should create a recovery flow, not a dead end.
- 3D is for trust and spatial intuition; 2D is for precise editing and layout planning.
- Product/manual intake is a valid creation path when scan cannot identify an object or exact dimensions matter.

## System Objects

### Place Graph

The Place Graph connects rooms, zones, furniture, containers, items, item groups, placements, evidence, and intent kits.

Minimum node types:

- `Room`: top-level space.
- `Zone`: semantic area inside a room.
- `Furniture`: movable or fixed anchor with dimensions and orientation.
- `Container`: actionable storage place, including drawers, shelves, boxes, bags, baskets, cabinets, and suitcases.
- `ItemKind`: normalized object category.
- `Item`: one physical object.
- `ItemGroup`: repeated or fungible objects.
- `IntentKit`: an activity that expands into required and optional items.

Minimum edge/record types:

- `ScanSession`: a bounded visual capture event with scope, media, anchors, coverage, privacy status, and failure reasons.
- `Observation`: raw or interpreted signal from scan, photo, text, voice, drag, or manual edit.
- `ScanProposal`: reviewable proposal created from one or more observations.
- `CoordinateFrame`: metric room-local frame with origin, axes, projection rule, anchor source, and confidence.
- `GeometryRecord`: versioned dimensions, position, orientation, collision envelope, and source for rooms, furniture, containers, or item footprints.
- `PlacementRecord`: append-only placement fact with time, relation, evidence, confidence, and status.
- `KitRequirement`: links an intent kit to an item kind, item, group, substitute, or consumable.
- `CommitLedgerEntry`: atomic write record for accepted changes to the Place Graph or layout model.
- `ContainerSnapshot`: timestamped visual or manual record of a drawer, shelf, bag, box, basket, cabinet, or suitcase.

### Item Fields

Each item should support:

- name, aliases, tags, kind
- dimensions and footprint when known
- default home
- current place or non-room state
- kit membership
- evidence history
- confidence
- lifecycle state

### Placement Fields

Each placement record should include:

- target item or item group
- room, zone, furniture, container, and relation
- relative position when available
- timestamp
- source: manual, scan, product intake, voice, text, drag, Agent, correction
- confidence
- status: current, superseded, contradicted, missing, confirmed

## Core Data Contracts

### Spatial Hierarchy

The default hierarchy is:

```text
Room -> Zone -> Furniture -> Container -> nested Container -> Item or ItemGroup
```

Rules:

- A breadcrumb is derived from the typed hierarchy, not manually stored as the source of truth.
- `Furniture` anchors physical geometry and can contain containers.
- `Container` is the actionable storage target where a user can look.
- `Item` and `ItemGroup` can also be in a `NonRoomState`, such as with me, packed, laundry, drying, lent out, consumed, missing, or retired.
- `Default Home` is a stable expected return place and is not overwritten by a normal move, scan, or drag.
- `Current Place` is a projection from the most trustworthy active placement record or non-room state.

### Observation to Commit Chain

All update sources should follow one chain:

```text
Input -> Observation -> Proposal or Draft -> CommitLedgerEntry -> PlacementRecord or LayoutRecord
```

Rules:

- Observations are append-only and never directly mutate the Place Graph.
- Proposals and drafts are reviewable typed diffs.
- Commit is atomic, traceable, and undoable.
- Old records are marked `superseded`, `contradicted`, `stale`, or `missing`; they are not silently deleted.
- `Evidence` and `confidence` are separate: evidence is material or confirmation, confidence is an interpretation.

### Coordinate and Geometry Contract

RoomRecall separates semantic place from geometric pose.

Coordinate frames:

- `RoomFrame`: local room coordinate system. V1 origin is room center on the floor, unit is meters, `+x` points to the right side of the 2D plan, `+z` points downward in the 2D plan, and `+y` points upward in 3D.
- `WorldFrame`: multi-room or multi-scan global frame. In the single-room prototype, `WorldFrame == RoomFrame`.
- `PlanFrame`: normalized 2D projection of the room frame. It is a UI frame, not stored as canonical data.
- `ScreenFrame`: DOM pixels, WebGL NDC, camera coordinates, and pointer coordinates. It is input/rendering state and must not enter the Place Graph.
- `ParentLocalFrame`: local frame for furniture, container, shelf, drawer, or bag internals.

Geometry rules:

- `GeometryRecord` is the append-only committed record for room, furniture, container, and item geometry.
- `PlacementRecord` answers where an item is semantically; `GeometryRecord` answers how places are shaped and positioned.
- `Current Place` may cache a resolved pose, but the cache is derived from active placement plus latest geometry and can be discarded.
- `location` strings and breadcrumbs are display fields derived from typed hierarchy and placement records.
- If a placement only says `inside second drawer`, the system must not invent a precise room-level x/z point.
- Coordinate round-trip between room frame and plan frame should stay within 1cm or 0.5px equivalent for in-bounds points.
- 2D drag, 3D drag, scan commit, scripted move, and product intake should all create observations or drafts before becoming committed records.

Geometry fields should include:

- subject type and subject id
- frame id and optional parent frame id
- pose: x, y, z, yaw
- extent: width, depth, height
- footprint and optional clearance envelope
- dimension source per field
- dimension verification status per field
- scale anchor evidence
- observation id, proposal id, commit id, and evidence ids
- confidence and record status

Dimension source values should not double as verification status:

- `DimensionSource`: manual measurement, scan estimate, product specification, derived value, user-confirmed measurement
- `DimensionVerificationStatus`: unverified, reviewed, confirmed, conflicted

Spatial relation values should remain spatial:

- inside, on surface, under, attached to, adjacent to, front of, behind, left of, right of, near

Lifecycle states such as with me, packed, laundry, drying, lent out, consumed, missing, and retired stay in `NonRoomState`, not in `SpatialRelation`.

### Required Field Groups

`PlacementRecord` should include:

- subject id and subject type
- target container, furniture, zone, room, or non-room state
- relation, such as inside, on, under, near, packed in, with user
- observed time and recorded time
- source type and actor
- observation id and evidence ids
- confidence score and confidence label
- record status and superseded record id

`Observation` should include:

- channel: scan, photo, text, voice, drag, manual edit, Agent, correction
- actor: user, system, local model, cloud model
- raw input reference when retained
- happened time and recorded time
- evidence ids
- interpreted entities
- resulting proposal ids

`Evidence` should include:

- kind: photo, video, frame, text note, voice note, user confirmation, not-there report, product information
- captured time
- storage reference
- sensitivity level
- local/cloud/derived provenance
- retention state

### Enum Separation

Do not reuse one label for different meanings. Keep these categories separate:

- `sourceType`: manual, scan, product intake, voice, text, drag, Agent, correction
- `recordStatus`: current, superseded, contradicted, missing, retired
- `confidenceLabel`: confirmed, recent, inferred, stale, conflicting, unknown
- `lifecycleState`: at home, with me, in transit, packed, laundry, drying, lent out, consumed, missing, retired
- `sensitivityLevel`: normal, private, sensitive, restricted

## P0 Requirements

P0 proves RoomRecall is useful as a spatial memory system before it becomes a precise reconstruction product.

### P0.1 Manual Spatial Inventory

The user can create rooms, zones, containers, items, and item groups.

Acceptance:

- User can add an item with name, tags, optional dimensions, default home, and current place.
- User can place an item inside a container.
- User can view a breadcrumb such as `Bedroom > Wardrobe > Second drawer > Black training shirt`.
- User can distinguish individual items from repeated item groups.

### P0.2 Locate

The user can ask where an item is and get a credible answer.

Acceptance:

- Search matches names, aliases, tags, kit membership, and container names.
- Result shows place, breadcrumb, confidence, evidence, and last update time.
- If multiple items match, the Agent asks for clarification before jumping.
- If confidence is low, the answer states uncertainty.

### P0.3 Intent Kits

The user can ask for an activity and get a merged retrieval plan.

Acceptance:

- `fitness` expands into required and optional child items.
- Duplicate or shared items merge into one retrieval plan.
- Each retrieval row shows item, place, confidence, and state.
- The kit has progress states: to get, found, packed, skipped, substituted, uncertain.

### P0.4 Low-Friction Update

The user can update reality without opening a heavy inventory flow.

Acceptance:

- User can update placement by quick text, voice-shaped command, drag, or one-tap confirmation.
- Every update creates a placement record.
- User can undo the most recent placement update.
- Moving an object can update current place without changing default home.

### P0.5 Wrong-Location Recovery

The user can report that an item was not where RoomRecall said it was.

Acceptance:

- Item detail includes `Not there`.
- The system marks the old placement as contradicted or missing.
- The system suggests nearby containers and recent places.
- When the user records the found place, confidence and evidence history update.

### P0.6 Evidence and Confidence

RoomRecall must not sound more certain than its evidence.

Acceptance:

- Each answer exposes one of: confirmed, recently seen, manually noted, scan-derived, stale, conflicting, unknown.
- Stale placements are visually marked.
- Agent explanations cite evidence instead of inventing certainty.

### P0.7 Observation Inbox

Every meaningful input enters RoomRecall as an observation before it becomes a fact.

Acceptance:

- Scan, photo, voice, text, drag, manual edit, and `Not there` actions create observations.
- Observations record source, actor, timestamp, evidence, interpreted entities, confidence, and privacy status.
- Observations do not directly change current place, room layout, or container contents.
- Observations can express unknown, occluded, hidden, or conflicting information.

### P0.8 Entity Reconciliation

RoomRecall must avoid duplicate rooms, furniture, containers, items, and item groups.

Acceptance:

- New candidates must be classified as `match existing`, `create new`, or `merge`.
- Candidate matching uses name, aliases, item kind, dimensions, default home, current place, evidence, and scan proximity.
- Ambiguous matches require user review before commit.
- Merges preserve source records and can be undone.

### P0.9 Commit Ledger

Every committed change should be traceable and reversible.

Acceptance:

- Commit creates an atomic ledger entry with before/after diff, source observations or proposals, affected records, and timestamp.
- Commit either succeeds as a whole or fails without partial mutation.
- Commit can supersede or contradict old placement records without deleting them.
- The latest committed update can be undone from the user-facing flow.

### P0.10 Local-First Privacy Baseline

RoomRecall contains highly personal home data and must be useful before any cloud sync or cloud model is enabled.

Acceptance:

- Add, search, update, locate, kit, and proposal review work offline for locally stored data.
- Raw room scans, container photos, OCR text, embeddings, Agent transcripts, and Place Graph facts do not leave the device without explicit per-action consent.
- Sensitive evidence can be hidden from Agent context by default.
- User can delete or export local data without needing a cloud account.

### P0.11 Non-Room State and Expected Return

Items can be outside the room memory graph without being lost.

Acceptance:

- Current state can be `at home`, `with me`, `laundry`, `packed`, `lent out`, `consumed`, `discarded`, or unknown.
- Locate answers separate default home, current place or non-room state, last-seen place, and expected return.
- Expected return can be set, postponed, cleared, or converted into a placement update.
- Kit and locate flows must not claim an item is missing merely because it is in a known non-room state.

### P0.12 Container Contents Contract

Containers are first-class memory surfaces, not only labels in breadcrumbs.

Acceptance:

- User can ask what is inside a container such as `Wardrobe second drawer`.
- Container contents distinguish confirmed present, likely present, missing candidate, unknown or unchecked, and occluded or closed.
- Each container snapshot shows last confirmation time, evidence source, coverage state, and confidence.
- A container-level placement must not be rendered as a precise object pose unless the evidence supports that precision.

### P0.13 Coverage and Unknown Boundary

RoomRecall must show what it knows and what it has not checked.

Acceptance:

- Rooms, zones, containers, and kit sessions have coverage states: not started, partial, reviewed, stale, blocked, or redacted.
- The system never treats an uncovered region as empty.
- Locate and kit answers can say which missing requirements are in uncovered or stale areas.
- Scans and manual reviews can improve coverage without forcing a whole-room rebuild.

### P0.14 Maintenance and Decay Loop

The memory graph should get refreshed through lightweight daily corrections.

Acceptance:

- `Not there`, kit completion, return-home review, container snapshot change, and non-room state change can trigger a small confirmation flow.
- Deferred confirmations lower freshness or confidence instead of leaving records unchanged.
- Maintenance prompts are batched and suppressible; they should not interrupt urgent locate or kit flows.
- The system tracks freshness separately from confidence.

### P0.15 ItemGroup and Substitute Satisfaction

Kits should work with replaceable items without forcing instance-level tracking.

Acceptance:

- A kit requirement can target a specific item or an item group.
- An item group requirement can be satisfied by any available member that meets constraints such as clean, charged, not packed elsewhere, or not lent out.
- Substitution records which member was used and why it satisfied the requirement.
- The Agent distinguishes `must be this item` from `any suitable item`.

## P1 Requirements

P1 makes RoomRecall easier to initialize and more useful for room layout decisions.

### P1.1 Product Intake

The user can create an item from product or manual information.

Acceptance:

- User can input name, type, width, depth, height, tags, kit, and default place.
- Dimensions are stored in a consistent unit and converted into a model footprint.
- Product/manual source is kept as evidence.
- Later scans can match against product-created items instead of creating duplicates.

### P1.2 Visual Scan Proposal

The user can scan a room, furniture area, container, or item and receive reviewable proposals.

Acceptance:

- Scan produces proposals, not canonical truth.
- Proposals can include room boundary, furniture, containers, item candidates, dimensions, tags, and placements.
- User can accept, reject, edit, and commit proposals.
- Commit is the only action that mutates the Place Graph or layout model.
- Rejected proposals remain available as scan history.

### P1.3 3D Scan Review

The user can review scan results as approximate 3D geometry.

Acceptance:

- Pending scan proposals appear as translucent 3D ghost geometry.
- Accepted proposals change visual state but do not apply until commit.
- 3D review highlights rough scale, orientation, and spatial mismatch.
- 2D plan remains available for precise correction.

### P1.4 2D Layout Planning

The user can manually test furniture placement before moving real furniture.

Acceptance:

- User can add or edit furniture dimensions.
- User can drag furniture in 2D.
- User can rotate furniture in 90-degree steps.
- System detects hard collisions and room-bound violations.
- System shows path clearance, center openness, storage volume, and conflict count.

### P1.5 Container Snapshots

The user can update a drawer, box, bag, or shelf without rescanning the whole room.

Acceptance:

- Container can store latest visual snapshot.
- Snapshot has timestamp and evidence.
- User can mark which visible items changed since previous snapshot.
- Container snapshot can create item or item-group placement proposals.

### P1.6 Scan Session Quality Gate

Visual scan must report whether the capture is good enough to produce trustworthy proposals.

Acceptance:

- Each scan session records scope, target node, room id, coordinate frame id, input type, timestamps, media ids, known size anchors, coverage scores, privacy status, and failure reason.
- Anchors distinguish global room anchors from local target anchors.
- Global anchors can raise room geometry confidence; local anchors only improve the related furniture, container, item, or proposal.
- Coverage is split into geometry coverage, semantic coverage, region coverage, and pass/partial/fail status.
- Occlusion distinguishes unseen, seen-empty, closed container, physically occluded, and privacy-redacted regions.
- Quality gate outputs one of: high-confidence proposals allowed, partial draft only, or blocked.
- Room scan can produce high-confidence geometry only when coverage and scale anchor requirements are met.
- Partial scans can produce partial drafts without pretending the whole room is known.
- Container scan can update one drawer, shelf, box, or bag without requiring a whole-room rescan.
- Each proposal traces back to scan session, anchor, coverage, and occlusion constraints.
- Room draft is reviewable within 5 minutes; a single container scan is reviewable within 30 seconds.

### P1.6a Scan Decision Contract

The product contract for scanning is a user-visible decision chain, not a hidden model result.

Acceptance:

- Scan flow is represented as `capture -> local preflight -> reconstruction job -> observations -> proposals -> commit`.
- Each scan reports whether it can produce high-confidence proposals, partial draft only, or blocked output.
- Each candidate must resolve identity as `match existing`, `create new`, or `merge` before commit.
- If evidence only supports a container-level answer, RoomRecall must not invent precise room-level coordinates.
- Privacy-redacted regions can only produce private-redacted or unknown output until the user reviews them.
- When furniture or container geometry changes, affected child placements enter review or lower confidence instead of silently staying confirmed.
- Commit preview must show geometry operations, placement operations, affected views, stale placements, and undo availability.

### P1.6b Coordinate Contract

RoomRecall must keep semantic placement, metric geometry, and scan evidence in separate but linkable coordinate records.

Acceptance:

- Every room has a `CoordinateFrame` with unit, origin, axes, projection rule, anchor list, and expected error budget.
- V1 prototype treats `WorldFrame` and `RoomFrame` as the same single-room frame; `PlanFrame` is a UI projection and `ScreenFrame` is never persisted.
- Canonical geometry uses meters for position/dimensions and radians for yaw; UI may accept centimeters but must convert deterministically.
- Furniture and containers can define local coordinate frames under the room frame.
- Anchor records include scope, subject, anchor type, measured value, observations, residual error, and confidence.
- An item can be known at room, furniture, or container granularity without pretending a more precise coordinate exists.
- The UI shows world coordinates, local coordinates when available, source, and expected error.
- Error contract includes pose error, extent error, yaw error, anchor residual, projection round-trip error, and collision margin.
- Known-size anchors, scan drift, and scale error are visible in scan review and backend contract previews.
- Coordinate conversion between 2D plan percent and room meters is deterministic and testable.
- Moving or resizing parent furniture updates derived container world frames and marks affected child placements for review in a production implementation.

### P1.6c Collision Envelope Contract

Layout planning must check whether furniture fits physically and whether it remains usable after placement.

Acceptance:

- Furniture collision checks include footprint bounds, room bounds, keep-out zones, and overlap against other furniture.
- Interaction envelopes can represent drawer pull-out, cabinet swing, chair pull-back, bed-side access, and route clearance.
- The user can see hard conflicts separately from soft warnings.
- Route clearance checks static obstacles and interaction envelopes.
- Containers record inner usable dimensions and opening dimensions; item placement into a container runs fit and volume checks.
- Storage metrics distinguish gross volume, usable volume, and accessible volume.
- Collision results must be available in both the visual UI and the backend layout snapshot.

### P1.6d Backend Write-Model Contract

Backend payloads should be shaped like records that can become a Place Graph ledger, not only UI summaries.

Acceptance:

- Contract preview exposes coordinate frames, anchor records, container frames, geometry records, placement records, collision results, scan proposals, and commit preview as separate record groups.
- Geometry mutations and placement mutations are separate operation lists.
- Parent furniture move, rotate, or resize emits stale placement operations for affected child placements.
- Placement records include subject, target furniture/container when known, relation, granularity, status, confidence, source, local coordinate when supported, and world pose cache only as derived data when precision is limited.
- Collision results are structured by check type, severity, status, margin, blocker, and user-facing message in a production implementation.

### P1.6e Prototype Acceptance Contract

The prototype should prove that spatial state is coherent across UI, 3D, 2D, and backend preview.

Acceptance:

- 2D plan visibly renders furniture blocks, item pins, scan proposals, keep-out regions, unknown/redacted scan regions, coordinate anchors, and interaction envelopes.
- 3D view visibly renders scan point cloud, proposal ghosts, and coordinate anchors when scan or layout context is active.
- Backend preview exposes write-model records and stale placement operations.
- Automated verification checks coordinate round-trip, container-local reconstruction, DOM overlay counts, backend contract invariants, scan proposal lifecycle, furniture collision metrics, and affected placement review.
- The prototype may remain deterministic and fake-data-driven, but it must not hide state inconsistencies behind static screenshots.

### P1.7 Proposal Diff Review

Scan proposals should be typed diffs, not vague suggestions.

Acceptance:

- Each proposal includes action, target id, patch, source observations, confidence, conflicts, privacy status, and review state.
- User can accept, reject, edit, batch review, and partially commit proposals.
- Identity conflicts force `match existing`, `create new`, or `merge` before commit.
- 2D and 3D views show the same proposal state.

### P1.8 Incremental Rescan and Revalidation

RoomRecall should handle normal room drift without rebuilding the whole model.

Acceptance:

- Rescanning a room, furniture area, or container generates a diff against the last committed state.
- Changed furniture or container geometry marks affected child placements as stale or lower confidence.
- Removed or unseen objects become unknown, occluded, hidden, or missing candidates instead of being silently deleted.
- User can see which placements need review after a rescan.

### P1.9 Layout Constraints and Keep-Out Zones

Layout planning should respect real-world use constraints, not only rectangle overlap.

Acceptance:

- Door openings, window areas, entry paths, wall gaps, chair pull-back, drawer pull-out, and cabinet door swing can be represented as constraints.
- Layout cannot recommend a hard collision, out-of-bounds placement, blocked opening, or blocked keep-out zone.
- Dimensions can be marked estimated, scanned, product-derived, or confirmed.
- Containers track internal usable dimensions when available.

### P1.10 Layout Impact Review

Furniture movement should not silently damage the memory graph.

Acceptance:

- Moving or resizing furniture lists affected containers and item placements before commit.
- Affected placements can be marked stale, lower confidence, or requiring rescan.
- User sees before/after metrics for clearance, usable storage, center openness, hard conflicts, and high-frequency access.
- 2D preview and 3D preview use the same geometry.

### P1.11 Sensitive Evidence Protection

RoomRecall should protect sensitive surfaces before they become searchable or Agent-readable.

Acceptance:

- Documents, passports, medical labels, receipts, screens, mail labels, faces, and addresses default to sensitive.
- Sensitive image regions are hidden or redacted before OCR, cloud upload, sync, export, or Agent context.
- User can explicitly reveal or authorize a sensitive evidence item.
- Redacted regions do not enter search, Agent context, sync, or export unless explicitly authorized.

## P2 Requirements

P2 explores stronger automation and richer spatial interfaces.

### P2.1 Vision-Based Reconstruction

RoomRecall can reconstruct a rough room model from camera input.

Acceptance:

- Uses phone video or photos plus at least one known size anchor.
- Produces editable room boundary, furniture cuboids, and container candidates.
- Reports scan coverage and uncertainty.
- Does not require specialized hardware for the first useful version.

### P2.2 Agent Layout Suggestions

The Agent can suggest furniture changes to improve storage and openness.

Acceptance:

- Suggestions cite collision, clearance, frequency, and storage metrics.
- User can preview a suggested layout before applying it.
- Suggestions do not move canonical item placements without confirmation.

### P2.3 Parametric Kits

Intent kits adapt to context.

Acceptance:

- `travel` can ask duration and destination.
- `fitness after work` can include commute-specific items.
- Kit can show blockers such as dirty, missing, outside home, low confidence, or consumed.

### P2.4 3D Cutaway Levels

The 3D view can reveal nested spaces progressively.

Acceptance:

- Supports room, zone, container, and item focus levels.
- Transparent views do not show every hidden object at once.
- Selection persists between 3D, 2D, list, and Agent answer.

### P2.5 Multi-Session Scan Fusion

RoomRecall can combine multiple scans into a more stable model over time.

Acceptance:

- Multiple room or container scan sessions can align to a stable coordinate frame.
- The system reports drift, conflicts, and changed geometry.
- History can show how a room or container changed between scan sessions.
- Fusion never overwrites committed facts without proposal review.

### P2.6 Guided Capture

RoomRecall can guide the user toward better scan evidence.

Acceptance:

- System highlights low-coverage zones, low-confidence furniture, occluded containers, and conflicting observations.
- User receives concrete capture prompts such as scan wardrobe left side, open second drawer, or add one known measurement.
- Guided capture updates the same scan session or creates a linked follow-up session.
- Guidance prioritizes high-value or high-uncertainty areas instead of asking for exhaustive scanning.

### P2.7 Constraint-Based Layout Suggestions

The Agent can propose layout changes using explicit constraints and tradeoffs.

Acceptance:

- Suggestions include baseline comparison, rule explanation, preview delta, and affected placements.
- User can accept, reject, or edit each suggestion.
- Suggestions cannot recommend hard collisions, blocked keep-out zones, or path clearance below required threshold.
- Tradeoffs are explicit when storage improves but high-frequency access worsens.

### P2.8 Privacy-Preserving Sync and Export

RoomRecall can sync or export data without collapsing all data into one privacy level.

Acceptance:

- Export supports graph-only, graph plus redacted evidence, and full encrypted archive.
- Export manifest includes source, timestamp, confidence, sensitivity, locality, and derived-data provenance.
- Sync can exclude raw media, OCR text, embeddings, Agent transcripts, or sensitive evidence.
- Outbound data has a user-visible audit log with destination, data categories, timestamp, and purpose.

## Key User Journeys

### Journey A: Find One Object

1. User searches `black gym shirt`.
2. RoomRecall returns the most likely item with breadcrumb, evidence, and confidence.
3. User locates the item in 3D or 2D.
4. If not found, user taps `Not there`.
5. RoomRecall preserves the failed answer and helps record the true place.

### Journey B: Prepare for Fitness

1. User asks for `fitness`.
2. Agent expands the kit into required and optional items.
3. Duplicates merge into one retrieval plan.
4. User marks items as found or packed.
5. After returning, RoomRecall asks which items returned home, stayed in bag, became dirty, or moved.

### Journey C: Initialize a Room

1. User scans the room with phone video.
2. RoomRecall creates room and furniture proposals.
3. 3D view shows ghost geometry for trust review.
4. User edits dimensions and positions in 2D.
5. User commits accepted proposals to the Place Graph.

### Journey D: Add a Product

1. User enters product or item name and dimensions.
2. User adds tags, kit, and default place.
3. RoomRecall creates an item with size prior and source evidence.
4. Later scan or drag placement grounds the item to a current place.

### Journey E: Rearrange Furniture

1. User enters or scans furniture dimensions.
2. User drags furniture in 2D.
3. RoomRecall flags collisions, path problems, and openness changes.
4. User previews a better layout before moving real furniture.

### Journey F: Correct a Scan

1. User scans a drawer or room corner.
2. RoomRecall creates observations and proposals.
3. User sees which proposals match existing objects, create new objects, or conflict with current memory.
4. User accepts one proposal, rejects another, edits a third, then commits.
5. RoomRecall writes a commit summary and marks affected placements stale or superseded.

### Journey G: Protect Sensitive Evidence

1. User scans a desk that includes a passport, screen, receipt, or medicine label.
2. RoomRecall marks the sensitive region hidden before OCR, Agent access, sync, or export.
3. User can crop, redact, reveal, or keep it local-only.
4. Locate and kit answers can cite the redacted graph fact without exposing raw media.

## Agent Behavior Requirements

The Agent should behave like a spatial memory assistant, not a magic oracle.

- It should answer with evidence and uncertainty.
- It should ask clarifying questions when identity or location is ambiguous.
- It should prefer containment breadcrumbs over coordinates.
- It should never silently change the Place Graph from a scan, inference, or suggestion.
- It should use `not there` feedback as evidence.
- It should expand broad intents into kit requirements.
- It should merge duplicate requirements.
- It should separate default home, current place, last seen, and expected return.

Example answer shape:

```text
Black training shirt is probably in Bedroom > Wardrobe > Second drawer.
Evidence: manual note, updated 2 days ago. Confidence: 82%.
It is also part of Fitness kit. If it is not there, check Laundry bag next.
```

### Conversation State Machine

The Agent should use explicit conversational states:

```text
locate -> clarify -> answer -> fail -> correct -> commit update
kit request -> parameter clarify -> retrieval plan -> progress -> return-home review
update command -> parse draft -> confirm -> commit -> undo window
```

Acceptance:

- Agent asks a clarification question only when the answer changes the user's next action.
- Clarification should usually be one high-information question, not a broad interview.
- Locate clarification order is identity first, lifecycle state second, spatial area third.
- Kit clarification asks at most two high-impact parameters before producing a usable default plan.
- Natural-language updates are parsed into a draft that shows subject, source place, target place, lifecycle state change, and confidence.
- Low-confidence parses require confirmation before commit.

### Locate Ranking and Failure Recovery

Acceptance:

- Locate ranks candidates by exact name, alias, item kind, kit relevance, current place confidence, evidence age, and lifecycle state.
- Multiple high-confidence candidates require disambiguation before camera jump or route display.
- `Not there` creates negative evidence and marks the prior answer contradicted or stale.
- After `Not there`, Agent suggests nearby containers, recent places, and non-room states before asking the user to manually start over.
- Correction from failed answer to new placement should complete in one short flow.

### Evidence Explanation Contract

Every Agent answer should separate:

- current judgment
- supporting evidence
- uncertainty or conflict
- next useful action

Acceptance:

- Agent language distinguishes observed facts from inference.
- Evidence citations mention source type, age, and confidence label.
- Agent never claims a scan saw an item move unless an observation or user confirmation supports that claim.
- Answers for sensitive items hide details unless the user unlocks or authorizes them.

### Kit Session Rules

Acceptance:

- Kit output separates required, optional, substitute, shared, consumable, and blocked requirements.
- Readiness explains why the user can or cannot leave now.
- User can update a kit session with short commands such as already got shoes, skip towel, use spare charger, or bottle is dirty.
- Return-home review can update current place and lifecycle state without changing default home.

## Non-Goals

- Photorealistic home rendering.
- Fully automatic inventory with no user review.
- Real-time object tracking.
- Replacing interior design or CAD tools.
- Multi-user household management.
- Shopping recommendations.
- Cloud-only storage for home scans.

## Privacy and Security Requirements

RoomRecall's data is intimate home data. Privacy is part of the product contract, not a later settings page.

### Data Classes

The system should distinguish:

- raw room scan media
- item and container media
- document, medical, receipt, screen, and identity media
- derived OCR text, labels, embeddings, geometry, and thumbnails
- Place Graph facts
- Agent transcripts and tool logs

Acceptance:

- Each data class has locality, visibility, retention, exportability, and Agent access rules.
- Raw media, OCR, embeddings, and Agent transcripts are local-only by default.
- Cloud processing is per-action opt-in and states what data leaves the device.

### Redaction and Access

Acceptance:

- Sensitive evidence is hidden from search, OCR, Agent context, sync, and export until authorized.
- User can crop, redact, reveal, or mark evidence sensitive.
- Agent sessions default to Place Graph facts and redacted metadata, not raw media.
- Mutation by Agent always shows a diff and requires commit.

### Delete and Retention

Acceptance:

- User can delete evidence while keeping a graph fact, or delete both evidence and derived facts.
- Deleting evidence clears raw file, thumbnail, OCR text, embedding, proposal cache, sync queue, and Agent citation cache.
- Rejected proposals, superseded evidence, and container snapshots have visible retention policies.
- Append-only history must not prevent user-controlled deletion of sensitive evidence.

### Export and Audit

Acceptance:

- Export supports graph-only, redacted evidence package, and full encrypted archive.
- Export manifest lists source, timestamp, confidence, sensitivity, local/cloud/derived provenance, and retention state.
- Any outbound sync, cloud analysis, or export writes an audit entry with destination, data class, purpose, and time.

## Risks

- The Place Graph decays if updates take too long.
- Visual scanning may overpromise if proposals look too authoritative.
- Too many item-level records can become maintenance burden.
- Private documents and room photos require strong local-first defaults.
- 3D transparency can become visual noise if cutaway levels are not constrained.
- Layout planning can drift into CAD complexity if scope is not guarded.
- Append-only memory can conflict with deletion rights unless evidence and facts have separate retention semantics.
- Agent convenience can leak private media if raw evidence is allowed into context by default.

## Validation Plan

### Prototype Validation

- Verify that a user can locate one known item.
- Verify that `Not there` creates negative evidence, marks the prior placement contradicted, and closes with a corrected placement.
- Verify that a user can open `fitness` and understand what to collect.
- Verify that product intake creates a mapped item with usable dimensions.
- Verify that a scan draft appears as reviewable 3D proposals.
- Verify that 2D furniture dragging produces collision and clearance feedback.
- Verify that observations, proposals, commits, and placement records remain distinct.
- Verify that sensitive evidence stays out of Agent context by default.

### Self-Loop Validation

RoomRecall development should run through a repeatable research-modify-verify loop.

Acceptance:

- Every iteration runs `node prototype/verify.mjs` before being considered done.
- Every iteration runs `node prototype/self-loop.mjs` to produce a loop score and next iteration queue.
- Self-loop probes distinguish documented contracts from prototype implementation.
- A false positive in the loop is treated as a product bug and corrected before adding scope.
- The next patch is chosen from the highest-risk failing probe, with `find -> Not there -> corrected placement` treated as the first killer loop.

### Product Validation

- Update friction: normal moved-item update under 5 seconds.
- Search success: user finds a known item without exact name.
- Scan quality: editable room draft in under 5 minutes.
- Correction speed: `Not there` to corrected placement in under 20 seconds.
- Kit readiness: user can decide whether they can leave for an activity.
- Trust: user can explain why the system believes an item is where it says it is.
- Scan funnel: capture success, proposal acceptance rate, duplicate rate, manual correction load, and post-commit error rate.
- Agent quality: clarification turns, wrong-location recovery rate, evidence explanation comprehension, and unsafe mutation prevention.
- Layout usefulness: hard conflicts, keep-out violations, path clearance, usable storage, high-frequency access, and affected placement review.
- Privacy: offline usability, unauthorized outbound request count, redaction correctness, deletion completeness, and export manifest completeness.

## Near-Term Build Order

1. Placement history and default home/current place split.
2. Observation inbox and commit ledger.
3. Entity reconciliation for match, create, and merge.
4. `Not there` recovery flow with negative evidence.
5. Split the right panel into Selection, Retrieval, Spatial Frame, Layout Health, Scan Diff, and Contract scopes.
6. Agent conversation state machine and natural-language update drafts.
7. Kit readiness, retrieval progress, and return-home review.
8. Product intake with dimensions, tags, default home, and sensitive source handling.
9. 3D scan proposal review, proposal diff, and commit.
10. Container snapshots and incremental rescan.
11. Layout keep-out zones, main paths, usable storage, and impact review.
12. 2D drill-down from room to zone to container.
13. Privacy export, deletion, and audit trail.
