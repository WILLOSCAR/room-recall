# Nestory / RoomRecall Handoff

Created: 2026-07-06 · Updated: 2026-07-25 (docs consolidated to one process)

Audience: a new product / design / engineering agent or human who needs to understand the current work in about 10 minutes and continue it without re-discovering the whole thread.

Product vision draft: `docs/nestory-product-vision.zh-CN.md` now unifies moving as the acquisition event, long-term Ownership Recall and pre-purchase recall, Home Capability, and Declutter Review. It is directional context, not a replacement for the canonical V1 PRD or a future V1.x build spec.

> **2026-07-13 update — read this box first.**
> The three top recommendations of this handoff have been executed:
> 1. **V1 surface decided**: moving/unpacking + kits. Decision record in `docs/nestory-v1-prd.md` (canonical V1 PRD).
> 2. **PRD tightened**: `docs/nestory-v1-prd.md` supersedes the long-form requirements contract (now `docs/archive/product-requirements.md`) for V1 scope.
> 3. **V2 prototype built (strict TypeScript, now v2.5)**: `prototype-v2/` is the Home Memory Operations Console (Home / Ask / Capture / Setup / Spaces / Belongings / Operations / Review / Plan / Ledger) over an event-sourced Place Graph store. The July 13 pass redesigns Home, adds one Capture entry for room proposals / container snapshots / product dimensions, and restores 3D as an orbitable Three.js review projection over the same coordinates as 2D. The room scan is an explicitly labeled deterministic interaction prototype; only accepted item observations can enter the existing Review pipeline. Verified by `npm run verify` — **191/191 assertions**, including product-dimension normalization, 3D canvas pixel checks, scan-proposal rendering, live HTTP service checks, and desktop/mobile browser smoke.
> `prototype/` (V40) is now a **frozen proof archive**. New product work continues in `prototype-v2/` against the V1 PRD. Section 19 lists the new next steps.
>
> **2026-07-14 workflow update:** repo-level agent configuration now follows the current Matt Pocock flow. The active V1.x planning artifact is `.scratch/room-recall-v1x/map.md`; the first frontier decision is the durable product promise. Do not publish a new `spec.md` or implementation tickets until that decision map is clear.
>
> **2026-07-21 correction:** real scanning and 2D/3D are no longer precommitted by the map destination. The route is now durable job -> five-minute activation prototype -> evidence from at least five representative users -> smallest justified capture mode. If the evidence favors Container Snapshot or operation-first entry, close the room-reconstruction branch instead of forcing it into V1.x.
>
> **2026-07-25 docs consolidation:** the repo carried two eras of process. The pre-Matt "self-loop" iteration OS and five superseded requirement documents moved to `docs/archive/` — **nothing there is current, and its instructions must not be followed**. `docs/` now holds six live documents; `.scratch/` holds only live tracker state. Workflow vocabulary is aligned to `mattpocock/skills` v1.2, most visibly the wayfinder map's **Fog** section (previously "Not yet specified"). `prototype/self-loop.mjs` still runs so the V40 archive stays intact, but carries a retirement banner. Current workflow: `AGENTS.md` + `docs/agents/`.

Primary workspace (as of 2026-07-25 — this directory has been renamed before, so treat it as a hint, not a constant):

```text
/Users/renjunbin/Documents/codebase/try/products/room-recall
```

**Every other path in this document is relative to the repo root**, including the `cd` commands. That keeps the handoff correct if the repo is moved or cloned elsewhere.

## 0. Read This First

The current idea is no longer just "make a 3D room so I can find things".

The current product thesis is:

> A memory system for your home.

Working name:

- `RoomRecall`: original prototype name and still the name of the local demo.
- `Nestory`: current higher-level product direction.

What changed strategically:

- The original pain was forgetting where objects are in a rented room.
- The prototype proved that 3D, 2D, scan proposals, layout planning, object placement, kit retrieval, and Agent readback can be connected.
- The stronger product is not a perfect 3D model or a single-item finder.
- The stronger product is a searchable home memory: belongings, containers, boxes, shelves, drawers, states, evidence, operations, and reviewable scan proposals.

The recommended V1 bet is:

> A beautiful home memory for moving, unpacking, and preparing kits.

Do not restart from "photorealistic digital twin". Start from `Home Memory -> Place Graph -> Operations -> Reviewable Capture -> Spatial View`.

## 1. Current Status

There are now two prototypes:

- `prototype-v2/`: the **current** V1 console, in strict TypeScript. Event-sourced Place Graph, moving + kits + Review + ledger + agent/sync/eval surfaces, now with redesigned Home, unified Capture, product dimensions, and shared-coordinate 2D/3D Plan (`src/spatial.ts`). Latest verification (2026-07-13): `npm run verify` — **191/191 assertions**; screenshots under `prototype-v2/renders/` include `nestory-home.png`, `nestory-plan-3d.png`, `nestory-capture-scan.png`, and mobile coverage.
- `prototype/`: the **frozen** V40 single-file Three.js demo with its own verification harness and self-loop report. Keep as proof archive for 3D/scan/layout contracts.

V40 verification, rerun on 2026-07-06:

- `node verify.mjs`: 247 assertions, 0 failures.
- `node self-loop.mjs`: 47/47 probes passing.
- Latest self-loop iteration id: `rr-47241ff3013b`.
- Latest verification report generated: `2026-07-06T15:53:51.236Z`.
- Latest self-loop report generated: `2026-07-06T15:54:08.686Z`.
- Recommended next patch from the self-loop: "Promote the strongest prototype paths into a product PRD and decide which V1 surface should become real."

Important nuance:

- `docs/archive/iteration-40-ledger.md` records V40 as `rr-8d44dc547269` from the earlier 40-iteration push.
- The latest rerun of the same prototype/report chain is now `rr-47241ff3013b`.
- Treat V40 as the completed milestone; treat `rr-47241ff3013b` as the latest local verification state.

## 2. Ten-Minute Reading Order

Read these in order:

1. `README.md`
   - Fast context: original idea, product naming, current thesis, current status.

2. `docs/nestory-v1-prd.md`
   - **Canonical V1 PRD**: the decided wedge, P0 acceptance criteria, agent answer contract, release gates.

3. `docs/nestory-product-framework.md`
   - Strategic frame behind the PRD: Nestory, Home Memory, wedges, P0/P1/P2 superset, anti-requirements.

4. `CONTEXT.md`
   - Glossary and domain language.
   - Use it to avoid inconsistent names.

5. `prototype-v2/renders/verification-report.md`
   - Latest V2 verification state, mapped to the PRD.

6. `AGENTS.md`
   - The workflow contract: which skill to run, in what order, and how tickets are tracked.

7. `.scratch/room-recall-v1x/map.md`
   - The live planning frontier: what is decided, what is still fog, and what is out of scope.

Only after that, open the prototype code (`prototype-v2/` first).

Optional background, only if you need scan/3D/privacy depth or project history: `docs/archive/product-requirements.md` and `docs/archive/iteration-40-ledger.md`. Both are retired — read them for detail, never for current scope.

## 3. Product Narrative

Original user story:

- The user lives in a rented room / apartment for a long time.
- Things get put into drawers, shelves, bags, boxes, corners, and containers.
- Later the user forgets where things are.
- The initial dream was a roughly 1:1 transparent 3D room model where objects could be placed, moved, viewed, and found by an LLM/Agent.
- The Agent should also handle broad intents. Example: "fitness" expands into clothes, shoes, towel, water bottle, earphones, gym card, and related items, then merges duplicates into one retrieval plan.

Product realization:

- A pure "find my object" product may be too expensive for daily maintenance.
- The product becomes valuable when memory creation is tied to high-pain operations:
  - moving
  - unpacking
  - packing boxes
  - preparing fitness/travel/camping/repair kits
  - planning small-space storage
  - recovering high-value or important belongings
- Therefore, 3D is not the source of truth. It is a review and trust layer over a structured home memory.

Current one-liner:

```text
Nestory is a memory system for your home: it remembers what you own, where it lives, what state it is in, and what you need for real-life operations like moving, unpacking, and preparing kits.
```

## 4. Product Architecture

Canonical model: `Place Graph`.

The Place Graph connects:

- spaces
- rooms
- zones
- furniture
- containers
- belongings
- item groups
- kits
- operations
- observations
- proposals
- commits
- evidence

Durable update rule:

```text
Input -> Observation -> Proposal or Draft -> User Review -> Commit -> Place Graph
```

This rule matters more than the UI. It means:

- A scan never silently becomes truth.
- A drag preview never silently mutates canonical placement.
- A layout scenario is read-only until commit gates are satisfied.
- A wrong answer creates negative evidence and a correction flow.
- Unknown/private/occluded regions are not treated as empty.
- The user must be able to inspect evidence and confidence.

Core product layers:

- `Home Memory`: the user's searchable structured memory of belongings, containers, spaces, states, evidence, and operations.
- `Place Graph`: the source of truth.
- `Inventory`: what exists, what is in each container, what is missing/packed/lent/consumed.
- `Operations`: move, unpack, gym, travel, camping, cleaning, repair, seasonal reset.
- `Capture and Review`: photo, scan, voice, text, product intake, drag, then proposal review.
- `Spatial View`: 2D for precision, 3D for intuition and trust.

## 5. V40 Archive Prototype

(For the current V2 console see the update box at the top, §6.0, and §12. This section documents the frozen archive.)

Prototype path:

```text
prototype
```

Main files:

- `prototype/index.html`
  - Single-file static app, about 10.7k lines.
  - Contains HTML, CSS, Three.js scene, state, prototype data, interaction logic, and `window.roomRecallDemo`.

- `prototype/verify.mjs`
  - Browser verification harness, about 4.3k lines.
  - Uses headless Chrome/CDP and calls `window.roomRecallDemo`.
  - `rootUrl` is hard-coded to `http://127.0.0.1:8789/`.

- `prototype/self-loop.mjs`
  - Product/engineering self-loop analyzer, about 1k lines.
  - Reads verification output and writes next-iteration critique.

- `prototype/renders/`
  - Screenshots and JSON/Markdown verification reports.

The prototype currently shows:

- 3D cutaway room.
- Transparent home model behavior.
- 2D plan mode.
- Scan review mode.
- Layout planner mode.
- Item search and locate readback.
- Fitness/travel kit expansion.
- Product/manual item intake with dimensions and tags.
- Support surfaces such as desk, shelf, drawer, and container bases.
- Drag previews, support-surface fit/collision checks, patch snapping, manual patch handles, and resize previews.
- Scan proposals, scan identity observations, identity proposals, review drafts, commits, rollback lineage.
- Anchor editing and reconstruction refresh proposals.
- Layout scenario compare, commit gates, apply/reject drafts, scenario focus parity, replay fixtures.
- End-to-end trace from scan capture to locate readback.

The prototype is not a production app:

- No real backend.
- No real database.
- No auth.
- No persistence beyond static in-memory state and generated reports.
- No real camera/vision integration.
- Scan and reconstruction are simulated contract records, not actual CV output.

## 6. How To Run

### 6.0 V2 console (current)

One-time setup (installs TypeScript, Three.js, Lucide, and their local type dependencies):

```bash
cd prototype-v2
npm install
```

One command — the harness runs the strict `tsc` typecheck-and-build gate, serves the files, boots headless Chrome, asserts the PRD criteria, and writes screenshots + reports (needs Node >= 23.6 for native TypeScript):

```bash
node src/verify.ts        # or: npm run verify
```

To use it interactively (the verify run keeps `dist/` fresh; `npm run build` rebuilds it manually):

```bash
python3 -m http.server 8791
# open http://127.0.0.1:8791/
```

State persists in localStorage; use Ledger -> Reset to seed to start over. `window.nestory` exposes the store and view hooks for scripting (typed as `NestoryHooks` in `src/app.ts`).

Other entry points (all zero-dependency):

```bash
npm run serve-api          # file-backed HTTP sync service (node src/server.ts [data.json] [--empty] [--port N])
npm run cli                # terminal chat; binds a real Claude when ANTHROPIC_API_KEY is set
npm run eval               # score a real model against the PRD §6 contract (needs ANTHROPIC_API_KEY)
```

### 6.1 V40 archive prototype

Use two terminals.

Terminal 1:

```bash
cd prototype
python3 -m http.server 8789
```

Then open:

```text
http://127.0.0.1:8789/
```

Terminal 2 — replay the archive's own verification:

```bash
cd prototype
node verify.mjs
```

`node self-loop.mjs` also still runs, but it drives the **retired** pre-Matt iteration process. Run it only to reproduce a historical report, never to decide what to build next — that is `AGENTS.md`'s job.

Outputs:

- `prototype/renders/verification-report.json`
- `prototype/renders/self-loop-state.json`
- `prototype/renders/self-loop-report.md`
- PNG screenshots under `prototype/renders/`

If port `8789` is occupied:

- Prefer freeing it.
- If changing the port, update `rootUrl` in `prototype/verify.mjs` first.

## 7. Screenshots To Inspect

Useful visual outputs:

- `prototype/renders/room-recall-desktop.png`
- `prototype/renders/room-recall-plan-2d.png`
- `prototype/renders/room-recall-scan-3d.png`
- `prototype/renders/room-recall-layout-planner.png`
- `prototype/renders/room-recall-fitness-kit.png`
- `prototype/renders/room-recall-search-water-bottle.png`
- `prototype/renders/room-recall-mobile.png`

These are especially useful for quickly seeing what "the prototype" looks like without running it.

## 8. Current End-To-End Flows

### 8.1 Find Object And Correct

Flow:

```text
search item -> answer with placement + evidence -> user says Not there -> negative evidence -> corrected placement -> commit -> future answer improves
```

Why it matters:

- This is the baseline trust loop.
- It proves the product can recover from being wrong.
- The correction is appended to a commit ledger instead of silently overwriting history.

Prototype hooks:

- `window.roomRecallDemo.locate("water bottle")`
- `window.roomRecallDemo.markNotThere("water-bottle")`
- `window.roomRecallDemo.moveItem("water-bottle", x, z)`
- `window.roomRecallDemo.commitPlacementCorrection("water-bottle")`

### 8.2 Fitness Kit / Intent Expansion

Flow:

```text
intent "fitness" -> required child items -> duplicate/shared merge -> retrieval plan -> locate each item
```

Example fitness children:

- black training shirt
- shorts
- socks
- gym shoes
- towel
- water bottle
- earphones
- resistance band
- gym card
- laundry bag

Why it matters:

- This is how the product becomes more than a single-object finder.
- It supports the "Kitspace" side of the idea, but inside the broader Nestory/Home Memory frame.

Prototype hook:

- `window.roomRecallDemo.activateKit("fitness")`

### 8.3 Product / Manual Item Intake

Flow:

```text
manual/product info -> dimensions + tags + default place + kit membership -> item created -> later scan/drag can ground it into the room
```

Why it matters:

- Not every useful object starts with a camera scan.
- Product dimensions, receipts, product pages, manual measurements, and screenshots are valid evidence.
- This matters for layout fit and collision.

Important product rule:

- `Default Home` and `Current Place` are different.
- Moving an item should not destroy its default home.

### 8.4 Support Surface Placement

Flow:

```text
select support surface -> preview placement -> fit/collision check -> patch snap or block -> explicit commit -> ledger/readback
```

What exists:

- Support surfaces from furniture/containers.
- Hover affordance.
- Drag preview.
- Patch snapping.
- Manual patch coordinate.
- 2D patch handle.
- Volume resize preview.
- Explicit geometry + placement commit.
- Stale prechecks when parent furniture geometry changes.

Why it matters:

- This is the practical bridge between "free drag 3D objects" and "trustworthy Place Graph writes".

### 8.5 Scan Proposal Pipeline

Flow:

```text
phone scan / frames -> keyframe coverage -> reconstruction job -> observations -> typed proposals -> review -> commit -> Place Graph
```

Current prototype policy:

- Reconstruction job output policy is `proposal_only`.
- Scan identity producer output policy is `observation_only`.
- Geometry, identity, coverage, privacy, and placement all require review/commit boundaries.
- Private or unknown regions do not become searchable object facts automatically.

Algorithm routes documented:

- `marker-assisted`: best default P0/P1 route.
- `sparse-slam`: phone sweep layout draft.
- `feed-forward-3d`: heavier geometry refinement job.
- `scene-parser`: convert point cloud output into structured Place Graph proposals.

Important file:

```text
docs/scan-algorithm-options.md
```

### 8.6 Layout Planning

Flow:

```text
current layout -> proposed scenario -> metric deltas -> predicted placement/support impacts -> commit gate -> apply/reject draft
```

What exists:

- Scenario compare records.
- Geometry diff ids.
- Predicted placement impacts.
- Support-surface impacts.
- Recommendation reason codes.
- Scan certainty and guided capture prompts.
- Unified commit gate with blockers.
- Apply/reject decision drafts.
- Focus parity between panel, 2D plan, backend, and locate context.
- Deterministic replay fixtures.

Important product boundary:

- Layout scenario compare/replay is read-only until blockers clear.
- Current prototype intentionally keeps scenario apply blocked when evidence is insufficient.

### 8.7 End-To-End Demo Trace

Current auditable trace:

```text
scan_capture
  -> reconstruction_job
  -> scenario_compare
  -> scenario_gate
  -> anchor_commit
  -> scenario_decision
  -> locate_readback
```

The self-loop probe `roomrecall-end-to-end-demo` confirms:

- all review boundaries exist;
- proposal-first policy is present;
- anchor edits can commit append-only;
- locate readback carries committed anchor and preview scenario context;
- private/unknown regions remain guarded;
- canonical write types are named and traceable.

## 9. Important Data Model Rules

Keep these rules stable unless deliberately changing the product model:

1. `Place Graph` is source of truth.
2. `location` is display text, not canonical truth.
3. Item placement should resolve through typed containment:

```text
item -> container -> parent container? -> furniture? -> zone -> room
```

4. Use append-only records:
   - `Observation`
   - `ScanProposal`
   - `PlacementRecord`
   - `GeometryRecord`
   - `CommitLedgerEntry`

5. Evidence and confidence are separate:
   - Evidence is material/provenance.
   - Confidence is interpretation.

6. Dimensions need both:
   - `DimensionSource`: manual measurement, scan estimate, product spec, derived value, user-confirmed measurement.
   - `DimensionVerificationStatus`: unverified, reviewed, confirmed, conflicted.

7. Lifecycle states are not spatial relations:
   - `with me`, `packed`, `in transit`, `laundry`, `drying`, `lent out`, `consumed`, `missing`, `retired`.

8. Unknown/private/occluded regions are not empty.

9. 2D is for precision. 3D is for trust and intuition.

10. Layout planning is not general CAD. It only exists to support home memory and operations.

## 10. Important Prototype API Hooks

`window.roomRecallDemo` is exposed from `prototype/index.html`.

Useful methods:

- `snapshot()`
- `layoutSnapshot()`
- `coordinateSnapshot()`
- `backendContractSnapshot()`
- `scanPipelineSnapshot()`
- `roomRecallEndToEndDemoRecord()`
- `layoutScenarioCompareRecords()`
- `layoutScenarioFixtureRecords()`
- `replayLayoutScenarioFixture(id)`
- `locate(query)`
- `locateAnswer(query)`
- `retrievalExplanation(query)`
- `activateKit("fitness")`
- `moveItem(id, x, z)`
- `markNotThere(id)`
- `commitPlacementCorrection(id)`
- `setProjectionMode("cutaway3d" | "plan2d" | "scan3d" | etc.)`
- `reviewVisionDraft()`
- `acceptAllProposals()`
- `rejectAllProposals()`
- `commitScanProposals()`
- `selectScanPipeline(route)`
- `selectSupportSurface(id)`
- `hoverSupportSurface(surfaceId, itemId)`
- `previewDragOnSurface(itemId, surfaceId)`
- `previewDragOnSurfaceAt(itemId, surfaceId, localX, localZ)`
- `commitDragPreview(itemId)`
- `supportPlacementPrecheck(itemId, surfaceId)`
- `confirmSupportPlacement(itemId, surfaceId, precheckId)`
- `previewAnchorEdit(...)`
- `commitAnchorEditDraft(...)`
- `rejectAnchorEditDraft(...)`
- `requestLayoutScenarioApply(...)`
- `rejectLayoutScenario(...)`
- `focusLayoutScenario(...)`

When writing tests, prefer these hooks over brittle DOM scraping.

## 11. Verification Model

Verification script:

```text
prototype/verify.mjs
```

It checks:

- browser loads the app;
- 3D scene is not blank;
- 2D mode renders;
- scan mode renders;
- mobile has no horizontal overflow;
- locate/search behavior;
- not-there correction loop;
- kit expansion;
- coordinate round-trip;
- support surface selection/precheck/commit;
- collision and fit gates;
- scan proposal review/commit;
- identity observation/proposal/commit/rollback;
- retrieval explanation;
- 2D/3D overlays;
- layout scenario compare/gate/replay;
- anchor edits;
- end-to-end trace.

Self-loop script (**retired process — historical only**):

```text
prototype/self-loop.mjs
```

It compressed detailed assertions into product/engineering probes across `semantic`, `spatial`, `interface`, and `verification` lanes. It belongs to the pre-Matt iteration OS (`docs/archive/self-loop-operating-system.md`) and is kept only so the frozen V40 archive stays runnable. **Do not use it to plan or drive new work.**

Definition of done for current work — set by `AGENTS.md`, not by the self-loop:

- the change is driven by a claimed ticket on the current frontier;
- behavior is agreed at public seams and built with `tdd`;
- `cd prototype-v2 && npm run verify` passes (strict `tsc` gate + PRD-mapped assertions + browser smoke);
- `code-review` runs against a fixed Git baseline before committing;
- docs that describe the changed behavior are updated in the same pass.

## 12. Document Map

Use these paths as the source of truth.

Core:

- `README.md`
  - Product seed, naming, current status.

- `CONTEXT.md`
  - Glossary and product rules.

- `docs/nestory-v1-prd.md`
  - **Canonical V1 PRD.** Start here for scope and acceptance.

- `docs/nestory-product-framework.md`
  - Strategic frame behind the PRD.

- `AGENTS.md` + `docs/agents/`
  - The workflow contract: canonical skill flow, local issue tracker, triage labels, domain-doc rules.

V2 console and verification (current, strict TypeScript):

- `prototype-v2/src/types.ts`
  - **The typed domain contract**: catalog entities, append-only records, commit ops (write model), derived views (read model), and the `Store` interface. A future backend implements exactly these shapes.

- `prototype-v2/src/store.ts`
  - Event-sourced Place Graph store (catalog + append-only records -> derived state). Node-importable.

- `prototype-v2/src/data.ts`
  - Seed catalog and seed records.

- `prototype-v2/src/app.ts` + `index.html` + `style.css`
  - The Home Memory Operations Console UI (browser loads the `tsc` output in `dist/`).

- `prototype-v2/src/agent.ts`
  - The typed agent toolkit: 14 tool descriptors (JSON-schema parameters) + dispatcher over the store, proposal-first rules enforced.

- `prototype-v2/src/agent-runtime.ts`
  - Provider-agnostic tool-calling loop: injected LLM function, decision-tool guard, bounded tool rounds, capped result serialization. Tested with scripted mock LLMs.

- `prototype-v2/src/ask.ts`
  - Deterministic intent router behind the Ask view — answers only through toolkit calls.

- `prototype-v2/src/agent-cli.ts`
  - `node src/agent-cli.ts [export.json]`: binds the toolkit to a real Claude model when `ANTHROPIC_API_KEY` is set; falls back to the router without one.

- `prototype-v2/src/server.ts`
  - The local sync service (P0.10): file-backed `StorageLike` adapter + zero-dependency HTTP API. Read views mirror the UI; `POST /tools/:name` is the only write path; decision tools 403 without `{ "confirmed": true }`; export/import schema-compatible with the app.

- `prototype-v2/src/agent-eval.ts`
  - The agent evaluation harness: seven PRD §6 jobs scored against demo-home ground truth (correct place, staleness admitted, no invented placements, decisions deferred). Real-model runs write `renders/agent-eval-report.{json,md}`.

- `prototype-v2/src/verify.ts`
  - Self-contained verification: strict tsc gate + PRD-mapped Node assertions (incl. mock-LLM runtime) + headless browser smoke + screenshots. Runs directly on Node >= 23.6 (type stripping).

- `prototype-v2/renders/verification-report.md`
  - Latest V2 verification report.

V40 archive prototype and verification:

- `prototype/index.html`
  - Current runnable prototype.

- `prototype/verify.mjs`
  - Browser verification.

- `prototype/self-loop.mjs`
  - Iteration critique loop.

- `prototype/renders/verification-report.json`
  - Latest assertion-level report.

- `prototype/renders/self-loop-report.md`
  - Latest human-readable self-loop report.

Live design notes:

- `docs/vision-scan-and-layout-layer.md`
  - Scan, 3D review, product intake, layout planning behavior.

- `docs/scan-algorithm-options.md`
  - Algorithm route notes and links.

Planning frontier:

- `.scratch/room-recall-v1x/map.md`
  - The live `wayfinder` map: destination, decisions so far, fog, out of scope.

- `.scratch/room-recall-v1x/issues/`
  - Decision tickets. These are not implementation tickets.

Retired — `docs/archive/` (provenance only, never current):

- `product-requirements.md` — the long-form requirements contract; still the deepest scan/3D/privacy discussion.
- `requirements-discovery.md`, `requirements-agent-synthesis.md`, `coordinate-prototype-synthesis.md` — discovery and synthesis notes from the pre-decision era.
- `roomrecall-legacy-prd-seed.md` — the original PRD seed.
- `self-loop-operating-system.md`, `iteration-40-ledger.md` — the **pre-Matt self-loop iteration process** and its V40 evidence ledger. How this repo iterates today is defined in `AGENTS.md`, not there.

## 13. Current Product Requirements Summary

P0 should prove value without requiring full 3D reconstruction:

- Home setup: spaces, containers, belongings, default/current place.
- Container memory: "what is in this box/drawer/shelf/bag?"
- Find and correct: answer with evidence, recover from wrong answer.
- Operations: move, unpack, gym, travel, cleaning.
- Moving flow: box labels, contents, status, destination, unpack priority.
- Capture proposal: photo/scan/manual creates proposals, not truth.
- Beautiful spatial review: lightweight 2D/3D, evidence and confidence visible.

P1:

- product intake from receipt/product page/manual dimensions;
- layout planning with fit/collision/path/storage scoring;
- shared home memory;
- insurance/asset export;
- smart suggestions.

P2:

- real visual reconstruction;
- AR placement;
- long-term home memory;
- multi-home support.

Anti-requirements:

- Do not require full room scan before value.
- Do not require exact coordinates for every cheap object.
- Do not trust automatic recognition without review.
- Do not model every drawer in 3D.
- Do not force 3D when list/container view is faster.
- Do not promise perfect CAD geometry from one phone video.

## 14. Scanning Direction

The scanning idea should stay in the product, but as a proposal engine.

Recommended pipeline:

```text
Capture
  -> local preflight for blur/coverage/privacy/scale anchors
  -> observations
  -> typed proposals
  -> review
  -> atomic commit
```

Recommended P0/P1 scan route:

- marker-assisted visual capture;
- known-size anchors;
- optional simple manual measurement;
- container snapshots;
- local-first privacy;
- proposal review.

Heavier routes are escalation paths:

- sparse SLAM / phone VIO;
- feed-forward 3D reconstruction;
- point-cloud scene parsing.

Do not make a large model the default product dependency until the Place Graph and review contract are valuable.

## 15. Frontend / Interaction Direction

(2026-07-07: `prototype-v2/` implements this direction — operations console first screen, review inbox, container cards, lightweight 2D plan. The guidance below remains the design rationale.)

The V40 prototype had too many dense panels and debug-style details. The correct visual direction is a `Home Memory Operations Console`, not another "room editor".

Recommended first screen:

- active operations: Move, Unpack, Gym, Travel;
- review inbox: scan proposals, stale containers, uncertain locations;
- quick search: "Where is X?";
- container cards: boxes/drawers/shelves/bags;
- lightweight 2D/3D spatial preview.

Keep:

- the small-room / little-house mental model;
- 2D + 3D toggles;
- object search;
- kit retrieval;
- evidence/confidence;
- scan proposal review.

Reduce:

- raw debug JSON in primary UI;
- too many simultaneous labels;
- every prototype contract appearing as visible product UI.

UI principle:

- 2D = exact editing and collision.
- 3D = memorable review and trust.
- List/table = fastest for operations and containers.

## 16. Backend Direction

There is no backend yet. The current backend contract is simulated through `backendContractSnapshot()`.

If implementing a real backend, start with these entities:

- `UserHome`
- `Space`
- `Room`
- `Zone`
- `Furniture`
- `Container`
- `Belonging`
- `ItemGroup`
- `Kit`
- `Operation`
- `PlacementRecord`
- `GeometryRecord`
- `Observation`
- `Proposal`
- `CommitLedgerEntry`
- `Evidence`
- `ScanSession`
- `ContainerSnapshot`

Storage principle:

- Store append-only records and derive current state.
- Do not store only one mutable `location` field.

Suggested minimal API shape:

- `POST /observations`
- `POST /proposals`
- `POST /commits`
- `GET /place-graph`
- `GET /belongings/search?q=...`
- `GET /containers/:id/contents`
- `POST /operations`
- `POST /operations/:id/kit-items`
- `POST /scan-sessions`
- `POST /container-snapshots`

## 17. Agent Direction

The Agent should not behave like a magical all-knowing locator.

It should:

- answer with place, evidence, confidence, freshness, and uncertainty;
- distinguish current place from default home;
- expand broad intents into kit requirements;
- merge duplicates and shared items;
- ask for review when evidence is weak;
- create proposals/drafts, not silent truth writes;
- handle "not there" as negative evidence;
- explain private/unknown regions as unknown, not empty;
- suggest next capture/review action when blocked.

Example answer style:

```text
Your water bottle is probably on the desk, right side.
Evidence: last-seen photo + placement record.
Confidence: 0.74.
If it is not there, mark "not there" and I will create a correction record.
```

## 18. Known Gaps

Product gaps:

- V1 wedge is decided: moving/unpacking + kits, with daily finding as the trust core.
- First-session onboarding exists, but activation still depends on manual entry and needs real-user timing.
- Need decide what the product looks like when the user has only 5 minutes.
- Need validate whether Capture or an operation is the strongest first-session entry in user tests.

Design gaps:

- Home, Capture, and Plan now share a cleaner spatial utility language; the remaining console surfaces still need the same pass.
- Review and Operations remain denser and more administrative than Home.
- Mobile has labeled bottom navigation and no-overflow coverage, but needs full touch-flow and keyboard/accessibility review.
- 3D is readable and orbitable; editing remains intentionally deferred.

Engineering gaps:

- A file-backed local HTTP service exists, but the browser still defaults to localStorage and is not wired to multi-device sync.
- No real camera/vision integration.
- A provider-agnostic agent runtime, Claude CLI binding, and eval harness exist; production provider/auth/telemetry are not integrated.
- UI is split across typed modules, but `src/app.ts` is still too large for production ownership boundaries.
- 3D geometry is a rendering projection; layout commits, drag/rotate/resize, and collision are not part of V2.

Scan gaps:

- Current scan is simulated.
- Browser capture/review is feasible; reliable visual-only room reconstruction should be a backend job, not an in-browser promise.
- Production baseline decision: ArUco/known measurement for scale + COLMAP/Metric3D on a backend; research models stay experimental and license-gated.
- Need privacy redaction policy before uploading any home media.
- Need a small real-CV spike that outputs only room envelope and 5–10 furniture proposals.

3D gaps:

- V2 now has an orbitable Three.js home and scan-proposal view with canvas pixel verification.
- Direct user-driven drag/rotate/resize, collision, and geometry commits remain in the V40 proof archive and are not promoted to V1.

## 19. Recommended Next Work

Status as of 2026-07-13 (v2.5, PRD v1.4):

- ~~Decide V1 surface~~ — done (`docs/adr/0001-v1-wedge-moving-and-kits.md`).
- ~~Tightened PRD~~ — done (`docs/nestory-v1-prd.md`, revised v1.1).
- ~~V2 Home Memory Console~~ — done (`prototype-v2/`, strict TypeScript).
- ~~Consumer-facing Home / Capture / spatial review pass~~ — done: redesigned Home, unified capture methods, exact product dimensions, and shared-coordinate 2D/3D Plan.
- ~~First-session onboarding / empty state~~ — done: welcome screen with demo/own home modes, guided Setup (rooms → containers → 10 belongings → first operation), live activation checklist, auto plan slots, all through ordinary ledger commits.
- ~~Photo capture for snapshots~~ — done at the evidence level: snapshots accept a downscaled photo stored as `photo_note` evidence and cited by accepted placements. Real CV/recognition intentionally still out of scope.
- ~~LLM agent runtime~~ — **done at the harness level** (v2.3): `src/agent.ts` (14 tools) + `src/agent-runtime.ts` (injected-LLM loop, decision tools blocked without explicit consent, bounded rounds, mock-tested) + `src/ask.ts` (deterministic router behind the in-app Ask view, visible tool calls) + `src/agent-cli.ts` (real Claude binding via the Messages API when `ANTHROPIC_API_KEY` is set, router fallback without). What remains is *evaluation with a real model*, not construction.
- Backend contract and local service — done at the prototype level (`src/types.ts` + `src/store.ts` + `src/server.ts`); browser-to-service sync remains opt-in future work.

Additional status (2026-07-13, v2.5):

- ~~Persistence beyond localStorage~~ — **done** as the local sync service: `src/server.ts` + `fileStorage` adapter. Records survive restarts (asserted); the toolkit is the only write path; export/import bridges browser ↔ service.
- Real-model evaluation — **harness done** (`src/agent-eval.ts`, 7 PRD jobs, offline-verified with an ideal scripted model). The actual scoring run needs an `ANTHROPIC_API_KEY`, which was not present in this environment.

The new queue:

### Next 1: Run The Real-Model Eval (One Command)

Everything is staged; this needs a key and five minutes:

```bash
cd prototype-v2 && ANTHROPIC_API_KEY=sk-… npm run eval
```

- Read `renders/agent-eval-report.md`; feed failures back into `AGENT_SYSTEM_PROMPT` (src/agent-runtime.ts) or tool descriptions (src/agent.ts) — both cheap to iterate, both covered by offline assertions.
- Then decide whether the in-app Ask view should call a model (needs a key proxy — the sync service is the natural place) or stay deterministic in V1.

### Next 2: Point The Browser App At The Sync Service (Opt-In)

The service exists; the app still uses localStorage.

- Add an opt-in "connect to sync service" setting: an async `StorageLike`-over-HTTP adapter, or have the app call `/tools` + read views directly.
- Keep localStorage as the offline fallback; reconcile via export/import semantics (last-write-wins is fine for a single user).

### Next 3: Field Test The First Session

The onboarding flow exists; now measure it against the PRD activation metric with a real user (the project owner counts).

- Run one real "own home" session end to end; record time-to-activation and where the flow stalls.
- Feed the friction back into Setup (likely candidates: bulk belonging entry, container templates per room type).

### Next 4: Replace The Deterministic Room Draft With One Real CV Spike

The Capture and 3D review interaction now exists. Keep its proposal-first contract, then replace only the deterministic geometry source with a bounded backend experiment: one room envelope, one scale anchor, and 5–10 large furniture candidates. Do not promote automatic item truth or full layout editing yet.

## 20. Suggested Skills For Next Agent

Route through `ask-matt`, then follow the configured workflow in `AGENTS.md` and `docs/agents/`:

- `wayfinder`: current entry for the multi-session V1.x effort. Load `.scratch/room-recall-v1x/map.md`, claim one frontier decision ticket, and resolve no more than one non-research ticket per session.
- `grill-with-docs` + `domain-modeling`: settle a bounded product or contract decision while keeping `CONTEXT.md` and ADRs current.
- `handoff -> prototype -> handoff`: answer a mobile, 2D/3D, or review interaction question with a disposable runnable artifact, then carry only the decision back.
- `research`: investigate external visual reconstruction capabilities from primary sources and leave a cited repo artifact.
- `to-spec`: run only when the decision map is clear; publish `.scratch/<feature>/spec.md`.
- `to-tickets`: split an approved spec into dependency-ordered tracer bullets with one local file per ticket.
- `implement` + `tdd` + `code-review`: execute one frontier ticket in a fresh context, at agreed public seams, then review Standards and Spec axes against a fixed Git point before commit.
- `domain-modeling` + `codebase-design`: model-invoked references for sharpening domain language and designing deep modules; reached through the skills above rather than called directly.
- `diagnosing-bugs`: on-ramp for a hard bug or performance regression, rather than folding it into an implementation ticket.

Note: `design-an-interface` was retired in `mattpocock/skills` v1.2 and is no longer part of this flow; UI work belongs inside a claimed `prototype` or `implement` ticket. Browser automation is a plain tool (Playwright via the local harness), not a workflow skill.

Do not blindly use skills if the user explicitly says "先别用 skills" and asks for direct prototype implementation. In that case, implement locally and verify.

## 21. What Not To Do

Do not:

- pitch this as "one scan makes a perfect 1:1 3D room";
- make 3D the canonical source of truth;
- let scan outputs silently mutate Place Graph records;
- hide uncertainty;
- conflate unknown with empty;
- make users inventory every cheap object;
- build a generic Trello/notion/list app;
- build a generic interior-design CAD tool;
- skip the correction loop;
- remove verification just to move faster.

## 22. Useful Mental Model

Nestory should feel like:

```text
home memory
  + container truth
  + task preparation
  + scan-assisted review
  + beautiful spatial recall
```

It should not feel like:

```text
toy 3D room editor
  + magical scanner
  + fragile item database
```

If you are unsure what to build next, ask:

```text
Does this make home memory cheaper to create, easier to trust, or more useful during a real operation?
```

If yes, it belongs.

If no, it is probably prototype spectacle.
