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

## Current Status (2026-08-11)

- **V1 scope is decided**: moving/unpacking + kits, delivered as a Home Memory Operations Console. See `docs/nestory-v1-prd.md` (canonical V1 PRD).
- **`prototype-v2/` implements that shape**: a strict-TypeScript Home Memory console (Home / Ask / Capture / Setup / Spaces / Belongings / Operations / Review / Plan / Commit Ledger) over an event-sourced Place Graph. The August system pass rebuilt the visual system and responsive navigation, bounded household-scale DOM with fixed accessible pages, preserved form drafts/focus/toast feedback, and hardened the optional Three.js projection with lazy loading, reduced-motion behavior, adaptive GPU budgets, deterministic cleanup, and zero settled RAF. The Store now has transactional persist-before-publish semantics, semantic import validation, private cold-query indexes, exact cache expiry, compact export, and bounded same-process HTTP idempotency. Durability is deliberately a single-Store / single-writer prototype guarantee; independent browser tabs are not coordinated by an atomic cross-tab CAS. Run `cd prototype-v2 && npm install && npm run verify`; use `npm run benchmark` and `npm run browser-benchmark` for explicitly separated runtime and browser distributions. Current generated reports live in `prototype-v2/renders/`.
- **`prototype/` (V40) is a frozen proof archive** for the 3D/scan/layout contracts (247 assertions, 47/47 self-loop probes). Do not extend it; import its patterns.
- **The repository follows the `mattpocock/skills` v1.2 decision-to-build flow**: the multi-session V1.x effort starts at `.scratch/room-recall-v1x/map.md`; resolved decisions flow through `to-spec -> to-tickets -> implement(TDD) -> code-review -> commit`. On July 21 the map was corrected so real scanning and 2D/3D are conditional on a durable user job, a five-minute activation prototype, and target-user evidence. The repo-local protocol remains executable even when orchestration skills are not exposed by the current client. No V1.x `spec.md` is published until the map is clear.
- **Docs were consolidated on July 25** so only one process is visible: six live documents in `docs/`, everything retired in `docs/archive/` (including the pre-Matt "self-loop" iteration OS), and `.scratch/` holding only live tracker state. Workflow vocabulary is aligned to v1.2 — notably the wayfinder map's **Fog** section. See `AGENTS.md` and `docs/agents/`.

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

## Live Documents

Everything current, in reading order. Anything not listed here is either code or archived.

- `.scratch/room-recall-v1x/map.md`: active `wayfinder` map for durable product value, five-minute activation, target-user evidence, and only then the smallest justified capture route.
- `AGENTS.md` + `docs/agents/`: the workflow contract — local tracker, triage labels, domain-doc rules.
- `docs/nestory-v1-prd.md`: **canonical V1 PRD** — decision record, tightened P0 scope, acceptance criteria, release gates.
- `docs/adr/`: durable decisions about data model, product scope, AR/3D strategy, and privacy.
- `CONTEXT.md`: glossary and product rules; the domain-language source of truth.
- `docs/nestory-product-framework.md`: strategic framing around "A memory system for your home", moving, kits, containers, and home operations.
- `docs/nestory-product-vision.zh-CN.md`: detailed Chinese product vision covering Home Memory, Ownership Recall, Home Capability, pre-purchase recall, and Declutter Review.
- `docs/nestory-roomrecall-handoff.md`: 10-minute handoff for a new product/design/engineering agent to understand the current state, run the prototypes, and continue the work.
- `docs/vision-scan-and-layout-layer.md`: visual scan proposal, 3D review, product intake, and layout planning details.
- `docs/scan-algorithm-options.md`: marker-assisted, SLAM, feed-forward 3D, and scene-parser options for the scan pipeline.

Retired material lives in `docs/archive/` — superseded requirement contracts plus the pre-Matt "self-loop" iteration process. **Nothing there is current**; see `docs/archive/README.md`.
