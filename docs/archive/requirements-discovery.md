# RoomRecall Requirements Discovery

Status: discovery

## Product Thesis

RoomRecall should not start as a perfect 3D reconstruction tool. The deeper product is a recoverable spatial memory system: it helps the user recover where an object probably is, why the system believes that, what to do when the answer is wrong, and which objects are needed for a broader intent.

The prototype proves that 3D, 2D plan editing, search, object placement, rotation, confidence, evidence, and activity kits can live in one experience. The next requirement step is to turn those visible interactions into a reliable product loop.

## Post-Prototype Discovery Shift

The prototype has already shown that a room can be made searchable and visually explorable. The next validation should shift away from "can the 3D view exist?" and toward these harder questions:

- Can the user update a moved object in under 5 seconds?
- Can the system distinguish default home, current location, and last-seen location?
- Can an answer explain whether it is fresh, stale, inferred, or contradicted?
- Can the system recover when the user says "not there"?
- Can a kit tell the user whether they can leave now, not just where things are?
- Can RoomRecall model object states such as dirty, drying, borrowed, packed, on me, and missing?

The product should treat 2D and 3D as interaction surfaces over the memory system, not as the memory system itself.

See `docs/vision-scan-and-layout-layer.md` for the visual scan, 3D scan proposal review, typed mapping, product intake, custom furniture dimensions, and layout collision planning layer.

## New Requirement Clusters

### 1. Placement Capture Loop

When the user places or moves an object, RoomRecall must capture more than coordinates.

- Trigger: user adds an item, drags it in 2D, rotates it in 3D/2D, or says they moved it.
- Required data: item identity, room, zone, container, relative position, timestamp, evidence source, confidence, and optional note.
- MVP behavior: every placement update creates a new placement record instead of silently overwriting the old one.
- Why it matters: the system needs history to explain uncertainty and recover from wrong answers.

### 2. Default Home Position

Many objects have a default home and a current location. These are not the same.

- Trigger: user returns from gym, travel, work, laundry, or a quick errand.
- Required data: default place, current place, last-seen place, and whether the object is expected to return home.
- MVP behavior: let high-frequency items define a default position and show `not returned` when current placement differs.
- Why it matters: the most common memory failure is often "I did not put it back", not "I never knew where it belongs".

### 3. Low-Friction Update Paths

The hardest product problem is not rendering the room; it is getting the user to update reality.

- Trigger: user moves an object during normal life and does not want to open a heavy inventory flow.
- Required inputs: quick text, voice note, photo of a container, one-tap confirmation, and batch update.
- MVP behavior: support a natural-language command such as `I moved the towel to the bathroom shelf`.
- Why it matters: if updates take too long, the Place Graph decays.

### 4. Container-First Modeling

Many useful locations are not open room coordinates; they are containment relationships.

- Trigger: user puts something in a drawer, basket, wardrobe layer, bag, shoe rack, or storage box.
- Required data: container, depth or level, whether the item is visible, and whether the container must be opened.
- MVP behavior: support a fixed hierarchy: room -> zone -> container -> item.
- Why it matters: "inside the second drawer" is more actionable than a raw 3D coordinate.

### 5. Multi-View Role Separation

Each view should have a distinct job.

- 3D cutaway: spatial intuition, inspection, trust, and hidden-object overview.
- 2D plan: fast editing, precise drag placement, snap zones, and low-friction correction.
- Locate focus: path to a selected object, not a separate top-level mode.
- Kit view: grouped retrieval plan for an intent.
- MVP behavior: keep `3D` and `2D Plan` as primary projection modes, with `Locate` as an action.
- Why it matters: mixed modes make the interface feel powerful but slippery.

### 6. 3D Cutaway Levels

The 3D view should reveal the right layer, not make the whole room transparent at once.

- Trigger: user locates an item inside a wardrobe, drawer, shelf, box, or bag.
- Required states: overview, room cutaway, zone cutaway, container focus, item focus.
- MVP behavior: fixed cutaway level buttons and click-to-expand containers.
- Why it matters: transparent everything quickly becomes visual noise.

### 7. 2D Plan Drill-Down

The 2D view should support drilling from room to zone to container.

- Trigger: user wants to edit or inspect a drawer, shelf, shoe rack, or bag.
- Required states: plan.room, plan.zone, plan.container, with one shared selected item.
- MVP behavior: add `open container` and `back` navigation without modeling exact drawer geometry.
- Why it matters: precise editing is usually easier in 2D than in a full 3D scene.

### 8. Draft Move Mode

Moving an item should have a reversible draft state.

- Trigger: user clicks `Move in 2D`, drags a pin, or updates an item by voice.
- Required states: idle, moving draft, snapped candidate, committed, canceled.
- MVP behavior: show a draft placement before commit, with undo after commit.
- Why it matters: accidental drags should not corrupt the memory layer.

### 9. Snap and Semantic Placement

Dragged objects should snap to meaningful places, not arbitrary pixels.

- Trigger: user drags an item near a desk, wardrobe, shelf, bed, shoe rack, or bathroom shelf.
- Required data: zone boundaries, container hitboxes, and preferred item categories for each place.
- MVP behavior: snap to visible zones and update the placement label automatically.
- Why it matters: users think in "desk cable tray" and "wardrobe second drawer", not x/z coordinates.

### 10. Evidence and Confidence Ladder

Every answer should expose how reliable it is.

- Trigger: user searches for an item or opens a kit.
- Required levels: confirmed, recently seen, manually noted, imported scan, stale, conflicting, unknown.
- MVP behavior: show confidence, evidence, and age for every located item.
- Why it matters: a wrong confident answer is worse than an honest uncertain answer.

### 11. Wrong-Location Recovery

The product needs a first-class flow for "it was not there".

- Trigger: user follows a location answer and cannot find the object.
- Required actions: mark missing, keep searching nearby, ask where it was eventually found, update the placement, preserve the failed evidence.
- MVP behavior: add a `Not there` action on item detail.
- Why it matters: correction is how the memory system becomes trustworthy.

### 12. Activity Kit Semantics

An intent kit is more than a tag group.

- Trigger: user asks for `fitness`, `travel`, `cleaning`, `repair`, or another activity.
- Required data: required items, optional items, substitutes, shared items, consumables, freshness, and blocked items.
- MVP behavior: kit items can be required or optional, and duplicates merge into one retrieval plan.
- Why it matters: "fitness" is a task preparation workflow, not just search results.

### 13. Parametric Kits

The same intent changes by context.

- Trigger: user says `travel`, `fitness after work`, `one-night trip`, or `five-day trip`.
- Required parameters: duration, weather, destination, whether laundry is available, and whether the user goes directly from another activity.
- MVP behavior: support 2-3 kit parameters and generate different checklist variants.
- Why it matters: generic kits become noisy when they ignore context.

### 14. Kit Readiness

The system should tell the user whether an activity can start now.

- Trigger: user opens a kit.
- Required states: ready, missing item, low confidence, dirty/unwashed, outside home, borrowed, consumed.
- MVP behavior: show a readiness score and call out missing or uncertain items.
- Why it matters: the real question is often "can I leave now?"

### 15. Kit Retrieval Progress

Preparing for an activity is a session with progress.

- Trigger: user collects items for gym, travel, cleaning, repair, or work.
- Required states: to get, found, packed, skipped, substituted, uncertain.
- MVP behavior: let each kit item be marked during the current retrieval session.
- Why it matters: the user needs to know what is still missing before leaving.

### 16. Return-Home Loop

After an activity, items need to come back into the Place Graph.

- Trigger: user completes gym, travel, repair, laundry, or commute.
- Required states: with user, returned, washed, drying, misplaced, consumed.
- MVP behavior: a lightweight post-kit checklist asks what returned and what moved.
- Why it matters: the inventory decays unless usage updates feed it.

### 17. Item Granularity Rules

The product must decide when to model one object versus a category.

- Trigger: user adds socks, shirts, cables, documents, medicine, or identical small objects.
- Required types: individual item, item group, pair, set, consumable, document, container.
- MVP behavior: support `item` and `item group`, with optional quantity.
- Why it matters: exact 3D placement for every sock is not worth the friction.

### 18. Object Lifecycle States

Objects can leave the room without being lost.

- Trigger: object is borrowed, in a backpack, in laundry, drying, thrown away, packed, outside home, or consumed.
- Required states: at home, with user, in transit, lent out, being cleaned, missing, retired.
- MVP behavior: allow a non-room placement state with a note and timestamp.
- Why it matters: "not in the room" is still valuable memory.

### 19. Container Snapshot Versioning

The user often remembers a visual layout better than a text label.

- Trigger: user reorganizes a drawer, medicine box, tool box, wardrobe shelf, or travel pouch.
- Required data: container photo, snapshot timestamp, changed items, and version note.
- MVP behavior: each container can have a latest snapshot and a short `changed since last snapshot` list.
- Why it matters: bulk reorganization can make many item records stale at once.

### 20. Stale Placement Review

RoomRecall should actively surface likely-decayed memory.

- Trigger: placement evidence is old, confidence is low, or the item belongs to an upcoming kit.
- Required signals: age, movement frequency, kit importance, correction history.
- MVP behavior: mark stale placements and let the user confirm or update them.
- Why it matters: physical homes drift.

### 21. Saved Inspection Views

The user should not always start from the full room.

- Trigger: user often checks desk, wardrobe, shoe rack, bathroom shelf, or storage shelf.
- Required data: named view, camera preset, visible containers, pinned items.
- MVP behavior: support saved views such as `Desk`, `Wardrobe`, `Entry`, and `Bathroom shelf`.
- Why it matters: repeated retrieval should be faster than orbiting around the full model.

### 22. Moving and Seasonal Storage Modes

Renting means the room can be reorganized or replaced.

- Trigger: user moves home, packs boxes, changes season, stores winter clothes, or resets a room layout.
- Required states: boxed, sealed, unpacked, seasonal, archived, expected reopen date.
- MVP behavior: support named boxes and seasonal containers as special containers.
- Why it matters: major reorganization is when spatial memory breaks hardest.

### 23. Privacy and Local-First Boundary

Home geometry and object photos are sensitive.

- Trigger: user adds photos, room scans, documents, or agent-readable notes.
- Required controls: local-first storage, explicit sync, redaction for documents, delete/export.
- MVP behavior: assume local-first and record whether evidence is local, cloud, or derived.
- Why it matters: a searchable room model is deeply personal data.

### 24. Vision Scan Proposal

Scanning should initialize and update the model, but it should not silently become truth.

- Trigger: user scans a room, furniture area, container, drawer, box, bag, or shelf.
- Required data: scan source, proposed nodes, proposed dimensions, coverage quality, evidence, confidence, and review status.
- MVP behavior: support a sample scan draft that creates 3D ghost proposals and editable room/furniture/container facts before commit.
- Why it matters: visual reconstruction is valuable only if the user can correct it and the system can remember where the evidence came from.

### 25. Product and Item Intake

The user should be able to initialize objects from product information, not only from scanning.

- Trigger: user buys something, has a product page or box dimensions, or wants to add an object before it is visually recognized.
- Required data: name, item kind, width, depth, height, tags, aliases, default place, kit membership, source, and evidence.
- MVP behavior: create a mapped item with dimensions in centimeters, a model footprint in meters, default place, tags, and optional kit membership.
- Why it matters: product information gives the system an identity and size prior, which reduces duplicate scan guesses and makes volume planning more realistic.

### 26. Custom Furniture Dimensions

The user needs to model furniture and storage with realistic size.

- Trigger: user adds or edits a desk, cabinet, shelf, shoe rack, bed, or storage block.
- Required data: width, depth, height, rotation, footprint, source, confidence, and optional opening clearance.
- MVP behavior: allow manual dimension entry and 90-degree rotation in the 2D plan.
- Why it matters: layout planning and volume collision depend on dimensions, not just labels.

### 27. Layout Collision and Space Optimization

RoomRecall should help decide how to arrange furniture to save storage space and make the room feel bigger.

- Trigger: user drags or rotates furniture in the plan.
- Required data: room bounds, furniture footprint, hard collisions, path clearance, center openness, and storage volume.
- MVP behavior: detect footprint overlap, keep furniture inside the room, show narrowest path clearance, center open ratio, and hard conflict count.
- Why it matters: this extends RoomRecall from "where is it?" to "where should it go?" without becoming a full CAD tool.

## MVP Slices

1. Manual Place Graph

- Rooms, zones, containers, items, placements, evidence, and confidence.
- Search by item name and synonym.
- Item detail shows location, evidence, confidence, timestamp, and notes.

2. 2D Plan Editing

- Floor plan with draggable item pins.
- Snap to zones and containers.
- Draft, commit, cancel, and undo for moves.
- Editable furniture footprints with custom dimensions, 90-degree rotation, and collision feedback.

3. Intent Kits

- Define `fitness` and `travel` kits.
- Mark required versus optional items.
- Add simple parameters such as trip length or gym-after-work.
- Merge duplicates and show retrieval order by location.
- Track session progress: to get, found, packed, skipped.

4. Correction Loop

- `Not there` action.
- Missing state.
- "Where did you find it?" update flow.
- Placement history and confidence adjustment.

5. Object State Layer

- Default home versus current location.
- States such as clean, dirty, drying, on me, in bag, lent out, packed, missing, and retired.
- Stale placement badges and return-home reminders.

6. 3D Cutaway Trust Layer

- Transparent furniture and hidden objects.
- Camera presets for common areas.
- Selection sync with 2D plan and item list.
- Container-level cutaway, not only full-room transparency.

7. Vision Scan Proposal Layer

- Room scan creates 3D ghost proposals for room/furniture/container facts.
- Container scan creates snapshot evidence.
- Review before commit.
- Preserve scan evidence and confidence.

8. Product Intake Layer

- Create items from product or manual information.
- Store dimensions, default place, tags, and source evidence.
- Use product dimensions as priors for scan matching and layout planning.

9. Agent Layer

- Natural-language locate.
- Natural-language kit expansion.
- Clarification when multiple items match.
- Explanation that cites placement evidence.

## Validation Metrics

The next prototype should measure whether RoomRecall works as a memory system, not whether the room looks impressive.

- Update friction: can a normal move be recorded in under 5 seconds?
- Search success: can the user find a known object without remembering its exact name?
- Trust: does evidence age and confidence make the user more willing to follow an answer?
- Correction speed: after `not there`, can the user record the true location in one short flow?
- Kit readiness: can the user decide whether they can leave for gym or travel without mentally rebuilding the checklist?
- Data decay: how many placements become stale after one week of normal life?
- Granularity fit: which level feels worth tracking: item, item group, or container?
- View usefulness: how often does the user use 2D, 3D, container view, search, or kit view?
- Scan draft quality: can a room scan become an editable model in under 5 minutes?
- Layout usefulness: can the user detect collision and improve clearance before moving real furniture?

## Interaction Smoothness Requirements

- Projection and tool state should be separate. Example: projection is `3D` or `2D Plan`; tool is `view`, `locate`, `move`, or `kit`.
- Selection should persist when switching views.
- A located item should be highlighted in the room, plan, list, and detail panel at the same time.
- Dragging should never resize the layout or make labels jump.
- The system should preview the semantic target while dragging, such as `snapping to Desk, right side`.
- Rotating an item should be secondary; location and containment are more important than orientation.
- Search should rank exact object matches above kit tags, but still expose related kit membership.
- Kit mode should not hide uncertainty. It should show missing and low-confidence items clearly.
- A failed search should suggest related containers, kits, and recently moved items.
- Every destructive or trust-reducing update should have undo.
- Search results should support disambiguation before forcing a camera jump.
- Locate should show a path breadcrumb such as `Bedroom > Wardrobe > Second drawer > Black training shirt`.
- Rotation should use semantic labels where useful, such as `facing out`, `horizontal`, or `vertical`.

## Open Product Questions

- Is the first real capture flow mobile-first, desktop-first, or local web-first?
- Should the user add items one by one, by container batch, or by quick voice note?
- Which is the first "aha" demo: finding one object, opening a kit, or correcting a wrong location?
- How precise does the user need the model to be before it feels useful?
- Should photos be optional evidence, required evidence, or only used for high-value items?
- How should the system handle private documents such as passports and medical items?
- What is the default policy for identical items, such as socks, shirts, cables, and towels?
- How often should stale placement review happen without becoming annoying?
- Should RoomRecall optimize for leaving the room quickly, tidying up, or long-term inventory accuracy first?
- Should the first killer loop be `default home`, `kit readiness`, or `not there correction`?
- Which object states deserve first-class UI instead of being free-text notes?

## Near-Term Prototype Backlog

- Add a `Not there` button to item detail.
- Add placement history under the selected item.
- Add required/optional kit grouping.
- Add kit parameters for `travel` and `fitness after work`.
- Add kit readiness states.
- Add kit retrieval progress states.
- Add snap targets in the 2D plan.
- Add move draft plus undo.
- Add default home versus current location.
- Add quick command input for low-friction updates.
- Add saved inspection views for wardrobe, desk, entry, and bathroom shelf.
- Add non-room states such as `with me`, `laundry`, `lent out`, and `missing`.
- Add stale placement badges based on evidence age and confidence.
- Add a simple natural-language command box for `I moved the towel to the bathroom shelf`.
- Add container snapshots for drawers, bags, and boxes.
- Add a three-level 2D drill-down: room, zone, container.
- Add 3D cutaway levels for room, zone, and container focus.
- Add sample vision scan draft import with 3D ghost proposals.
- Add product/manual item intake with dimensions, tags, kit, and default place.
- Add editable furniture dimensions and 2D collision checks.
- Add layout clearance, storage, and openness metrics.
