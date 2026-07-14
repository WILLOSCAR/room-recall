# Nestory Product Framework

Status: strategic frame (V1 scope decided 2026-07-07 — see `docs/nestory-v1-prd.md`)

Working name: `Nestory`

Core idea:

> A memory system for your home.

## Why This Reset

The original RoomRecall prototype proved that spatial retrieval, scan proposals, 2D/3D review, layout planning, and commit-ledger readback can fit together. It also exposed a product risk: if the pitch is only "remember where a water bottle is", the maintenance cost can be higher than the pain.

The stronger product is not a 3D room model. It is a home memory system: a way to remember what exists in a living space, where it belongs, what state it is in, and what the user needs to do with it.

## Positioning

Nestory helps people organize, prepare, move, and recover their physical belongings through a searchable home memory.

It should feel like:

- a home inventory when the user wants to know what they own
- a spatial map when the user wants to know where something lives
- an operations board when the user is packing, moving, preparing, cleaning, or resetting a space
- a review surface when a scan, photo, or Agent is unsure

It should not feel like:

- a toy 3D room editor
- a warehouse inventory system for businesses
- a note app with nicer labels
- an automatic surveillance system for the home
- a promise that one phone scan can produce perfect 1:1 truth

## Product Thesis

People do not need to maintain a perfect digital twin of their home. They need memory at the moments when physical life becomes complex:

- before leaving the house
- while packing for an activity
- while moving homes
- after unpacking
- while reorganizing a small room
- when a high-value item is missing
- when a container becomes a mystery

The product should therefore make home memory cheap to create, easy to trust, and useful during concrete operations.

## Primary Wedges

### 1. Moving and Unpacking

The strongest wedge.

The user has a temporary but intense reason to record objects, boxes, rooms, and status. The pain is high enough to justify photos, labels, and light structure.

Core promise:

> Know what is packed, where it is, and how to restore the new home.

Example jobs:

- "Which box has my charger, passport, and medicine?"
- "What is still unpacked?"
- "Which fragile or high-value items need special attention?"
- "Where did this drawer's contents go?"
- "What should I unpack first tonight?"

### 2. Kits and Equipment

The second strongest wedge.

Useful for fitness, travel, camping, photography, cycling, tools, instruments, and collections. The user does not only want to find an item; they want to be ready for a task.

Core promise:

> Be ready for an activity without forgetting gear.

Example jobs:

- "Prepare my gym kit."
- "Pack for a two-day trip."
- "What is missing from my camera bag?"
- "Which items are shared between travel and daily carry?"
- "What should go back to its default home?"

### 3. Small-Space Storage Planning

Useful but more optional.

This turns the product from memory into spatial decision support. It matters most when the user has too many objects for a small room.

Core promise:

> Make a small space easier to live in.

Example jobs:

- "Can this shelf fit here?"
- "What layout gives me more walking space?"
- "Which container is overloaded?"
- "What should be moved out of this drawer?"

## Product Layers

### 1. Home Memory

The top-level product concept.

Home Memory is the user's structured memory of their living space. It includes spaces, containers, belongings, states, evidence, and operations.

### 2. Place Graph

The canonical model.

The Place Graph connects:

- spaces
- zones
- furniture
- containers
- belongings
- kits
- operations
- observations
- proposals
- commits
- evidence

The Place Graph is the source of truth. 2D, 3D, scan, chat, and task views are just different ways to read or update it.

### 3. Inventory

The list of belongings, containers, and groups.

Inventory answers:

- What do I own?
- What is in this box, drawer, shelf, or bag?
- Which items are important?
- Which items are missing, packed, lent out, consumed, or retired?

### 4. Operations

Operations are real-life workflows that give the user a reason to maintain the memory.

Examples:

- Move
- Unpack
- Gym
- Travel
- Camping
- Cleaning
- Repair
- Seasonal reset
- Insurance record

Operations turn passive inventory into action.

### 5. Capture and Review

Capture creates observations from photo, scan, voice, text, import, or drag.

Review turns uncertain observations into proposals.

Commit turns accepted proposals into trusted Place Graph records.

The durable rule:

```text
Input -> Observation -> Proposal or Draft -> User Review -> Commit -> Place Graph
```

### 6. Spatial View

The 2D/3D layer helps the user trust and edit the memory.

2D is for precision:

- containers
- routes
- layout
- collision
- packing zones
- box locations

3D is for intuition:

- room understanding
- furniture volume
- nested places
- scan proposal review
- high-level presentation

3D should be beautiful and memorable, but it is not the product's source of truth.

## Core Domain Terms

**Home Memory**:
The user's structured, searchable memory of their home and belongings.

**Belonging**:
A physical thing the user cares about enough to remember, prepare, pack, insure, or recover.

**Container**:
A place that can hold belongings: drawer, shelf, box, bag, suitcase, cabinet, basket, tray, storage bin.

**Default Home**:
Where a belonging should return when life is normal.

**Current Place**:
Where the system currently believes the belonging is.

**Operation**:
A real-life workflow that uses belongings and places: moving, packing, unpacking, travel, gym, cleaning, repair.

**Kit**:
A reusable set of required, optional, shared, or substitute belongings for an operation.

**Capture**:
A photo, scan, text, voice note, product import, or drag action that creates evidence.

**Proposal**:
A suggested change that is not yet trusted.

**Commit**:
An accepted change that mutates the Place Graph and creates history.

**Evidence**:
The proof behind a memory: photo, scan frame, user confirmation, correction, product info, timestamp, or note.

## P0 Requirements

P0 should prove the product is useful without requiring full 3D reconstruction.

### P0.1 Home Setup

The user can create a simple home memory quickly.

Acceptance:

- User can create spaces such as bedroom, closet, entryway, storage, bathroom, and desk area.
- User can create containers such as boxes, drawers, shelves, bags, and suitcases.
- User can create belongings with name, tags, optional photo, optional dimensions, default home, and current place.
- User can mark a belonging as packed, missing, with me, laundry, lent out, consumed, or retired.

### P0.2 Container Memory

The user can remember what is inside a container.

Acceptance:

- User can open a container page and see contained belongings.
- User can add a quick container snapshot by photo or text.
- User can distinguish visible, unknown, private, and empty regions.
- User can search "what is in this box?" or "which box has X?"

### P0.3 Find and Correct

The user can ask where something is and recover from wrong answers.

Acceptance:

- Search returns current place, default home, evidence, confidence, and last update.
- If the answer is stale or uncertain, the product says so.
- If the user says "not there", the product creates a correction flow.
- Corrected placement creates a new placement record instead of silently overwriting history.

### P0.4 Operations

The user can create an operation and use the home memory to complete it.

Acceptance:

- User can start an operation such as Move, Unpack, Gym, Travel, or Cleaning.
- Operation expands into required and optional belongings.
- Duplicate belongings merge across kits.
- Each row has status: to get, found, packed, skipped, substituted, missing, or uncertain.
- Operation can show "ready", "missing items", and "needs review".

### P0.5 Moving Flow

The user can pack and unpack without losing memory.

Acceptance:

- User can create boxes and assign belongings to boxes.
- Each box can have a label, room destination, photo, and contents.
- User can mark box status: empty, packing, packed, moved, opened, unpacked.
- User can search across packed boxes.
- User can generate an unpacking priority list.

### P0.6 Capture Proposal

The product can use photos or scans without pretending they are truth.

Acceptance:

- Capture creates observations.
- Observations create proposals.
- Proposals can be accepted, corrected, merged, or rejected.
- Only commits mutate the Place Graph.
- Private or unknown areas never become searchable item facts automatically.

### P0.7 Beautiful Spatial Review

The product has a spatial view, but it stays lightweight.

Acceptance:

- 2D view shows rooms, containers, boxes, and important belongings.
- 3D view shows a simple, beautiful cutaway when useful.
- Labels are density-managed and do not overwhelm the view.
- The user can inspect evidence and confidence from the spatial view.

## P1 Requirements

### P1.1 Product Intake

User can create belongings from product information, receipts, screenshots, or manual measurements.

### P1.2 Layout Planning

User can test furniture, shelf, and container arrangements before moving things.

### P1.3 Shared Home Memory

User can share selected spaces, boxes, or operations with a roommate, partner, mover, or family member.

### P1.4 Insurance and Asset Export

User can export high-value items with photos, receipts, serial numbers, and location history.

### P1.5 Smart Suggestions

The Agent can suggest missing kit items, overloaded containers, stale locations, and better packing order.

## P2 Requirements

### P2.1 Real Visual Reconstruction

Use phone video, LiDAR, or few-view reconstruction to propose room and furniture geometry.

### P2.2 AR Placement

Let the user confirm boxes, shelves, and important belongings through an AR overlay.

### P2.3 Long-Term Home Memory

Detect seasonal storage, repeated missing items, frequently moved objects, and containers that become stale.

### P2.4 Multi-Home Support

Support home, storage unit, car, office, parents' home, and moving destination.

## Interface Framework

### Home

The home screen should answer:

- What needs attention?
- What operations are active?
- Which containers are stale?
- What was recently moved, packed, or corrected?

### Spaces

Spatial browsing by room, zone, furniture, container, and box.

### Belongings

Searchable list of items, groups, high-value assets, and unknowns.

### Operations

Move, Unpack, Gym, Travel, Cleaning, Repair, Seasonal Reset.

### Review Inbox

All uncertain changes:

- scan proposals
- photo observations
- identity matches
- unknown/private regions
- stale placements
- suggested merges

### Spatial View

2D and 3D review surfaces.

## Anti-Requirements

Do not require users to:

- scan the whole room before getting value
- maintain exact coordinates for every cheap object
- trust automatic item recognition without review
- model every drawer in 3D
- use 3D when a list or container page is faster

Do not promise:

- perfect 1:1 CAD geometry from one phone video
- automatic recognition of every small object
- automatic truth for hidden, private, or occluded areas
- always-on tracking of home objects

## Success Metrics

Activation:

- User creates first space, first container, and first 10 belongings.
- User starts one operation within the first session.

Utility:

- User can find a recorded belonging in under 20 seconds.
- User can answer "what is in this box?" without opening multiple boxes.
- User completes an operation with fewer missing items.

Trust:

- User corrects wrong places without losing history.
- User accepts or rejects proposals instead of seeing silent mutations.
- Unknown/private regions remain visible as uncertainty.

Retention:

- User returns for a second operation.
- User updates a container after the first setup.
- User keeps high-value belongings current.

## V1 Product Bet

**Decided 2026-07-07.** The V1 is not "3D find my stuff".

The V1 is:

> A beautiful home memory for moving, unpacking, and preparing kits.

Start with moving and kits because they create enough urgency for the user to record belongings. Let daily finding become a natural side effect.

The decision record, tightened P0 scope, and release gates live in `docs/nestory-v1-prd.md`, which is canonical for V1 scope. The P0 list in this document remains the strategic superset it was distilled from.

## Relationship to the Prototypes

The V40 RoomRecall prototype (`prototype/`, frozen proof archive) remains useful as proof that:

- Place Graph readback can drive 2D, 3D, scan, and search surfaces.
- Proposal-first scanning is the right trust boundary.
- Commit ledger history matters.
- Layout planning should stay gated until blockers clear.
- 3D is strongest as a review layer, not the source of truth.

The V2 prototype (`prototype-v2/`, strict TypeScript) implements the decided V1 shape: a Home Memory Operations Console with Home / Spaces / Belongings / Operations / Review / Plan / Ledger surfaces, an event-sourced Place Graph store typed by `src/types.ts`, and its own verification harness (`node prototype-v2/src/verify.ts`).
