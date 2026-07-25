# Nestory V1 PRD

Status: **canonical for V1 scope** (decided 2026-07-07 · revised through v1.4 on 2026-07-13)

v1.1 changes: added P0.9 (first-session onboarding / own home mode), upgraded P0.2 container snapshots from text stand-in to optional photo evidence, added the pickup-location retrieval plan to P0.4, and noted the deterministic agent toolkit under §6.

v1.2 changes: shipped the agent contract as product surface — an **Ask** view answering only through toolkit calls, a provider-agnostic **tool-calling runtime** (injected LLM, decision tools guarded), and a **CLI binding to a real Claude model** that degrades to the deterministic router without a key. See §6.

v1.3 changes: added P0.10 (**local sync service** — file-backed HTTP API over the same Store contract, restart-durable, decision tools confirm-gated over HTTP) and the **agent evaluation harness** (`src/agent-eval.ts`, §6: PRD-job scoring against the answer contract; runs a real Claude when a key is present, self-tests offline with an ideal scripted model). All criteria are asserted by `prototype-v2/src/verify.ts`.

v1.4 prototype note: added a unified **Capture** surface, normalized product dimensions, and a shared-coordinate Three.js 3D review view alongside the 2D Plan. These are acquisition, capture, and trust-layer experiments; they do not change the V1 wedge or make automatic reconstruction a release requirement. The scan demo is explicitly deterministic and proposal-first.

Supersedes for V1 scope: `docs/archive/product-requirements.md` (retained as the detailed contract archive) and the P0 list in `docs/nestory-product-framework.md` (kept as the strategic frame).

One-liner:

> Nestory is a memory system for your home: it remembers what you own, where it lives, what state it is in, and what you need for real-life operations like moving, unpacking, and preparing kits.

## 1. V1 Decision Record

Decision:

> **V1 = moving/unpacking + kits, delivered as a Home Memory Operations Console. Daily finding is the trust core and a side effect, not the pitch. 3D is a review layer, not the source of truth or the V1 value proposition.**

Why this wedge:

- Moving gives the user a temporary but intense reason to record belongings; data entry has an immediate payoff (box labels, unpack priority, "which box has X?").
- Kits reuse the same memory weekly (gym, travel), so the memory does not rot after the move ends.
- Find-and-correct stays in scope because it is the trust loop that makes every other answer believable.
- Small-space layout optimization and real automatic reconstruction remain out of V1. V2 may expose lightweight 2D/3D review and capture prototypes as long as they project the same Place Graph and never bypass Review.

Inputs behind the decision:

- `docs/nestory-roomrecall-handoff.md` §19 recommended this wedge.
- `prototype/renders/self-loop-report.md` (iteration `rr-47241ff3013b`) queued "promote the strongest prototype paths into a product PRD and decide which V1 surface should become real" as the top item.
- `docs/nestory-product-framework.md` ranked moving/unpacking as the strongest wedge and kits second.

## 2. Target User and Jobs

Primary user: someone living in (or moving between) rented rooms/apartments who keeps belongings in drawers, boxes, shelves, and bags, and repeatedly loses track of them.

Jobs V1 must do:

1. "I am moving. Track what went into which box, and help me restore the new home."
2. "What is in this box/drawer/bag without opening it?"
3. "Where is my X?" — answered with evidence and confidence, recoverable when wrong.
4. "Prepare my gym/travel kit and tell me what is missing."
5. "What needs my attention?" — stale containers, uncertain placements, pending reviews.

Explicit non-jobs for V1: interior design, insurance appraisal, whole-home 3D reconstruction, multi-user sharing, always-on tracking.

## 3. Product Shape

V1 is a **Home Memory Operations Console**, not a room editor.

Information architecture:

- **Home** — what needs attention: active operations, review inbox count, stale containers, quick "Where is…?" search, recent commits, activation banner until the first session completes.
- **Setup** (own home mode) — guided first session: rooms → containers → first belongings → first operation (P0.9).
- **Ask** — conversational surface over the agent toolkit: every reply is a visible tool call plus the standard evidence/confidence answer views (§6).
- **Capture** — one entry for room visual drafts, focused container snapshots, and exact product/manual dimensions. Visual drafts remain proposals; container observations can enter Review; product dimensions normalize to meters.
- **Spaces** — rooms → containers (drawers, shelves, boxes, bags) → contents. Container pages are the fastest truth surface.
- **Belongings** — searchable inventory with state chips (packed, with me, laundry, lent out, missing…), item detail with current place vs default home, evidence, confidence, history.
- **Operations** — Move (boxes, statuses, destinations, unpack priority) and Kits (expand → merge → checklist → retrieval plan).
- **Review** — the inbox of proposals; nothing uncertain mutates memory without passing through here.
- **Plan** — lightweight 2D floor plan plus an orbitable Three.js review projection for spatial recall. Both read the same room/furniture coordinates and remain read-only in V1.
- **Ledger** — append-only commit history, export/import, reset, home-mode switching.

The durable update rule is unchanged and non-negotiable:

```text
Input -> Observation -> Proposal or Draft -> User Review -> Commit -> Place Graph
```

## 4. Data Contract

Source of truth: the **Place Graph**, derived by folding an append-only ledger over a catalog.

Catalog entities (mutable only through commits):

- `Space` (room / zone), `Furniture`, `Container` (drawer, shelf, box, bag, suitcase; boxes are containers with `kind: "box"`, label, destination, box status)
- `Belonging` (name, kinds/tags, importance, optional dimensions, default home)
- `Kit` (requirements: required / optional / substitute-group / shared / consumable)
- `Operation` (move, unpack, gym, travel, cleaning; holds checklist rows and status)

Append-only records (never edited in place):

- `Observation` — raw signal: photo note, container snapshot, "not there" report, manual edit intent.
- `Proposal` — a reviewable suggested change produced from observations (placement change, contents diff, duplicate merge, stale-container refresh).
- `CommitLedgerEntry` — the only mutation path; carries typed ops (`create_placement`, `contradict_placement`, `set_state`, `set_box_status`, `assign_to_box`, `accept_proposal`, `reject_proposal`, …), source observation/proposal ids, and a human-readable summary.
- `PlacementRecord` — item → place reference (typed: container / furniture / zone / non-room state), relation, timestamp, evidence refs, confidence.
- `EvidenceRecord` — provenance: photo, snapshot, user confirmation, negative report ("not there"), correction.

Derived (never stored as a bare mutable field):

- `Current Place` — latest trusted placement projection, with freshness.
- `Default Home` — where the item should return; moving an item never destroys it.
- Container contents, box contents, operation readiness, stale-container list.

Rules carried over from V40 (regression guards):

1. `location` display text is derived, never canonical.
2. Lifecycle states (`with me`, `packed`, `laundry`, `lent out`, `missing`, `consumed`, `retired`) are not spatial relations.
3. Unknown / private / unchecked container regions are not empty; answers must say so.
4. A wrong answer creates negative evidence and a correction flow, never a silent overwrite.
5. Evidence (material) and confidence (interpretation) stay separate.

## 5. P0 Features and Acceptance Criteria

Each criterion below must be asserted by `prototype-v2/src/verify.ts`.

### P0.1 Home setup

- Seeded home contains ≥ 2 rooms, ≥ 5 containers (including at least one drawer, one shelf, one bag), ≥ 15 belongings with default homes.
- User can create a belonging with name, tags, default home, and current place in one action.
- User can set a lifecycle state on any belonging; state changes append to the ledger.

### P0.2 Container memory

- Opening a container answers "what is in here?" from placements, not a hand-written list.
- Each container exposes freshness (last confirmed) and an unchecked/unknown flag when stale.
- "Which box/container has X?" returns the container chain for any recorded belonging.
- A container snapshot (typed contents note, with an optional photo) creates an observation + contents proposal, never a direct write.
- A snapshot photo is stored as evidence; placements accepted from that snapshot cite it. The photo alone never auto-writes anything — there is no recognition in V1.

### P0.3 Find and correct (trust core)

- `locate(query)` returns: place chain (item → container → furniture → room), default home, evidence list, confidence, freshness, and an uncertainty sentence when confidence is low or the placement is stale.
- "Not there" appends a negative-evidence observation, drops confidence, and opens a correction proposal.
- Confirming a correction appends `contradict_placement` + `create_placement` ops in one commit; the old record remains in history.
- After correction, `locate` returns the corrected place and cites the correction as evidence.

### P0.4 Operations and kits

- User can start Move, Unpack, Gym, or Travel from templates.
- A kit expands into checklist rows resolved against real belongings; substitute groups resolve to any available member; shared items are flagged when two active kits need the same belonging.
- Duplicate requirements merge into one row.
- Row statuses: `to_get`, `found`, `packed`, `skipped`, `substituted`, `missing`, `uncertain`.
- Operation readiness summary: ready / missing N / needs review.
- Kit rows compile into a **retrieval plan grouped by pickup location** (furniture, or room when no furniture): "From the Wardrobe: shirt, shorts, socks…". Unresolved rows group under "needs review" instead of disappearing.

### P0.5 Moving flow

- User can create boxes with label + destination room, assign belongings to boxes; assignment sets item state to `packed` and appends placement into the box.
- Box statuses: `empty`, `packing`, `packed`, `moved`, `opened`, `unpacked`; status changes are ledger commits.
- Search works across packed boxes ("which box has the charger?").
- Unpack priority list orders boxes by contained-item priority (essentials first) and destination.
- Unpacking a box prompts per-item placement back to default home (or a new place), each as a commit.

### P0.6 Capture proposal and review inbox

- Every capture path (snapshot, "not there", duplicate suggestion, stale-container refresh) lands in the Review inbox as a proposal.
- Proposals can be accepted, corrected (edited then accepted), or rejected; only acceptance mutates the graph, via a commit that references the proposal.
- The inbox is never silently emptied; rejections are ledgered too.

### P0.7 Spatial recall (lightweight)

- 2D plan renders rooms, key furniture, and containers; a located item shows a pin on the plan with its confidence.
- No 3D requirement in V1. The V40 prototype remains the 3D reference implementation.

### P0.8 Persistence and history

- State survives reload (localStorage) and supports export/import as JSON.
- Ledger view lists commits newest-first with op summaries and source lineage.
- Reset-to-seed is available and itself ledgered.

### P0.9 First-session onboarding (own home mode)

The seeded demo proves the product; a real first session starts from nothing.

- First run offers two entries: **explore the demo home** or **start with my own home** (empty). The choice persists per mode; switching modes never mixes records.
- Own home mode opens a guided Setup flow: add rooms (templates + custom), add containers per room, rapid-add belongings, then start a first operation — without leaving the flow.
- An activation checklist (≥1 room, ≥1 container, ≥10 belongings, ≥1 operation started) is derived from the Place Graph and stays visible until complete.
- Every setup action is an ordinary ledger commit (`create_room`, `create_container`, `create_belonging`, `create_operation`) — onboarding has no special-case write path.
- A Move can start before the home is fully described: boxes work with only a room recorded.
- Rooms created at runtime receive auto-assigned floor-plan slots so the Plan view works without any drawing step.

### P0.10 Local sync service (v1.3)

localStorage is the browser default; the sync service is the first persistence layer beyond it.

- `node src/server.ts [data.json]` starts a zero-dependency HTTP service over the same `Store` contract: read views (`/locate`, `/search`, `/containers/:id/contents`, `/operations`, `/proposals`, `/attention`, `/activation`), `POST /ask` (deterministic router), and `POST /tools/:name` — **the agent toolkit is the write API**; there is no second write path to keep consistent.
- Records persist to a JSON file through the same `StorageLike` seam the browser uses; a service restart reloads them (durability asserted by verification).
- Decision tools over HTTP require `{ "confirmed": true }` in the body and return 403 otherwise — the same consent guard as the agent runtime.
- `GET /export` / `POST /import` stay schema-compatible with the app's Ledger export (record schema version 2), so browser ↔ service moves are lossless.
- The browser app keeps localStorage in V1; export/import bridges the two until a remote-storage adapter is deliberately scoped.

## 6. Agent Answer Contract

V1 ships deterministic retrieval (no LLM runtime), but every answer already follows the agent contract so an LLM can be attached later without changing the product shape:

```text
Your water bottle is probably on the desk, right side.
Evidence: placement commit (yesterday) + your confirmation (3 days ago).
Confidence: 0.74. Last confirmed: yesterday.
If it is not there, mark "not there" and I will open a correction.
```

Required properties: place + default home distinction, evidence citations, confidence, freshness, uncertainty admission, next action when blocked. Broad intents ("fitness") expand through kit requirements, merge duplicates, and return a retrieval plan grouped by pickup location.

The deterministic behaviors behind this contract are additionally exposed as a **typed agent toolkit** (`prototype-v2/src/agent.ts`): tool descriptors with JSON-schema parameters plus a dispatcher over the store. The toolkit enforces the same proposal-first rules (capture tools return proposals, never direct writes).

v1.2 ships the contract as three concrete layers, each asserted by verification:

1. **Ask surface** (`src/ask.ts` + Ask view): a deterministic intent router that answers only through toolkit calls. Tool calls are rendered visibly in the conversation; locate replies reuse the standard answer card (evidence, confidence, freshness, "not there" action). No hidden reasoning, no writes outside the toolkit.
2. **Agent runtime** (`src/agent-runtime.ts`): a provider-agnostic tool-calling loop with an injected LLM function. Decision tools (`accept_proposal`, `reject_proposal`) are **blocked by default** and return an instructive error steering the model to ask for explicit user confirmation; a bounded tool-round budget prevents runaways. Tested with scripted mock LLMs.
3. **Claude CLI binding** (`src/agent-cli.ts`): `node src/agent-cli.ts [export.json]` binds the toolkit to a real Claude model via the Messages API when `ANTHROPIC_API_KEY` is set, and degrades to the same deterministic router when it is not. No SDK dependency.
4. **Evaluation harness** (`src/agent-eval.ts`, v1.3): seven PRD-example jobs (locate, stale admission, which-box, kit prep, unpack order, honest unknown, decision guard) each scored by deterministic checks against the demo home's ground truth: correct place named, staleness admitted, no invented placements, decisions deferred to Review. `node src/agent-eval.ts` runs a real Claude when a key is present and writes `renders/agent-eval-report.md`; verification proves the harness itself with an ideal scripted model, offline.

## 7. Non-Goals and Anti-Requirements

V1 will not:

- require any scan before value;
- track exact coordinates for cheap objects;
- trust recognition (or any capture) without review;
- render 3D or model drawers in 3D;
- support multi-user sharing, multi-home, insurance export, AR, or real CV;
- promise geometry from phone video.

## 8. Success Metrics

- Activation: first container + first 10 belongings + one started operation within the first session (< 10 minutes of effort).
- Utility: a recorded belonging is findable in < 20 seconds; "what is in this box?" answered without opening boxes; an operation completes with fewer missing items.
- Trust: corrections preserve history; proposals are reviewed, not auto-applied; unknown stays visibly unknown.
- Retention: a second operation is started; a container is re-confirmed after setup.

## 9. Release Gates for the V2 Console

1. `node prototype-v2/src/verify.ts` passes all acceptance assertions (including the strict `tsc` typecheck-and-build gate) and writes a fresh report.
2. Browser smoke: console loads, all surfaces render, no horizontal overflow at 390 px width.
3. The killer trust loop (locate → not there → correct → commit → improved answer) is demonstrable end to end in the UI.
4. The moving loop (box → pack → move → unpack priority → unpack commits) is demonstrable end to end in the UI.
5. The first-session loop (welcome → own home → rooms → containers → 10 belongings → first operation) is demonstrable end to end in the UI, entirely through ledger commits.
6. The Ask loop (question → visible tool call → evidence-carrying answer) is demonstrable in the UI, and the agent runtime passes its mock-LLM assertions (tool execution, decision-tool guard, round budget).
7. The sync service passes its assertions: read views match the store, tool dispatch is the only write path, decision tools 403 without confirmation, records survive a service restart, export/import round-trips.
8. The eval harness passes offline with the ideal model (7/7 jobs); real-model runs are reported, not gated (model behavior is observed, not asserted).
9. Docs updated: handoff reflects the new state; framework marks the V1 bet as decided.

## 10. Relationship to V40

The V40 prototype (`prototype/`) is a **frozen proof archive**: it proved Place Graph readback, proposal-first scanning, commit-ledger corrections, layout gating, and 2D/3D parity (247 assertions, 47/47 probes at `rr-47241ff3013b`). Do not extend it. New product work happens in `prototype-v2/` against this PRD; scan/layout/3D contracts return in later versions by importing V40's patterns, not its code.
