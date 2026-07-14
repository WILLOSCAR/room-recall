# RoomRecall / Nestory

Current strategic thesis:

> A memory system for your home.

`RoomRecall` is the prototype name for the original spatial-memory idea. `Nestory` is the current working product direction: a warmer, broader home memory system for belongings, containers, packing, moving, kits, and spatial review.

## Strategic Reset

The original idea started as a way to remember where objects are inside a rented home. The V40 prototype proved that 3D, 2D, scanning, layout planning, intent kits, and locate readback can work together.

The stronger product is not a perfect 3D room model and not just "find my water bottle". The stronger product is a home memory system:

- what the user owns
- where belongings live
- what is inside boxes, drawers, shelves, bags, and suitcases
- what is packed, missing, with the user, lent out, or stale
- what is needed for moving, unpacking, travel, fitness, cleaning, repair, or seasonal reset
- which visual or manual evidence supports each answer

The current V2 product framework lives in `docs/nestory-product-framework.md`.

## Current Status (2026-07-14)

- **V1 scope is decided**: moving/unpacking + kits, delivered as a Home Memory Operations Console. See `docs/nestory-v1-prd.md` (canonical V1 PRD).
- **`prototype-v2/` implements that shape**: strict-TypeScript console (Home / Ask / Capture / Setup / Spaces / Belongings / Operations / Review / Plan / Ledger) over an event-sourced Place Graph store. `src/types.ts` is the typed domain contract. First-run welcome offers a seeded **demo home** or an empty **own home** with guided setup; container snapshots take photo evidence; kits compile into pickup-stop retrieval plans; the agent contract ships as an Ask surface + tool-calling runtime + Claude CLI (`npm run cli`) + eval harness (`npm run eval`); persistence goes beyond localStorage via the file-backed sync service (`npm run serve-api`). The July 13 spatial pass adds a redesigned consumer-facing Home, a unified Capture surface (room draft / container snapshot / product intake), normalized product dimensions, and a Three.js 2D/3D Plan driven by the same room coordinates. Verify with `cd prototype-v2 && npm install && npm run verify` (**191 assertions**, including strict TypeScript, mock-LLM runtime, live HTTP service, product dimensions, 3D canvas pixel checks, scan proposals, and desktop/mobile browser smoke).
- **`prototype/` (V40) is a frozen proof archive** for the 3D/scan/layout contracts (247 assertions, 47/47 self-loop probes). Do not extend it; import its patterns.
- **The repository now follows the current Matt Pocock engineering flow**: `ask-matt` routes the work; the multi-session V1.x effort starts at `.scratch/room-recall-v1x/map.md`; resolved decisions flow through `to-spec -> to-tickets -> implement(TDD) -> code-review -> commit`. `docs/agents/` is the tracker and domain configuration source of truth. No V1.x `spec.md` is published until the map is clear.

## Why This Name

`RoomRecall` is the chosen English name for this idea.

It is short, easy to say, and captures the two jobs of the product:

1. Recall where a specific object is.
2. Recall the set of objects needed for a broader intent, such as fitness, travel, cooking, or repair.

The more technical layer underneath can be called a `Place Graph`: a graph that connects rooms, zones, containers, objects, and user intents.

## Original Idea

After living in a rented room or apartment for a long time, it becomes easy to forget where things were placed.

The ideal product would let the user recreate the home at roughly 1:1 scale when items are placed, almost like a lightweight 3D model that can be seen through. Later, a Large Language Model or Agent can help locate objects.

The Agent should also support intent-based search. For example, if the user says `fitness`, the system should expand that broad intent into child items such as clothes, shoes, towels, gym accessories, and other related things. The system can then merge those child items into a single checklist or retrieval plan.

## Core Product Shape

`RoomRecall` is a personal spatial inventory system:

- It remembers where things are.
- It understands containment, such as `inside drawer`, `on shelf`, `under bed`, or `in suitcase`.
- It supports a transparent home model, so hidden or nested objects can still be located.
- It lets an Agent answer questions like `Where is my black gym shirt?`
- It lets an Agent assemble kits like `fitness`, `business trip`, `winter clothes`, or `cleaning`.

## Main Objects

- `Room`: bedroom, bathroom, kitchen, entryway, balcony.
- `Zone`: desk area, wardrobe area, bed area, shoe area.
- `Container`: drawer, box, cabinet, shelf, suitcase, storage bag.
- `Item`: shirt, charger, towel, dumbbell, document, medicine.
- `Placement`: the relationship between an item and a place.
- `Intent Kit`: a broad goal that expands into many child items.
- `Evidence`: photo, scan, manual note, timestamp, confidence level.

## Example Flow

User asks:

```text
I want to go to the gym. What do I need, and where is everything?
```

Agent expands `fitness` into child items:

- Training clothes
- Socks
- Gym shoes
- Towel
- Water bottle
- Earphones
- Resistance band
- Gym card
- Laundry bag

Agent merges duplicate or related items:

- `sports shirt` and `training shirt` become one clothing requirement.
- `water bottle` is reused if it already belongs to `daily carry`.
- `earphones` are shared between `fitness` and `commute`.

Agent returns a retrieval plan:

```text
Fitness kit:

- Black training shirt: wardrobe, second drawer, left side.
- Shorts: wardrobe, second drawer, right side.
- Socks: wardrobe, top drawer.
- Gym shoes: entryway shoe rack, bottom level.
- Towel: bathroom shelf, middle basket.
- Water bottle: desk, right side.
- Earphones: backpack front pocket.
```

## MVP Boundary

The first version does not need perfect 3D reconstruction.

Start with a thin but useful version:

- Create rooms and zones.
- Create containers inside zones.
- Add items manually with photos or quick text.
- Search for items by natural language.
- Define intent kits like `fitness`.
- Let the Agent expand an intent into child items.
- Merge repeated child items into one checklist.

The 1:1 transparent 3D model can become the second stage once the item graph and retrieval behavior are already useful.

## Later Version

Possible upgrades:

- iPhone LiDAR or AR scan for room geometry.
- 3D overlay for shelves, drawers, boxes, and hidden objects.
- Computer vision to recognize items from photos.
- Confidence scoring when the system is unsure.
- Reminder after moving an object: `Did you put this back in the same place?`
- Seasonal storage mode for rarely used things.
- Moving-home mode for packing and unpacking.

## Product Question To Keep

The real product is not only a 3D home model.

The deeper product is a memory system for everyday life: a way to connect physical objects, places, and intentions so the home becomes searchable.

## Current Requirement Docs

- `.scratch/room-recall-v1x/map.md`: active `wayfinder` map for durable product value, five-minute activation, and the first honest real-capture loop.
- `docs/agents/`: current local tracker, triage, domain-doc, and agent workflow configuration.
- `docs/nestory-roomrecall-handoff.md`: 10-minute handoff for a new product/design/engineering agent to understand the current state, run the prototypes, and continue the work.
- `docs/nestory-v1-prd.md`: **canonical V1 PRD** — decision record, tightened P0 scope, acceptance criteria, release gates.
- `docs/nestory-product-framework.md`: strategic framing around "A memory system for your home", moving, kits, containers, and home operations.
- `docs/product-requirements.md`: detailed contract archive (superseded for V1 scope by `nestory-v1-prd.md`).
- `docs/requirements-discovery.md`: broader discovery pool and open questions from prototype exploration.
- `docs/vision-scan-and-layout-layer.md`: visual scan proposal, 3D review, product intake, and layout planning details.
- `docs/scan-algorithm-options.md`: marker-assisted, SLAM, feed-forward 3D, and scene-parser options for the scan pipeline.
- `docs/requirements-agent-synthesis.md`: multi-agent requirement review summary and integration rationale.
- `docs/coordinate-prototype-synthesis.md`: coordinate-frame, scan-calibration, layout-constraint, and prototype verification synthesis.
- `.scratch/room-recall/PRD.md`: superseded seed retained only for provenance; it is not a current build contract.
