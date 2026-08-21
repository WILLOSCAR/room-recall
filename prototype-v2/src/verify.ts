// Nestory V2 verification harness (TypeScript).
// 0. Gate: `npx tsc` must typecheck and emit dist/ for the browser.
// 1. Node-native assertions against store.ts, mapped to docs/nestory-v1-prd.md §5.
//    (Runs directly on Node >= 23.6 via type stripping — no build needed for logic.)
// 2. Headless Chrome smoke (self-served static files + CDP) with screenshots.
// Usage: node src/verify.ts    (from prototype-v2/, after `npm install` once)

import { spawn, spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { catalog, buildSeedRecords, emptyCatalog } from "./data.ts";
import { createStore, DomainInputError, ReentrantStoreCommandError } from "./store.ts";
import { createAgentToolkit } from "./agent.ts";
import type { AgentToolkit } from "./agent.ts";
import { ask } from "./ask.ts";
import { runAgentTurn } from "./agent-runtime.ts";
import type { LlmFn, LlmReply } from "./agent-runtime.ts";
import { fileStorage, startNestoryServer } from "./server.ts";
import { buildHouseholdRecords } from "./scale-fixture.ts";
import { runAgentEval, formatEvalReport, EVAL_JOBS } from "./agent-eval.ts";
import type { EvalJob } from "./agent-eval.ts";
import type {
  BelongingEntity, Catalog, CapabilityProfile, DeepReadonly, KitOperationView, LocateAnswer, LocateSuccess, StorageLike, Store, StoreOptions
} from "./types.ts";

const pkgRoot = fileURLToPath(new URL("../", import.meta.url));
const renderDir = new URL("../renders/", import.meta.url);
const httpPort = 8790;
const cdpPort = 9238;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NOW = Date.parse("2026-07-09T12:00:00Z");

await mkdir(renderDir, { recursive: true });

interface AssertionResult {
  section: string;
  id: string;
  ok: boolean;
  detail: string;
}

const results: AssertionResult[] = [];
let failures = 0;
let currentSection = "";

function setSection(name: string): void {
  currentSection = name;
  console.log(`\n== ${name} ==`);
}

function assert(id: string, cond: unknown, detail: unknown = ""): void {
  const ok = !!cond;
  const detailText = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ section: currentSection, id, ok, detail: detailText });
  if (!ok) {
    failures += 1;
    console.error(`  ✗ ${id}${detailText ? ` — ${detailText}` : ""}`);
  } else {
    console.log(`  ✓ ${id}`);
  }
}

function section(name: string, fn: () => void): void {
  setSection(name);
  try {
    fn();
  } catch (err) {
    failures += 1;
    const detail = err instanceof Error ? err.stack ?? err.message : String(err);
    results.push({ section: name, id: "section-crashed", ok: false, detail });
    console.error(`  ✗ section crashed — ${detail}`);
  }
}

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}

function fresh(overrides: Partial<StoreOptions> = {}): Store {
  return createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: null, ...overrides });
}

function expectOk(answer: ReturnType<Store["locate"]>): DeepReadonly<LocateSuccess> {
  if (!answer.ok) throw new Error(`Expected a successful locate answer, got: ${answer.sentence}`);
  return answer;
}

function expectKit(store: Store, opId: string): DeepReadonly<KitOperationView> {
  const op = store.operationView(opId);
  if (!op || op.type !== "kit") throw new Error(`Expected kit operation ${opId}`);
  return op;
}

// =====================================================================
// TypeScript gate: strict typecheck + browser build must pass first.
// =====================================================================
setSection("typescript gate");
{
  const tsc = spawnSync("npx", ["tsc", "--pretty", "false"], { cwd: pkgRoot, encoding: "utf8" });
  const output = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`.trim();
  assert("tsc-typecheck-and-emit", tsc.status === 0, output.slice(0, 800) || `exit ${tsc.status}`);
  assert("dist-app-emitted", existsSync(join(pkgRoot, "dist", "app.js")));
}

// =====================================================================
// P0.1 Home setup
// =====================================================================
section("P0.1 home setup", () => {
  const store = fresh();
  assert("rooms>=2", catalog.rooms.length >= 2, `${catalog.rooms.length} rooms`);
  const kinds = new Set(catalog.containers.map((c) => c.kind));
  assert("containers>=5-with-kinds", catalog.containers.length >= 5 && kinds.has("drawer") && kinds.has("shelf") && kinds.has("bag"),
    `${catalog.containers.length} containers, kinds=${[...kinds].join(",")}`);
  const withHome = catalog.belongings.filter((b) => b.defaultHome);
  assert("belongings>=15-with-default-home", withHome.length >= 15, `${withHome.length}`);

  const before = store.commitsView().length;
  const id = store.createBelonging({
    name: "Kindle", kinds: ["e-reader", "electronics"], importance: "high",
    defaultHome: { type: "container", id: "bedside-drawer" },
    currentPlace: { type: "container", id: "backpack" },
    dimensions: { width: 0.16, depth: 0.11, height: 0.009, unit: "m", source: "product", verified: true },
    source: "product"
  });
  const view = store.belongingView(id);
  assert("create-belonging-one-action", !!view && view.chainText.includes("Backpack") && view.defaultHomeText.includes("Bedside drawer"), view?.chainText);
  assert("create-belonging-ledgered", store.commitsView().length === before + 1);
  assert("product-dimensions-normalized", view?.dimensions?.unit === "m" && view.dimensions.width === 0.16 && view.source === "product", view?.dimensions);

  store.setItemState(id, "with_me");
  assert("state-change-applies", store.lifecycleOf(id) === "with_me");
  assert("state-change-ledgered", store.commitsView()[0]?.ops.some((o) => o.type === "set_state"));
  const kindle = store.locate("kindle");
  assert("state-answer-sentence", kindle.sentence.includes("with you"), kindle.sentence);
});

section("P0.1 invalid commands are lossless", () => {
  const store = fresh();
  const before = store.recordCount;
  const commands = [
    () => store.createBelonging({ name: "Dangling item", defaultHome: { type: "container", id: "no-such-container" } }),
    () => store.correctPlacement("water-bottle", { type: "container", id: "no-such-container" }),
    () => store.setItemState("no-such-item", "missing"),
    () => store.setRowStatus("no-such-operation", "no-such-row", "found"),
    () => store.setOperationStatus("no-such-operation", "done"),
    () => store.setBoxStatus("desk-top", "packed"),
    () => store.createRoom({ name: "Invalid geometry", plan: { x: 0, y: 0, w: -1, h: 2 } }),
    () => store.createBelonging({
      name: "Invalid dimensions",
      defaultHome: { type: "container", id: "entry-tray" },
      dimensions: { width: Number.NaN, depth: 1, height: 1, unit: "m", source: "manual", verified: true }
    })
  ];
  let rejected = 0;
  for (const command of commands) {
    try { command(); } catch { rejected += 1; }
  }
  assert("invalid-domain-references-are-rejected", rejected === commands.length, `${rejected}/${commands.length}`);
  assert("invalid-domain-commands-append-nothing", store.recordCount === before, `${before} -> ${store.recordCount}`);
});

section("P0.1 Store projection is read-only", () => {
  const store = fresh();
  const state = store.state;
  const rooms = state.rooms as unknown as { set?: unknown };
  assert("store-state-hides-map-mutation", rooms.set === undefined);
  assert("store-state-freezes-record-arrays", Object.isFrozen(state.proposals) && Object.isFrozen(state.observations) && Object.isFrozen(state.commits));
  const first = store.searchBelongings("water bottle");
  try { (first[0] as { name?: string } | undefined)!.name = "Poisoned cache"; } catch { /* expected for a frozen projection */ }
  assert("store-query-cache-cannot-be-poisoned", Object.isFrozen(first) && store.searchBelongings("water bottle")[0]?.name === "Water bottle");
  try { (store.catalog.furniture[0] as { name: string }).name = "Poisoned catalog"; } catch { /* frozen */ }
  assert("store-catalog-cannot-be-poisoned", store.chainFor({ type: "furniture", id: "bed" })[0]?.name === "Bed");
  const exported = store.exportJson();
  const exportedEvidence = exported.records.find((record) => record.recordType === "evidence");
  if (exportedEvidence?.recordType === "evidence") exportedEvidence.summary = "Poisoned export";
  assert("store-export-does-not-alias-ledger", !store.exportJson().records.some((record) => record.recordType === "evidence" && record.summary === "Poisoned export"));
});

section("P0.1 indexed search preserves public ranking", () => {
  const store = fresh();
  const baselineRecords = buildSeedRecords(NOW);
  store.importJson({
    version: 2,
    exportedAt: new Date(NOW).toISOString(),
    records: buildHouseholdRecords(NOW, 256),
    baselineRecords
  });
  store.searchBelongings("scale item 0042"); // materialize the old revision's lazy index
  const longKind = `long-kind-${"segment-".repeat(6)}tail`;
  store.createBelonging({
    name: "Unrelated index sentinel",
    kinds: ["long-multi-part-kind", longKind],
    defaultHome: { type: "container", id: "entry-tray" }
  });

  const legacyScore = (belonging: DeepReadonly<BelongingEntity>, query: string): number => {
    const name = belonging.name.toLowerCase();
    if (name === query) return 100;
    if (name.includes(query)) return 80;
    const queryTokens = query.split(/\s+/).filter(Boolean);
    const nameTokens = name.split(/\s+/);
    const overlap = queryTokens.filter((token) => nameTokens.some((nameToken) => nameToken.startsWith(token))).length;
    if (overlap && overlap === queryTokens.length) return 70;
    if (belonging.kinds.some((kind) => kind.includes(query.replace(/\s+/g, "-")) || query.includes(kind.replace(/-/g, " ")))) return 55;
    return overlap ? 30 + overlap : 0;
  };
  const representativeQueries = [
    "", "scale item 0042 shared term", "item 0042 shared", "scale 0042",
    "scale fixture", "find scale fixture please", "004", "LONG MULTI PART KIND", "no remembered match"
  ];
  const queryParts = ["scale", "item", "shared", "term", "fixture", "long", "multi", "part", "kind", "unknown"];
  for (let index = 0; index < 48; index += 1) {
    const length = index % 4 + 1;
    representativeQueries.push(Array.from({ length }, (_, offset) => queryParts[(index * 7 + offset * 3) % queryParts.length] as string).join(" "));
  }

  let equivalent = true;
  let topFourEquivalent = true;
  let mismatch = "";
  for (const rawQuery of representativeQueries) {
    const query = rawQuery.trim().toLowerCase();
    const expected = [...store.state.belongings.values()]
      .filter((belonging) => !belonging.mergedInto)
      .map((belonging) => ({ id: belonging.id, name: belonging.name, score: query ? legacyScore(belonging, query) : 1 }))
      .filter((row) => !query || row.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const actual = store.searchBelongings(rawQuery);
    const expectedSignature = expected.map((row) => `${row.id}:${row.score}`).join("|");
    const actualSignature = actual.map((row) => `${row.id}:${row.score}`).join("|");
    if (expectedSignature !== actualSignature) {
      equivalent = false;
      mismatch = `${JSON.stringify(rawQuery)} expected ${expectedSignature.slice(0, 240)} got ${actualSignature.slice(0, 240)}`;
      break;
    }
    const answer = store.locate(rawQuery);
    if (expected.length === 0) {
      if (answer.ok) topFourEquivalent = false;
    } else if (!answer.ok || answer.itemId !== expected[0]?.id
      || answer.alternates.map((row) => row.id).join("|") !== expected.slice(1, 4).map((row) => row.id).join("|")) {
      topFourEquivalent = false;
      mismatch = `${JSON.stringify(rawQuery)} locate top four diverged`;
      break;
    }
  }
  const pageDump = store.exportJson();
  const pageStore = fresh();
  pageStore.importJson(pageDump);
  const comparisonStore = fresh();
  comparisonStore.importJson(pageDump);
  const broadPage = pageStore.searchBelongingsPage("shared term", 17, 23);
  const fullBroadSearch = comparisonStore.searchBelongings("shared term");
  assert(
    "bounded-search-page-preserves-full-ranking-without-aliases",
    broadPage.total > 100
      && broadPage.items.length === 23
      && broadPage.total === fullBroadSearch.length
      && broadPage.items.map((row) => row.id).join("|") === fullBroadSearch.slice(17, 40).map((row) => row.id).join("|")
      && Object.isFrozen(broadPage)
      && Object.isFrozen(broadPage.items),
    `${broadPage.total}/${fullBroadSearch.length}`
  );
  assert("indexed-search-matches-legacy-ranking", equivalent, mismatch);
  assert("indexed-locate-top-four-matches-full-search", topFourEquivalent, mismatch);
  assert("search-index-invalidates-after-write", store.searchBelongings("unrelated index sentinel")[0]?.name === "Unrelated index sentinel");
  assert("multi-hyphen-kind-remains-searchable", store.searchBelongings("long multi part kind")[0]?.name === "Unrelated index sentinel");
  assert("long-kind-index-remains-linear-and-searchable", store.searchBelongings("segment segment segment")[0]?.name === "Unrelated index sentinel");
});

section("P0.1 subscriber revisions publish FIFO", () => {
  const store = fresh({ catalog: emptyCatalog, seedFactory: () => [] });
  let reentrantRejected = false;
  let reentrantMessage = "";
  const seen: Array<{ delivered: number; live: number; revision: number; records: number; exported: number }> = [];
  store.subscribe((state) => {
    if (!reentrantRejected && state.rooms.size === 1) {
      try { store.createRoom({ name: "Nested" }); }
      catch (error) {
        reentrantRejected = error instanceof ReentrantStoreCommandError;
        reentrantMessage = error instanceof Error ? error.message : String(error);
      }
    }
  });
  store.subscribe((state) => {
    seen.push({
      delivered: state.rooms.size,
      live: store.state.rooms.size,
      revision: store.revision,
      records: store.recordCount,
      exported: store.exportJson().records.length
    });
  });
  store.createRoom({ name: "Outer" });
  assert(
    "reentrant-subscriber-sees-every-coherent-revision-in-order",
    JSON.stringify(seen) === JSON.stringify([
      { delivered: 1, live: 1, revision: 1, records: 1, exported: 1 }
    ]),
    seen
  );
  assert("reentrant-subscriber-command-is-rejected-before-write", reentrantRejected && store.recordCount === 1, reentrantMessage);
  store.createRoom({ name: "Nested" });
  store.createRoom({ name: "Nested" });
  const reloaded = fresh({ catalog: emptyCatalog, seedFactory: () => [] });
  reloaded.importJson(store.exportJson());
  assert("post-publication-command-ledger-remains-reloadable", reloaded.state.rooms.size === 3, reloaded.state.rooms.size);
});

section("P0.1 persistence callbacks cannot re-enter commands", () => {
  const image = new Map<string, string>();
  let store: Store;
  let attempted = false;
  let reentrantRejected = false;
  let reentrantMessage = "";
  const storage: StorageLike = {
    getItem: (key) => image.get(key) ?? null,
    setItem: (key, value) => {
      if (!attempted) {
        attempted = true;
        try { store.createRoom({ name: "Storage nested" }); }
        catch (error) {
          reentrantRejected = error instanceof ReentrantStoreCommandError;
          reentrantMessage = error instanceof Error ? error.message : String(error);
        }
      }
      image.set(key, value);
    }
  };
  store = createStore({ catalog: emptyCatalog, seedFactory: () => [], storage, persistKey: "reentrant-storage" });
  store.createRoom({ name: "Outer" });
  assert("storage-callback-command-is-rejected-before-write", reentrantRejected && store.recordCount === 1 && store.state.rooms.size === 1, reentrantMessage);
  const reloaded = createStore({ catalog: emptyCatalog, seedFactory: () => [], storage, persistKey: "reentrant-storage" });
  assert("storage-reentry-cannot-create-acknowledged-ghost", reloaded.recordCount === 1 && reloaded.state.rooms.size === 1, `${reloaded.recordCount}/${reloaded.state.rooms.size}`);
});

section("P0.1 imported ids cannot collide with later commands", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const recordCollisionStore = fresh({ catalog: emptyCatalog, seedFactory: () => [] });
    recordCollisionStore.importJson({
      version: 2,
      records: [{ recordType: "evidence", id: "commit-2-0", at: new Date(NOW).toISOString(), kind: "photo_note", summary: "Preoccupied generated record id" }]
    });
    recordCollisionStore.createRoom({ name: "Collision-safe room" });
    const recordIds = recordCollisionStore.exportJson().records.map((record) => record.id);
    const recordReload = fresh({ catalog: emptyCatalog, seedFactory: () => [] });
    recordReload.importJson(recordCollisionStore.exportJson());
    assert("allocator-skips-imported-record-ids-and-remains-reloadable", new Set(recordIds).size === recordIds.length && recordReload.state.rooms.size === 1, recordIds.join("|"));

    const entityCollisionStore = fresh({ catalog: emptyCatalog, seedFactory: () => [] });
    entityCollisionStore.importJson({
      version: 2,
      records: [{
        recordType: "commit", id: "seed-room", at: new Date(NOW).toISOString(), summary: "Preoccupied entity id",
        ops: [{ type: "create_room", room: { id: "box-2-0", name: "Imported room", plan: { x: 0, y: 0, w: 2, h: 2 } } }]
      }]
    });
    const boxId = entityCollisionStore.createBox({ label: "Collision-safe box", roomId: "box-2-0" });
    const entityReload = fresh({ catalog: emptyCatalog, seedFactory: () => [] });
    entityReload.importJson(entityCollisionStore.exportJson());
    assert("allocator-skips-imported-entity-ids-and-remains-reloadable", boxId !== "box-2-0" && entityReload.state.containers.has(boxId), boxId);
  } finally {
    Math.random = originalRandom;
  }
});

section("P0.1 stale proposals fail before durable acceptance", () => {
  const store = fresh({ catalog: emptyCatalog, seedFactory: () => [] });
  store.importJson({
    version: 2,
    records: [
      {
        recordType: "commit", id: "setup-room", at: new Date(NOW).toISOString(), summary: "Setup room",
        ops: [{ type: "create_room", room: { id: "room-one", name: "Room one", plan: { x: 0, y: 0, w: 2, h: 2 } } }]
      },
      {
        recordType: "commit", id: "setup-container", at: new Date(NOW + 1).toISOString(), summary: "Setup container",
        ops: [{ type: "create_container", container: { id: "container-one", name: "Container one", kind: "shelf", parent: { type: "room", id: "room-one" } } }]
      },
      {
        recordType: "proposal", id: "stale-create-proposal", type: "contents_update", at: new Date(NOW + 2).toISOString(),
        sourceObservationIds: [], summary: "Create proposed belonging",
        suggestedOps: [{
          type: "create_belonging",
          belonging: { id: "item-4-0", name: "Proposed item", kinds: [], importance: "normal", defaultHome: { type: "container", id: "container-one" } }
        }]
      }
    ]
  });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const createdId = store.createBelonging({ name: "New current item", defaultHome: { type: "container", id: "container-one" } });
    assert("stale-proposal-fixture-occupies-suggested-id", createdId === "item-4-0", createdId);
    const beforeAccept = store.recordCount;
    let rejected = false;
    try { store.acceptProposal("stale-create-proposal"); }
    catch (error) { rejected = error instanceof DomainInputError && /no longer applies/i.test(error.message); }
    const reloaded = fresh({ catalog: emptyCatalog, seedFactory: () => [] });
    reloaded.importJson(store.exportJson());
    assert(
      "stale-proposal-acceptance-rolls-back-and-ledger-reloads",
      rejected
        && store.recordCount === beforeAccept
        && store.proposals("pending").some((proposal) => proposal.id === "stale-create-proposal")
        && reloaded.state.belongings.get(createdId)?.name === "New current item",
      `${rejected}/${beforeAccept}->${store.recordCount}`
    );
  } finally {
    Math.random = originalRandom;
  }
});

// =====================================================================
// P0.2 Container memory
// =====================================================================
section("P0.2 container memory", () => {
  const store = fresh();
  const drawer = store.containerContents("wardrobe-second-drawer");
  if (!drawer) throw new Error("missing wardrobe-second-drawer");
  const names = drawer.items.map((i) => i.id);
  assert("contents-from-placements", names.includes("black-training-shirt") && names.includes("training-shorts"), names.join(","));
  assert("contents-freshness-exposed", typeof drawer.daysSinceConfirmed === "number" && drawer.stale === false, `confirmed ${drawer.daysSinceConfirmed}d ago`);

  const staleDrawer = store.containerContents("wardrobe-top-drawer");
  assert("stale-container-flagged", staleDrawer?.stale === true && staleDrawer.unknownNote !== null, staleDrawer?.unknownNote);
  assert("stale-list-has-top-drawer", store.staleContainers().some((c) => c.id === "wardrobe-top-drawer"));

  const hits = store.whichContainerHas("passport");
  assert("which-container-has", hits[0]?.container.id === "bedside-drawer", hits[0]?.container.id);

  const placementsBefore = store.belongingView("usb-c-charger")?.chainText;
  const pid = store.snapshotContainer("entry-tray", "usb-c charger, coins");
  const proposal = store.proposals().find((p) => p.id === pid);
  assert("snapshot-creates-proposal", proposal?.type === "contents_update" && proposal.status === "pending");
  assert("snapshot-never-direct-write", store.belongingView("usb-c-charger")?.chainText === placementsBefore);
  assert("snapshot-observation-linked", proposal?.sourceObservationIds.length === 1);

  const dedupeStore = fresh();
  const repeatedProposalId = dedupeStore.snapshotContainer("entry-tray", Array.from({ length: 80 }, () => "water bottle").join(","));
  const repeatedProposal = dedupeStore.proposals().find((candidate) => candidate.id === repeatedProposalId);
  const repeatedPlacementOps = repeatedProposal?.suggestedOps.filter((op) => op.type === "create_placement" || op.type === "contradict_placement") ?? [];
  assert("snapshot-deduplicates-labels-and-resolved-items", repeatedPlacementOps.length === 2, repeatedPlacementOps.length);
  const recordsBeforeOversizedSnapshot = dedupeStore.recordCount;
  let oversizedSnapshotRejected = false;
  try { dedupeStore.snapshotContainer("entry-tray", "x".repeat(4_001)); }
  catch (error) { oversizedSnapshotRejected = /at most 4000/i.test(String(error)); }
  assert("snapshot-text-bound-rejects-before-ledger-write", oversizedSnapshotRejected && dedupeStore.recordCount === recordsBeforeOversizedSnapshot, `${oversizedSnapshotRejected}/${dedupeStore.recordCount}`);
  let excessiveLabelsRejected = false;
  try { dedupeStore.snapshotContainer("entry-tray", Array.from({ length: 101 }, (_, index) => `distinct-${index}`).join(",")); }
  catch (error) { excessiveLabelsRejected = /at most 100 distinct labels/i.test(String(error)); }
  assert("snapshot-label-count-bound-rejects-before-ledger-write", excessiveLabelsRejected && dedupeStore.recordCount === recordsBeforeOversizedSnapshot, `${excessiveLabelsRejected}/${dedupeStore.recordCount}`);

  store.acceptProposal(pid);
  assert("snapshot-accept-moves-item", store.belongingView("usb-c-charger")?.chainText.includes("Entry tray"), store.belongingView("usb-c-charger")?.chainText);
  assert("snapshot-accept-confirms-container", store.containerContents("entry-tray")?.daysSinceConfirmed === 0);
});

// =====================================================================
// P0.3 Find and correct (trust core)
// =====================================================================
section("P0.3 find and correct", () => {
  const store = fresh();
  const a = expectOk(store.locate("water bottle"));
  assert("locate-chain", a.chainText === "Desk top · Desk · Bedroom", a.chainText);
  assert("locate-contract-fields",
    typeof a.confidence === "number" && Array.isArray(a.evidence) && a.evidence.length > 0 &&
    typeof a.daysSinceUpdate === "number" && typeof a.defaultHomeText === "string" && typeof a.sentence === "string",
    { conf: a.confidence, ev: a.evidence.length, days: a.daysSinceUpdate });
  assert("locate-default-home-distinct", a.atDefaultHome === true && a.defaultHomeText.includes("Desk top"));

  const staleAnswer = expectOk(store.locate("sport socks"));
  assert("stale-answer-admits-uncertainty", staleAnswer.stale && staleAnswer.uncertain && /days old|not confident/i.test(staleAnswer.sentence), staleAnswer.sentence);

  const confBefore = a.confidence;
  const { observationId, proposalId } = store.markNotThere("water-bottle");
  assert("not-there-creates-observation", store.state.observations.some((o) => o.id === observationId && o.type === "not_there_report"));
  const correction = store.proposals().find((p) => p.id === proposalId);
  assert("not-there-opens-correction", correction?.type === "placement_correction" && correction.needsPlace === true);
  const afterNeg = expectOk(store.locate("water bottle"));
  assert("not-there-drops-confidence", afterNeg.confidence < confBefore, `${confBefore} -> ${afterNeg.confidence}`);

  let threw = false;
  try { store.acceptProposal(proposalId); } catch { threw = true; }
  assert("correction-requires-place", threw);

  const commit = store.acceptProposal(proposalId, { placeRef: { type: "container", id: "backpack" } });
  const opTypes = commit.ops.map((o) => o.type);
  assert("correction-single-commit-ops", opTypes.includes("contradict_placement") && opTypes.includes("create_placement") && opTypes.includes("accept_proposal"), opTypes.join(","));

  const view = store.belongingView("water-bottle");
  assert("old-record-kept-contradicted", view?.history.length === 2 && view.history[0]?.contradictedAt !== null && view.history[0]?.contradictedReason === "not_there_report");
  const corrected = expectOk(store.locate("water bottle"));
  assert("corrected-answer", corrected.chainText.includes("Backpack") && corrected.confidence >= 0.8, `${corrected.chainText} conf=${corrected.confidence}`);
  assert("corrected-evidence-cites-correction", corrected.evidence.some((e) => e.kind === "correction"), corrected.evidence.map((e) => e.kind).join(","));
  assert("commit-lineage-to-proposal", commit.sourceProposalId === proposalId && (commit.sourceObservationIds ?? []).includes(observationId));
});

// =====================================================================
// P0.4 Operations and kits
// =====================================================================
section("P0.4 operations and kits", () => {
  const store = fresh();
  const gymId = store.startOperation("gym");
  const gym = expectKit(store, gymId);
  assert("kit-rows-resolved", gym.rows.length >= 8 && gym.rows.every((r) => r.status), `${gym.rows.length} rows`);

  const merged = gym.rows.find((r) => r.reqLabels.length > 1);
  assert("duplicate-reqs-merge", merged?.itemId === "black-training-shirt", merged?.reqLabels.join("+"));
  const resolvedIds = gym.rows.filter((r) => r.itemId).map((r) => r.itemId);
  assert("no-duplicate-item-rows", new Set(resolvedIds).size === resolvedIds.length);

  const towel = gym.rows.find((r) => r.reqLabels.includes("Towel"));
  assert("substitute-group-resolves", towel?.itemId === "large-towel" && towel.status === "substituted", towel?.note);

  const travelId = store.startOperation("travel");
  const travel = expectKit(store, travelId);
  const gym2 = expectKit(store, gymId);
  const sharedInGym = gym2.rows.find((r) => r.itemId === "water-bottle");
  const sharedInTravel = travel.rows.find((r) => r.itemId === "water-bottle");
  assert("shared-items-flagged", !!sharedInGym?.sharedWith?.includes(travelId) && !!sharedInTravel?.sharedWith?.includes(gymId));

  assert("initial-readiness-needs-review", gym2.readiness.status === "needs_review", gym2.readiness);
  for (const row of gym2.rows.filter((r) => r.level === "required" && r.status === "to_get")) {
    store.setRowStatus(gymId, row.id, "found");
  }
  assert("readiness-ready-after-found", expectKit(store, gymId).readiness.status === "ready");

  const anyRequired = expectKit(store, gymId).rows.find((r) => r.level === "required");
  if (!anyRequired) throw new Error("no required row");
  store.setRowStatus(gymId, anyRequired.id, "missing");
  assert("readiness-missing-items", expectKit(store, gymId).readiness.status === "missing_items");
  store.setRowStatus(gymId, anyRequired.id, "packed");
  assert("row-statuses-ledgered", store.commitsView()[0]?.ops[0]?.type === "set_op_row_status");

  // A required item in an unavailable state (no substitute) surfaces as uncertain with a note.
  const store2 = fresh();
  store2.setItemState("gym-card", "missing");
  const gym3 = expectKit(store2, store2.startOperation("gym"));
  const cardRow = gym3.rows.find((r) => r.reqLabels.includes("Gym card"));
  assert("unavailable-item-uncertain-with-note", cardRow?.status === "uncertain" && /missing/.test(cardRow.note ?? ""), cardRow?.note);
});

// =====================================================================
// P0.5 Moving flow
// =====================================================================
section("P0.5 moving flow", () => {
  const store = fresh();
  const moveOp = store.operationsView().find((o) => o.type === "move");
  if (!moveOp) throw new Error("seed move op missing");
  assert("seed-move-op-active", moveOp.status === "active" && moveOp.boxes.length === 2, `${moveOp.boxes.length} boxes`);

  const boxId = store.createBox({ label: "Bedside rescue", destination: "New home · bedroom", operationId: moveOp.id });
  const box = store.state.containers.get(boxId);
  assert("create-box", box?.kind === "box" && box.box?.destination === "New home · bedroom");

  store.assignToBox("medicine-kit", boxId);
  const med = store.belongingView("medicine-kit");
  assert("assign-sets-placement-and-state", med?.state === "packed" && med.chainText.includes("Bedside rescue"), med?.chainText);
  assert("assign-bumps-box-status", store.state.containers.get(boxId)?.boxStatus === "packing");

  const hits = store.whichContainerHas("medicine");
  const firstHit = hits[0];
  assert("search-across-boxes", !!firstHit && firstHit.isBox && firstHit.container.id === boxId, firstHit?.container.id);

  const priority = store.unpackPriority();
  const top = priority[0];
  assert("unpack-priority-essentials-first", top?.box.id === boxId && top.essentials.includes("Medicine kit"),
    priority.map((p) => `${p.box.id}:${p.score}`).join(" "));

  for (const status of ["packed", "moved", "opened"] as const) store.setBoxStatus(boxId, status);
  assert("box-status-transitions-ledgered",
    store.commitsView(3).every((c) => c.ops[0]?.type === "set_box_status"),
    store.commitsView(3).map((c) => c.summary).join(" | "));
  assert("commit-limit-preserves-newest-first", store.commitsView(3).map((c) => c.id).join("|") === store.commitsView().slice(0, 3).map((c) => c.id).join("|"));
  assert("commit-limit-zero-preserves-full-view", store.commitsView(0).length === store.commitsView().length);
  let invalidCommitLimits = 0;
  for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    try { store.commitsView(invalid); } catch (error) { if (error instanceof RangeError) invalidCommitLimits += 1; }
  }
  assert("commit-limit-rejects-invalid-windows", invalidCommitLimits === 4, `${invalidCommitLimits}/4`);

  store.unpackItem("medicine-kit");
  const medAfter = store.belongingView("medicine-kit");
  assert("unpack-returns-to-default-home", medAfter?.state === "at_home" && medAfter.atDefaultHome === true, medAfter?.chainText);
  assert("empty-box-auto-unpacked", store.state.containers.get(boxId)?.boxStatus === "unpacked");
  assert("unpack-history-preserved", medAfter?.history.length === 3 && medAfter.history[1]?.contradictedReason === "unpacked");

  const shelfStore = fresh();
  shelfStore.unpackItem("gym-shoes");
  assert("unpack-from-non-box-does-not-emit-box-status", !shelfStore.commitsView()[0]?.ops.some((op) => op.type === "set_box_status"));

  const boundaryStore = fresh();
  const defaultDestinationBoxId = boundaryStore.createBox({ label: "Default destination", destination: "" });
  assert("empty-box-destination-keeps-compatible-default", boundaryStore.state.containers.get(defaultDestinationBoxId)?.box?.destination === "New home");
  const boundaryBoxId = boundaryStore.createBox({ label: "x".repeat(100), destination: "y".repeat(200) });
  const boundaryReload = fresh();
  boundaryReload.importJson(boundaryStore.exportJson());
  assert("box-name-boundary-remains-reloadable", boundaryReload.state.containers.has(boundaryBoxId));
  const boundaryRecordCount = boundaryStore.recordCount;
  let oversizedBoxRejected = false;
  try { boundaryStore.createBox({ label: "x".repeat(101) }); }
  catch (error) { oversizedBoxRejected = error instanceof DomainInputError; }
  assert("box-label-over-bound-rejects-before-write", oversizedBoxRejected && boundaryStore.recordCount === boundaryRecordCount, `${oversizedBoxRejected}/${boundaryStore.recordCount}`);
});

// =====================================================================
// P0.6 Capture proposal and review inbox
// =====================================================================
section("P0.6 capture proposal and review", () => {
  const store = fresh();
  const pending = store.proposals();
  assert("seed-inbox-pending", pending.length === 2, pending.map((p) => p.id).join(","));

  const gymCardMove = pending.find((p) => p.id === "proposal-gym-card-move");
  if (!gymCardMove) throw new Error("seed proposal missing");
  assert("seed-snapshot-proposal", gymCardMove.type === "placement_correction");
  const before = store.belongingView("gym-card")?.chainText;
  store.rejectProposal(gymCardMove.id, "checked: card is in the backpack");
  assert("reject-no-mutation", store.belongingView("gym-card")?.chainText === before);
  assert("reject-ledgered", store.commitsView()[0]?.ops[0]?.type === "reject_proposal");
  assert("reject-status-tracked", store.proposals(null).find((p) => p.id === gymCardMove.id)?.status === "rejected");

  const dup = store.proposals().find((p) => p.type === "duplicate_merge");
  if (!dup) throw new Error("duplicate proposal missing");
  store.acceptProposal(dup.id);
  const tee = store.state.belongings.get("training-tee");
  assert("merge-marks-item", tee?.mergedInto === "black-training-shirt");
  assert("merge-hides-from-search", !store.searchBelongings("").some((v) => v.id === "training-tee"));
  assert("merge-contradicts-placement", store.state.placements.get("training-tee")?.active === null);
  const redirect = store.locate("training tee");
  assert("merge-query-redirects", redirect.ok && redirect.itemId === "black-training-shirt");
  assert("inbox-empty-after-decisions", store.proposals().length === 0);

  const correctedPlacement = fresh();
  correctedPlacement.acceptProposal("proposal-gym-card-move", { placeRef: { type: "container", id: "bedside-drawer" } });
  assert("review-can-correct-placement-before-accept", correctedPlacement.belongingView("gym-card")?.chainText.includes("Bedside drawer"));
  assert("corrected-accept-is-ledgered", correctedPlacement.commitsView()[0]?.summary.startsWith("Accept with correction:"));

  const correctedMerge = fresh();
  correctedMerge.acceptProposal("proposal-merge-training-tee", { mergeKeepId: "training-tee" });
  assert("review-can-choose-duplicate-survivor", correctedMerge.state.belongings.get("black-training-shirt")?.mergedInto === "training-tee");
  const correctedRedirect = correctedMerge.locate("black training shirt");
  assert("corrected-merge-keeps-query-redirect", correctedRedirect.ok && correctedRedirect.itemId === "training-tee");

  const multiPlacement = fresh();
  const multiProposalId = multiPlacement.snapshotContainer("entry-tray", "usb-c charger, water bottle");
  const multiProposal = multiPlacement.proposals().find((proposal) => proposal.id === multiProposalId);
  assert("multi-placement-proposal-has-two-items", multiProposal?.suggestedOps.filter((op) => op.type === "create_placement").length === 2);
  multiPlacement.acceptProposal(multiProposalId, {
    placementOverrides: {
      "usb-c-charger": { type: "container", id: "bedside-drawer" },
      "water-bottle": { type: "container", id: "entry-tray" }
    }
  });
  assert("per-item-placement-overrides-stay-distinct", multiPlacement.belongingView("usb-c-charger")?.chainText.includes("Bedside drawer") && multiPlacement.belongingView("water-bottle")?.chainText.includes("Entry tray"));

  const ungrounded = fresh();
  const ungroundedDump = ungrounded.exportJson();
  ungroundedDump.records.push({
    recordType: "proposal", id: "proposal-ungrounded-merge", type: "duplicate_merge", at: new Date(NOW).toISOString(),
    sourceObservationIds: [], summary: "Unsafe ungrounded merge",
    suggestedOps: [{ type: "merge_belongings", keepId: "black-training-shirt", mergeId: "training-tee" }]
  });
  ungrounded.importJson(ungroundedDump);
  let ungroundedBlocked = false;
  try { ungrounded.acceptProposal("proposal-ungrounded-merge"); } catch { ungroundedBlocked = true; }
  assert("destructive-proposal-requires-inspectable-source", ungroundedBlocked);
});

// =====================================================================
// P0.7 Spatial recall
// =====================================================================
section("P0.7 spatial recall", () => {
  const store = fresh();
  const a = expectOk(store.locate("water bottle"));
  assert("plan-pin-resolves", !!a.planPin && a.planPin.roomId === "bedroom" && a.planPin.x > 2.6 && a.planPin.x < 4.0, a.planPin);
  const packedPin = expectOk(store.locate("winter jacket"));
  assert("plan-pin-for-box", packedPin.planPin?.roomId === "bedroom", packedPin.planPin);
  assert("rooms-have-plan-rects", catalog.rooms.every((r) => r.plan) && catalog.furniture.every((f) => f.plan));
});

// =====================================================================
// P0.8 Persistence and history
// =====================================================================
section("P0.8 persistence and history", () => {
  const storage = memStorage();
  const store1 = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage });
  store1.createBelonging({ name: "Yoga mat", kinds: ["gym-gear"], defaultHome: { type: "container", id: "shelf-middle-basket" } });
  const store2 = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage });
  assert("state-survives-reload", store2.searchBelongings("yoga mat")[0]?.name === "Yoga mat");

  const dump = store2.exportJson();
  assert("export-shape", dump.version === 2 && Array.isArray(dump.records) && dump.records.length > 10);
  const compactExport = store2.exportJsonText();
  const compactParsed = JSON.parse(compactExport) as { version?: number; records?: unknown[] };
  assert("compact-export-is-schema-compatible", compactParsed.version === 2 && compactParsed.records?.length === dump.records.length);
  assert("compact-export-avoids-pretty-print-overhead", !compactExport.includes("\n  "));
  const store3 = fresh();
  store3.importJson(dump);
  assert("import-round-trip", store3.searchBelongings("yoga mat")[0]?.name === "Yoga mat");

  const ledger = store3.commitsView();
  const newest = ledger[0];
  const oldest = ledger[ledger.length - 1];
  assert("ledger-newest-first", !!newest && !!oldest && new Date(newest.at) >= new Date(oldest.at));
  assert("ledger-ops-summaries", ledger.every((c) => Array.isArray(c.ops) && typeof c.summary === "string"));

  const recordsBeforeReset = store3.recordCount;
  store3.reset();
  assert("reset-ledgered", store3.commitsView()[0]?.summary === "Reset home memory to seed");
  assert("reset-back-to-seed", store3.proposals().length === 2 && !store3.searchBelongings("yoga mat").length);
  assert("reset-preserves-append-only-history", store3.recordCount === recordsBeforeReset + 1 && store3.exportJson().records.some((record) => record.recordType === "commit" && record.summary === "Add belonging: Yoga mat"), `${recordsBeforeReset} -> ${store3.recordCount}`);

  const resetStorage = memStorage();
  const resetStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: resetStorage });
  resetStore.reset();
  const resetAnswer = resetStore.locate("water bottle");
  const resetTimestamp = resetAnswer.ok ? resetAnswer.lastUpdatedAt : null;
  const reloadedReset = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW + 100 * 86400000), now: () => NOW + 100 * 86400000, storage: resetStorage });
  const reloadedAnswer = reloadedReset.locate("water bottle");
  assert("reset-baseline-survives-reload-without-time-drift", reloadedAnswer.ok && reloadedAnswer.lastUpdatedAt === resetTimestamp, `${resetTimestamp} -> ${reloadedAnswer.ok ? reloadedAnswer.lastUpdatedAt : "missing"}`);
});

section("P0.8 temporal caches expire at record boundaries", () => {
  let clock = NOW + 30 * 86400000 - 1;
  const store = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => clock, storage: null });
  const before = store.containersView().find((container) => container.id === "desk-top");
  const attentionBefore = store.attention();
  clock += 2;
  const after = store.containersView().find((container) => container.id === "desk-top");
  const attentionAfter = store.attention();
  assert("container-cache-expires-at-exact-age-boundary", before?.daysSinceConfirmed === 30 && after?.daysSinceConfirmed === 31, `${before?.daysSinceConfirmed} -> ${after?.daysSinceConfirmed}`);
  assert("attention-cache-refreshes-at-exact-age-boundary", !attentionBefore.staleContainers.some((container) => container.id === "desk-top") && attentionAfter.staleContainers.some((container) => container.id === "desk-top"));
});

section("P0.8 durability failure semantics", () => {
  const storage: StorageLike = {
    getItem: () => null,
    setItem: () => { throw new Error("simulated quota exhaustion"); }
  };
  const store = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage });
  const beforeRecords = store.exportJson().records.length;
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });

  let failure: Error | null = null;
  try {
    store.createBelonging({
      name: "Write must not ghost",
      defaultHome: { type: "container", id: "entry-tray" }
    });
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  assert("durability-failure-is-visible", failure?.message.includes("simulated quota exhaustion") === true, failure?.message);
  assert("failed-write-does-not-change-projection", store.searchBelongings("write must not ghost").length === 0);
  assert("failed-write-does-not-change-ledger", store.exportJson().records.length === beforeRecords, store.exportJson().records.length);
  assert("failed-write-does-not-notify", notifications === 0, notifications);
});

section("P0.8 corrupt persistence semantics", () => {
  const storage: StorageLike = {
    getItem: () => "{ truncated home memory",
    setItem: () => undefined
  };
  let failure: Error | null = null;
  try {
    createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage });
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  assert("corrupt-storage-fails-closed", /corrupt/i.test(failure?.message ?? ""), failure?.message);
});

section("P0.8 generated baseline validates before use", () => {
  let writes = 0;
  const storage: StorageLike = {
    getItem: () => null,
    setItem: () => { writes += 1; }
  };
  const duplicate = {
    recordType: "evidence" as const,
    id: "duplicate-generated-record",
    at: new Date(NOW).toISOString(),
    kind: "photo_note" as const,
    summary: "Generated baseline evidence"
  };
  let rejected = false;
  try {
    createStore({ catalog, seedFactory: () => [{ ...duplicate }, { ...duplicate }], now: () => NOW, storage });
  } catch (error) {
    rejected = /duplicates/i.test(String(error));
  }
  assert("generated-baseline-duplicates-fail-before-any-write", rejected && writes === 0, `${rejected}/${writes}`);
});

section("P0.8 import validation semantics", () => {
  const store = fresh();
  const before = store.exportJson().records.length;
  let failure: Error | null = null;
  try {
    store.importJson({
      version: 2,
      records: [{ recordType: "evidence", id: "", kind: "photo_note", summary: "", at: "not-a-date" }]
    });
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  assert("malformed-import-is-rejected", /record 1/i.test(failure?.message ?? ""), failure?.message);
  assert("malformed-import-keeps-current-home", store.exportJson().records.length === before, store.exportJson().records.length);

  const dangling = store.exportJson();
  dangling.records.push({
    recordType: "commit",
    id: "commit-dangling-import",
    at: new Date(NOW + 1).toISOString(),
    summary: "Invalid imported placement",
    ops: [{
      type: "create_placement",
      itemId: "water-bottle",
      placeRef: { type: "state", id: "moon" },
      relation: "inside",
      confidence: 0.9
    }]
  });
  let semanticFailure: Error | null = null;
  try { store.importJson(dangling); } catch (error) { semanticFailure = error instanceof Error ? error : new Error(String(error)); }
  assert("dangling-import-is-rejected", /Place Reference/i.test(semanticFailure?.message ?? ""), semanticFailure?.message);
  assert("dangling-import-keeps-current-home", store.recordCount === before, `${before} -> ${store.recordCount}`);

  const malformedRows = store.exportJson();
  malformedRows.records.push({
    recordType: "commit", id: "commit-malformed-rows", at: new Date(NOW + 2).toISOString(), summary: "Malformed operation",
    ops: [{ type: "create_operation", operation: { id: "op-malformed", type: "kit", name: "Malformed", startedAt: new Date(NOW).toISOString(), status: "active", rows: [{}] as never } }]
  });
  let rowFailure = false;
  try { store.importJson(malformedRows); } catch { rowFailure = true; }
  assert("malformed-kit-row-import-is-rejected", rowFailure && store.recordCount === before);

  const resetProposal = store.exportJson();
  resetProposal.records.push({
    recordType: "proposal", id: "proposal-reset", type: "contents_update", at: new Date(NOW + 3).toISOString(),
    sourceObservationIds: [], summary: "Unsafe reset", suggestedOps: [{ type: "reset_to_seed" }]
  });
  let proposalFailure = false;
  try { store.importJson(resetProposal); } catch { proposalFailure = true; }
  assert("proposal-cannot-compose-reset-control-op", proposalFailure && store.recordCount === before);

  const resetBaseline = store.exportJson();
  resetBaseline.baselineRecords?.push({
    recordType: "commit", id: "baseline-reset", at: new Date(NOW + 4).toISOString(), summary: "Invalid baseline reset",
    ops: [{ type: "reset_to_seed" }]
  });
  let baselineResetFailure = false;
  try { store.importJson(resetBaseline); } catch (error) { baselineResetFailure = /baseline.*reset_to_seed/i.test(String(error)); }
  assert("import-baseline-cannot-contain-reset-control-op", baselineResetFailure && store.recordCount === before);

  const oversizedKind = store.exportJson();
  oversizedKind.records.push({
    recordType: "commit", id: "oversized-kind", at: new Date(NOW + 5).toISOString(), summary: "Oversized search input",
    ops: [{
      type: "create_belonging",
      belonging: {
        id: "oversized-kind-item", name: "Oversized kind item", kinds: ["x".repeat(65)], importance: "normal",
        defaultHome: { type: "container", id: "entry-tray" }
      }
    }]
  });
  let oversizedKindFailure = false;
  try { store.importJson(oversizedKind); } catch (error) { oversizedKindFailure = /at most 64 characters/i.test(String(error)); }
  assert("import-bounds-indexed-search-fields", oversizedKindFailure && store.recordCount === before);

  const staleRevision = store.revision;
  const staleDump = store.exportJson();
  store.confirmContainer("entry-tray");
  let conflict = false;
  try { store.importJson(staleDump, staleRevision); } catch (error) { conflict = /conflict/i.test(String(error)); }
  assert("stale-import-revision-cannot-overwrite-acknowledged-write", conflict && store.recordCount > before, `${conflict}; ${before} -> ${store.recordCount}`);
});

// =====================================================================
// Agent answer contract
// =====================================================================
section("agent answer contract", () => {
  const store = fresh();
  const packed = store.locate("winter jacket");
  assert("packed-answer-names-box-and-destination", /packed in .*Essentials/.test(packed.sentence) && /destination: New home/.test(packed.sentence), packed.sentence);
  const laundry = store.locate("small towel");
  assert("laundry-answer-names-default-home", /laundry/.test(laundry.sentence) && /Bathroom/.test(laundry.sentence), laundry.sentence);
  const unknown = store.locate("quantum flux capacitor");
  assert("unknown-admits-no-memory", unknown.ok === false && /no memory/.test(unknown.sentence), unknown.sentence);
  const answered = store.locate("earphones");
  assert("answer-offers-next-action", answered.ok && /not there/i.test(answered.hint));
});

// =====================================================================
// P0.9 First-session onboarding (own home mode)
// =====================================================================
section("P0.9 onboarding (own home)", () => {
  const store = fresh({ catalog: emptyCatalog, seedFactory: () => [] });
  assert("own-boots-empty",
    store.state.rooms.size === 0 && store.state.containers.size === 0 &&
    store.searchBelongings("").length === 0 && store.proposals().length === 0 && store.commitsView().length === 0);
  assert("own-activation-incomplete", store.activation().complete === false);

  let boxThrew = false;
  try { store.createBox({ label: "No rooms yet" }); } catch { boxThrew = true; }
  assert("box-requires-room", boxThrew);

  const roomId = store.createRoom({ name: "Bedroom" });
  assert("create-room-ledgered", store.commitsView()[0]?.ops[0]?.type === "create_room");
  const room = store.state.rooms.get(roomId);
  assert("room-plan-auto-assigned", !!room && room.plan.w > 0 && room.plan.h > 0, room?.plan);

  const room2 = store.createRoom({ name: "Bedroom" });
  assert("room-id-uniqueness", room2 !== roomId && store.state.rooms.size === 2, `${roomId} vs ${room2}`);
  const plans = [...store.state.rooms.values()].map((r) => r.plan);
  const overlap = plans.length === 2 && plans[0] && plans[1] &&
    plans[0].x < plans[1].x + plans[1].w && plans[1].x < plans[0].x + plans[0].w &&
    plans[0].y < plans[1].y + plans[1].h && plans[1].y < plans[0].y + plans[0].h;
  assert("room-plan-slots-do-not-overlap", overlap === false, plans);

  const shelfId = store.createContainer({ name: "Closet shelf", kind: "shelf", roomId });
  assert("container-under-room-chain", store.chainText(store.chainFor({ type: "container", id: shelfId })) === "Closet shelf · Bedroom");

  let containerThrew = false;
  try { store.createContainer({ name: "X", kind: "shelf", roomId: "no-such-room" }); } catch { containerThrew = true; }
  assert("container-requires-room", containerThrew);

  for (let i = 1; i <= 10; i += 1) {
    store.createBelonging({ name: `Own item ${i}`, kinds: i === 1 ? ["charger"] : ["misc"], defaultHome: { type: "container", id: shelfId } });
  }
  const mid = store.activation();
  assert("activation-counts", mid.rooms === 2 && mid.containers === 1 && mid.belongings === 10 && mid.operations === 0 && !mid.complete, mid);

  const boxId = store.createBox({ label: "First box", destination: "New place" });
  assert("box-before-full-home", store.state.containers.get(boxId)?.parent.id === roomId);

  store.startOperation("move");
  assert("activation-complete", store.activation().complete === true);
  // 2 rooms + 1 container + 10 belongings + 1 box + 1 operation = 15 ordinary commits.
  assert("onboarding-all-ledgered", store.commitsView().length === 15, `${store.commitsView().length} commits`);

  const found = store.locate("own item 1");
  assert("own-locate-works", found.ok && found.chainText === "Closet shelf · Bedroom", found.sentence);
});

// =====================================================================
// Photo snapshot evidence (P0.2 v1.1)
// =====================================================================
section("photo snapshot evidence", () => {
  const store = fresh();
  const photo = { dataUrl: "data:image/jpeg;base64,dGVzdA==", width: 2, height: 2 };
  const pid = store.snapshotContainer("entry-tray", "usb-c charger", photo);

  const obs = store.state.observations.find((o) => o.type === "container_snapshot" && o.containerId === "entry-tray" && o.photo);
  assert("snapshot-observation-carries-photo", obs?.photo?.dataUrl === photo.dataUrl);

  const ev = [...store.state.evidence.values()].find((e) => e.kind === "photo_note" && e.media);
  assert("photo-evidence-record", ev?.media?.dataUrl === photo.dataUrl);

  const proposal = store.proposals().find((p) => p.id === pid);
  const placeOp = proposal?.suggestedOps.find((o) => o.type === "create_placement");
  assert("suggested-placement-cites-snapshot",
    placeOp?.type === "create_placement" && !!ev && (placeOp.evidenceIds ?? []).includes(ev.id));

  const before = store.belongingView("usb-c-charger")?.chainText;
  assert("photo-never-auto-writes", before?.includes("Desk drawer") === true, before);

  store.acceptProposal(pid);
  const answer = store.locate("usb-c charger");
  assert("accepted-placement-cites-photo",
    answer.ok && answer.evidence.some((e) => e.kind === "photo_note" && e.media?.dataUrl === photo.dataUrl),
    answer.ok ? answer.evidence.map((e) => e.kind).join(",") : answer.sentence);

  const textPid = store.snapshotContainer("desk-drawer", "travel adapter");
  assert("text-snapshot-still-works", store.proposals().some((p) => p.id === textPid));
});

// =====================================================================
// Retrieval plan grouped by pickup stop (P0.4 v1.1)
// =====================================================================
section("retrieval plan", () => {
  const store = fresh();
  const gymId = store.startOperation("gym");
  const plan = store.retrievalPlan(gymId);
  assert("plan-has-groups", plan.length >= 3, plan.map((g) => g.label).join(" | "));

  const wardrobe = plan.find((g) => g.key === "furniture:wardrobe");
  assert("wardrobe-stop-groups-clothing", !!wardrobe && wardrobe.items.length >= 3, wardrobe?.items.map((i) => i.name).join(","));

  const bathroom = plan.find((g) => g.label.includes("Bathroom shelf"));
  assert("bathroom-stop-has-towel", !!bathroom && bathroom.items.some((i) => i.name === "Large towel"));

  assert("resolved-kit-has-no-review-group", !plan.some((g) => g.needsReview));
  const totalPlanned = plan.reduce((sum, g) => sum + g.items.length, 0);
  const gym = expectKit(store, gymId);
  assert("plan-covers-every-row", totalPlanned === gym.rows.length, `${totalPlanned} vs ${gym.rows.length}`);

  const store2 = fresh();
  store2.setItemState("gym-card", "missing");
  const plan2 = store2.retrievalPlan(store2.startOperation("gym"));
  const review = plan2.find((g) => g.needsReview);
  assert("unresolved-groups-under-needs-review", !!review && review.items.some((i) => i.name.includes("Gym card")), review?.items.map((i) => i.name).join(","));
  assert("needs-review-sorts-last", plan2[plan2.length - 1]?.needsReview === true);

  const moveOp = store2.operationsView().find((o) => o.type === "move");
  assert("move-op-has-no-retrieval-plan", !!moveOp && store2.retrievalPlan(moveOp.id).length === 0);
});

// =====================================================================
// Agent toolkit (handoff §19 Next 3 groundwork)
// =====================================================================
section("agent toolkit", () => {
  const store = fresh();
  const toolkit = createAgentToolkit(store);
  assert("toolkit-descriptors",
    toolkit.tools.length >= 12 && toolkit.tools.every((t) => !!t.name && !!t.description && t.parameters.type === "object"),
    `${toolkit.tools.length} tools`);

  const answer = toolkit.dispatch("locate_item", { query: "water bottle" }) as LocateAnswer;
  assert("tool-locate", answer.ok && answer.chainText.includes("Desk top"), answer.sentence);

  const mediaStore = fresh();
  const mediaToolkit = createAgentToolkit(mediaStore);
  const photoProposal = mediaStore.snapshotContainer("entry-tray", "usb-c charger", {
    dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    width: 1,
    height: 1
  });
  mediaStore.acceptProposal(photoProposal);
  const agentPhotoAnswer = mediaToolkit.dispatch("locate_item", { query: "usb-c charger" }) as LocateAnswer;
  assert("tool-locate-omits-sensitive-media", agentPhotoAnswer.ok && agentPhotoAnswer.evidence.length > 0 && agentPhotoAnswer.evidence.every((e) => !("media" in e)));

  const pendingBefore = store.proposals().length;
  const snap = toolkit.dispatch("snapshot_container", { container_id: "entry-tray", seen_text: "usb-c charger" }) as { proposalId: string };
  assert("tool-snapshot-proposal-only",
    typeof snap.proposalId === "string" &&
    store.proposals().length === pendingBefore + 1 &&
    store.belongingView("usb-c-charger")?.chainText.includes("Desk drawer") === true);

  toolkit.dispatch("mark_not_there", { item_id: "water-bottle" });
  assert("tool-not-there-opens-proposal", store.proposals().length === pendingBefore + 2);

  let unknownThrew = false;
  try { toolkit.dispatch("no_such_tool", {}); } catch { unknownThrew = true; }
  assert("tool-unknown-rejected", unknownThrew);

  let missingArg = false;
  try { toolkit.dispatch("locate_item", {}); } catch { missingArg = true; }
  assert("tool-missing-arg-rejected", missingArg);

  const correction = store.proposals().find((p) => p.needsPlace);
  if (!correction) throw new Error("expected a correction proposal");
  toolkit.dispatch("accept_proposal", { proposal_id: correction.id, place_container_id: "backpack" });
  assert("tool-accept-with-place", store.belongingView("water-bottle")?.chainText.includes("Backpack") === true);

  const planOut = toolkit.dispatch("retrieval_plan", { operation_id: store.startOperation("gym") }) as unknown[];
  assert("tool-retrieval-plan", Array.isArray(planOut) && planOut.length >= 3);
});

// =====================================================================
// Agent runtime: tool-calling loop with injected (mock) LLMs
// =====================================================================
setSection("agent runtime");
try {
  const scripted = (replies: LlmReply[]): LlmFn => {
    let i = 0;
    return async () => {
      const reply = replies[Math.min(i, replies.length - 1)];
      i += 1;
      return reply ?? { stopReason: "end_turn", content: [] };
    };
  };

  {
    const store = fresh();
    const toolkit = createAgentToolkit(store);
    const llm = scripted([
      { stopReason: "tool_use", content: [{ type: "text", text: "Let me check." }, { type: "tool_use", id: "t1", name: "locate_item", input: { query: "water bottle" } }] },
      { stopReason: "end_turn", content: [{ type: "text", text: "Your water bottle is probably on the desk." }] }
    ]);
    const turn = await runAgentTurn({ toolkit, llm, userText: "where is my water bottle?" });
    assert("runtime-executes-tool", turn.events.some((e) => e.kind === "tool_call" && e.name === "locate_item" && !e.isError && e.result.includes("Desk top")));
    assert("runtime-final-text", turn.finalText.includes("desk"), turn.finalText);
    assert("runtime-history-shape",
      turn.history.length === 4 && turn.history[1]?.role === "assistant" && turn.history[2]?.role === "user" && turn.history[2]?.content[0]?.type === "tool_result",
      turn.history.map((m) => m.role).join(","));
    assert("runtime-rounds-counted", turn.toolRoundsUsed === 1);
  }

  {
    const store = fresh();
    const toolkit = createAgentToolkit(store);
    const target = store.proposals()[0];
    if (!target) throw new Error("expected a seed proposal");
    const decisionReplies = (): LlmReply[] => ([
      { stopReason: "tool_use", content: [{ type: "tool_use", id: "d1", name: "accept_proposal", input: { proposal_id: target.id } }] },
      { stopReason: "end_turn", content: [{ type: "text", text: "Done or blocked — see above." }] }
    ]);
    const guarded = await runAgentTurn({ toolkit, llm: scripted(decisionReplies()), userText: "accept the gym card proposal" });
    assert("runtime-blocks-decision-tools", guarded.events.some((e) => e.kind === "tool_call" && e.isError && e.result.includes("Blocked")));
    assert("runtime-decision-not-applied", store.proposals().length === 2 && store.proposals()[0]?.status === "pending");

    const allowed = await runAgentTurn({
      toolkit,
      llm: scripted(decisionReplies()),
      userText: "yes, accept it",
      decisionGrant: { toolName: "accept_proposal", proposalId: target.id }
    });
    assert("runtime-decision-allowed-explicitly", allowed.events.some((e) => e.kind === "tool_call" && !e.isError) && store.proposals().length === 1);
  }

  {
    const store = fresh();
    const toolkit = createAgentToolkit(store);
    const granted = store.proposals().find((proposal) => proposal.type === "duplicate_merge");
    const ungranted = store.proposals().find((proposal) => proposal.type === "placement_correction");
    if (!granted || !ungranted) throw new Error("expected two distinct seed proposals");
    const turn = await runAgentTurn({
      toolkit,
      llm: scripted([
        { stopReason: "tool_use", content: [
          { type: "tool_use", id: "grant-1", name: "accept_proposal", input: { proposal_id: granted.id } },
          { type: "tool_use", id: "grant-2", name: "accept_proposal", input: { proposal_id: ungranted.id, place_container_id: "entry-tray" } }
        ] },
        { stopReason: "end_turn", content: [{ type: "text", text: "Handled only the granted decision." }] }
      ]),
      userText: "accept only the duplicate merge",
      decisionGrant: { toolName: "accept_proposal", proposalId: granted.id }
    });
    const allowedEvents = turn.events.filter((event) => event.kind === "tool_call" && !event.isError);
    const blockedEvents = turn.events.filter((event) => event.kind === "tool_call" && event.isError);
    assert("runtime-decision-grant-is-resource-scoped", allowedEvents.length === 1 && blockedEvents.length === 1 && store.proposals().some((proposal) => proposal.id === ungranted.id));
  }

  {
    const store = fresh();
    const toolkit = createAgentToolkit(store);
    const llmLoop: LlmFn = async () => ({ stopReason: "tool_use", content: [{ type: "tool_use", id: "x", name: "list_attention", input: {} }] });
    const capped = await runAgentTurn({ toolkit, llm: llmLoop, userText: "loop forever", maxToolRounds: 2 });
    assert("runtime-round-budget", capped.toolRoundsUsed === 2 && capped.finalText.includes("stopped after 2 tool rounds"), capped.finalText);

    const badTool = scripted([
      { stopReason: "tool_use", content: [{ type: "tool_use", id: "b1", name: "no_such_tool", input: {} }] },
      { stopReason: "end_turn", content: [{ type: "text", text: "That tool does not exist." }] }
    ]);
    const errored = await runAgentTurn({ toolkit, llm: badTool, userText: "call a fake tool" });
    assert("runtime-surfaces-tool-errors", errored.events.some((e) => e.kind === "tool_call" && e.isError && e.result.includes("Unknown tool")));
  }

  {
    const largeToolkit: AgentToolkit = {
      tools: [{
        name: "large_result",
        description: "Return a deliberately large result for the public runtime boundary.",
        parameters: { type: "object", properties: {}, required: [] }
      }],
      dispatch: () => ({ rows: Array.from({ length: 500 }, (_, index) => ({ index, note: "x".repeat(200) })) })
    };
    const turn = await runAgentTurn({
      toolkit: largeToolkit,
      llm: scripted([
        { stopReason: "tool_use", content: [{ type: "tool_use", id: "large-1", name: "large_result", input: {} }] },
        { stopReason: "end_turn", content: [{ type: "text", text: "Summarized." }] }
      ]),
      userText: "return the large result"
    });
    const event = turn.events.find((candidate) => candidate.kind === "tool_call" && candidate.name === "large_result");
    const result = event?.kind === "tool_call" ? event.result : "";
    let parses = false;
    try { JSON.parse(result); parses = true; } catch { /* assertion below */ }
    assert("runtime-large-results-remain-bounded-json", !!event && result.length <= 4_000 && parses, result.slice(-80));
  }

  {
    let dispatches = 0;
    const boundedToolkit: AgentToolkit = {
      tools: [{ name: "bounded", description: "Count bounded calls.", parameters: { type: "object", properties: {}, required: [] } }],
      dispatch: () => { dispatches += 1; return { ok: true }; }
    };
    const uses = Array.from({ length: 12 }, (_, index) => ({ type: "tool_use" as const, id: `bounded-${index}`, name: "bounded", input: {} }));
    const turn = await runAgentTurn({
      toolkit: boundedToolkit,
      llm: scripted([
        { stopReason: "tool_use", content: uses },
        { stopReason: "end_turn", content: [{ type: "text", text: "Bounded." }] }
      ]),
      userText: "try too many tools",
      maxToolCallsPerRound: 3,
      maxToolCallsPerTurn: 3
    });
    assert("runtime-tool-call-backpressure-bounds-dispatch", dispatches === 3 && turn.events.filter((event) => event.kind === "tool_call" && event.isError).length === 9, `${dispatches} dispatched`);

    const throwingToolkit: AgentToolkit = {
      tools: [{ name: "throwing", description: "Throw a large error.", parameters: { type: "object", properties: {}, required: [] } }],
      dispatch: () => { throw new Error("x".repeat(10_000)); }
    };
    const errored = await runAgentTurn({
      toolkit: throwingToolkit,
      llm: scripted([
        { stopReason: "tool_use", content: [{ type: "tool_use", id: "throw-1", name: "throwing", input: {} }] },
        { stopReason: "end_turn", content: [{ type: "text", text: "Handled." }] }
      ]),
      userText: "throw"
    });
    const errorEvent = errored.events.find((event) => event.kind === "tool_call");
    assert("runtime-tool-errors-use-bounded-json", errorEvent?.kind === "tool_call" && errorEvent.result.length <= 4_000 && JSON.parse(errorEvent.result), errorEvent?.kind === "tool_call" ? errorEvent.result.length : "missing");
  }

  {
    const store = fresh();
    const toolkit = createAgentToolkit(store);
    const slowLlm: LlmFn = (request) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ stopReason: "end_turn", content: [{ type: "text", text: "too late" }] }), 250);
      request.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(request.signal?.reason ?? new Error("aborted"));
      }, { once: true });
    });
    const started = performance.now();
    let failure: Error | null = null;
    try {
      await runAgentTurn({ toolkit, llm: slowLlm, userText: "do not hang", timeoutMs: 20 });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
    assert("runtime-llm-call-has-deadline", /timed out/i.test(failure?.message ?? "") && performance.now() - started < 150, `${failure?.message ?? "no error"}; ${performance.now() - started}ms`);
  }
} catch (err) {
  failures += 1;
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  results.push({ section: "agent runtime", id: "section-crashed", ok: false, detail });
  console.error(`  ✗ section crashed — ${detail}`);
}

// =====================================================================
// Ask router: deterministic conversational surface (PRD §6 v1.2)
// =====================================================================
section("ask router", () => {
  const store = fresh();
  const toolkit = createAgentToolkit(store);

  const locate = ask(store, toolkit, "Where is my water bottle?");
  assert("ask-locate-intent", locate.intent === "locate" && locate.toolCalls[0]?.name === "locate_item" && locate.answer?.ok === true && locate.text.includes("Desk top"), locate.text);

  const which = ask(store, toolkit, "Which box has the winter jacket?");
  assert("ask-which-box", which.intent === "which_container" && which.hits?.[0]?.container.id === "box-essentials", which.text);

  // Owned item not in any container → never "no record"; disclose its real place.
  // Water bottle lives on the desk top (a surface, not a box).
  const whichOwned = ask(store, toolkit, "Which box has the water bottle?");
  assert("ask-which-box-owned-not-in-box-is-honest",
    whichOwned.intent === "which_container"
    && !/no (container )?record|no memory of owning/i.test(whichOwned.text)
    && /isn't packed in a box|not.*in a box|Desk top/i.test(whichOwned.text), whichOwned.text);
  // Truly-unknown item → honest "no record" that admits both no-box AND no-memory.
  const whichUnknown = ask(store, toolkit, "Which box has the quantum flux capacitor?");
  assert("ask-which-box-unknown-stays-honest",
    whichUnknown.intent === "which_container" && /no memory of owning/i.test(whichUnknown.text), whichUnknown.text);

  const contents = ask(store, toolkit, "What's in the entry tray?");
  assert("ask-container-contents", contents.intent === "container_contents" && !!contents.contents, contents.text);

  const kit = ask(store, toolkit, "Prepare my gym kit");
  assert("ask-kit-starts-operation", kit.intent === "kit" && !!kit.operationId && (kit.plan?.length ?? 0) >= 3 && store.operationsView().some((o) => o.type === "kit"), kit.text);

  const unpack = ask(store, toolkit, "What should I unpack first?");
  assert("ask-unpack-priority", unpack.intent === "unpack" && (unpack.priority?.length ?? 0) >= 2, unpack.text);

  const attention = ask(store, toolkit, "What needs attention?");
  assert("ask-attention", attention.intent === "attention" && attention.text.includes("proposal"), attention.text);

  const unknown = ask(store, toolkit, "Where is my quantum flux capacitor?");
  assert("ask-unknown-admits", unknown.intent === "locate" && unknown.answer?.ok === false && /no memory/.test(unknown.text), unknown.text);

  // Ownership / pre-purchase recall — the durable retention loop.
  const own = ask(store, toolkit, "Do I already have a water bottle?");
  assert("ask-ownership-intent", own.intent === "ownership" && own.toolCalls[0]?.name === "ownership_recall" && own.ownership?.verdict === "own_available" && (own.ownership?.ownedCount ?? 0) >= 1, own.text);
  const buy = ask(store, toolkit, "Should I buy another quantum flux capacitor?");
  assert("ask-ownership-none-is-honest", buy.intent === "ownership" && buy.ownership?.verdict === "none" && /no memory/i.test(buy.text) && (buy.ownership?.matches.length ?? 1) === 0, buy.text);
  const stillLocate = ask(store, toolkit, "Where is my water bottle?");
  assert("ask-ownership-does-not-hijack-locate", stillLocate.intent === "locate", stillLocate.intent);

  const declutter = ask(store, toolkit, "What can I declutter?");
  assert("ask-declutter-intent", declutter.intent === "declutter" && declutter.toolCalls[0]?.name === "declutter_review" && (declutter.declutter?.candidates.length ?? 0) >= 1, declutter.text);

  // Home Capability (Ready) routing — activity intents reach home_capability.
  const cap = ask(store, toolkit, "Can I work out at home?");
  assert("ask-capability-intent", cap.intent === "capability" && cap.toolCalls[0]?.name === "home_capability" && cap.capability?.matched === true, cap.text);
  const capBare = ask(store, toolkit, "going camping this weekend");
  assert("ask-capability-bare-activity", capBare.intent === "capability" && capBare.capability?.profileId === "camping-outdoors", capBare.text);
  const stillKit = ask(store, toolkit, "prepare my gym kit");
  assert("ask-capability-does-not-hijack-kit", stillKit.intent === "kit", stillKit.intent);
  const stillLocate2 = ask(store, toolkit, "where is my water bottle?");
  assert("ask-capability-does-not-hijack-locate", stillLocate2.intent === "locate", stillLocate2.intent);

  const help = ask(store, toolkit, "???");
  assert("ask-help-fallback", help.intent === "help" && help.toolCalls.length === 0);
});

section("ownership recall (durable loop)", () => {
  const store = fresh();
  const owned = store.ownershipRecall("water bottle");
  assert("ownership-owned-cites-place-and-confidence",
    owned.ok && owned.verdict === "own_available" && owned.ownedCount >= 1
    && owned.matches[0]?.exact === true && owned.matches[0]?.placeKnown === true
    && owned.matches[0]!.confidence > 0 && /reuse/i.test(owned.sentence), owned.sentence);
  const none = store.ownershipRecall("quantum flux capacitor");
  assert("ownership-none-stays-honest",
    none.ok && none.verdict === "none" && none.ownedCount === 0 && none.matches.length === 0
    && /only speak to what/i.test(none.sentence), none.sentence);
  // gone items (consumed/retired) are not "owned"; a lent/laundry item is owned-but-unavailable.
  const lent = fresh();
  const jacketId = lent.searchBelongings("winter jacket")[0]?.id;
  if (jacketId) lent.setItemState(jacketId, "lent_out");
  const afterLent = lent.ownershipRecall("winter jacket");
  assert("ownership-unavailable-is-flagged",
    afterLent.ok && afterLent.matches.some((m) => m.item.toLowerCase().includes("jacket") && !m.available), afterLent.sentence);
  // agent tool exposes it and strips nothing sensitive (no media field on ownership).
  const tk = createAgentToolkit(store);
  const viaTool = tk.dispatch("ownership_recall", { query: "water bottle" }) as { ok: boolean; verdict: string };
  assert("ownership-tool-dispatches", viaTool.ok === true && viaTool.verdict === "own_available", JSON.stringify(viaTool).slice(0, 80));
});

section("declutter review (release)", () => {
  const store = fresh();
  const r = store.declutterReview();
  assert("declutter-surfaces-duplicates",
    r.ok && r.groups.some((g) => g.reason === "duplicate_kind")
    && r.candidates.some((c) => c.reason === "duplicate_kind" && c.duplicateOf.length >= 1), r.sentence);
  assert("declutter-every-candidate-has-observed-reason",
    r.candidates.length > 0 && r.candidates.every((c) => c.because.length > 0 && !/unused|don'?t use/i.test(c.because)), `n=${r.candidates.length}`);
  assert("declutter-essentials-never-offered-for-disposal",
    r.candidates.filter((c) => c.importance === "essential").every((c) => !c.options.includes("discard") && !c.options.includes("sell")), "essential got a disposal option");
  assert("declutter-is-decision-support-not-disposal",
    /you decide/i.test(r.sentence) && /never|no item|not/i.test(r.note), r.note);
  // read-only: calling it changes nothing about the graph.
  const before = store.searchBelongings("").length;
  store.declutterReview();
  assert("declutter-is-read-only", store.searchBelongings("").length === before);
  const tk = createAgentToolkit(store);
  const viaTool = tk.dispatch("declutter_review", {}) as { ok: boolean; candidates: unknown[] };
  assert("declutter-tool-dispatches", viaTool.ok === true && Array.isArray(viaTool.candidates), JSON.stringify(viaTool).slice(0, 60));
});

section("home capability (ready loop)", () => {
  // --- integration over the REAL seed catalog: honest mixed results ---
  const store = fresh();

  // home-workout: sports clothing + towel + water are owned, but the yoga mat is a
  // genuine gap → not_ready, and the gap is phrased as "no memory of owning", not
  // "you don't have one".
  const workout = store.homeCapability("can I work out at home?");
  assert("capability-matches-profile", workout.matched && workout.profileId === "home-workout" && workout.label === "Home workout", `${workout.profileId}`);
  assert("capability-not-ready-when-required-missing",
    workout.verdict === "not_ready" && workout.gaps.requiredMissing.some((g) => g.needId === "need-workout-mat"), workout.sentence);
  assert("capability-missing-is-honest-no-memory",
    /no memory of owning/i.test(workout.sentence) && !/you don't have|you do not have/i.test(workout.sentence), workout.sentence);
  assert("capability-have-needs-cite-place-and-confidence",
    workout.needs.some((n) => n.needId === "need-water" && n.status === "have_available" && n.placeKnown && (n.confidence ?? 0) > 0), "water need should be a placed have");
  assert("capability-stops-grouped-by-place",
    workout.stops.length > 0 && workout.stops.every((s) => s.items.length > 0 && typeof s.label === "string"), `${workout.stops.length} stops`);
  assert("capability-blank-usage-never-makes-missing",
    // every missing need is missing purely for lack of a belonging of its kinds — no usage signal exists in the model at all.
    workout.gaps.requiredMissing.concat(workout.gaps.optionalMissing).every((g) => g.because.length > 0), "gaps carry the profile reason");

  // camping: jacket is owned but PACKED (have_unavailable), tent + sleeping bag are
  // real gaps. Owned-but-not-handy must never be counted as missing.
  const camping = store.homeCapability("am I ready to go camping?");
  assert("capability-owned-unavailable-not-counted-missing",
    camping.notHandy.some((n) => n.itemId === "winter-jacket" && n.state === "packed")
    && !camping.gaps.requiredMissing.some((g) => g.kindsAny.includes("jacket")), camping.sentence);
  assert("capability-camping-not-ready-lists-shelter-gaps",
    camping.verdict === "not_ready" && camping.gaps.requiredMissing.some((g) => g.needId === "need-tent") && camping.gaps.requiredMissing.some((g) => g.needId === "need-sleeping-bag"), camping.sentence);

  // Unrecognized intent → honest "no profile", never a fabricated verdict.
  const unknown = store.homeCapability("can I perform open-heart surgery at home?");
  assert("capability-unknown-intent-is-honest",
    !unknown.matched && unknown.verdict === "unknown" && unknown.needs.length === 0
    && /won't guess|can't tell you what/i.test(unknown.sentence) && unknown.suggestions.length > 0, unknown.sentence);

  // Pure READ: calling it changes neither revision nor record count nor operations.
  const revBefore = store.revision; const recBefore = store.recordCount; const opsBefore = store.operationsView().length;
  store.homeCapability("home workout"); store.homeCapability("camping"); store.homeCapability("nonsense intent xyz");
  assert("capability-is-pure-read",
    store.revision === revBefore && store.recordCount === recBefore && store.operationsView().length === opsBefore,
    `${revBefore}->${store.revision}, ${recBefore}->${store.recordCount}, ops ${opsBefore}->${store.operationsView().length}`);

  const tk = createAgentToolkit(store);
  const viaTool = tk.dispatch("home_capability", { intent: "work out at home" }) as { ok: boolean; matched: boolean; verdict: string };
  assert("capability-tool-dispatches", viaTool.ok === true && viaTool.matched === true && typeof viaTool.verdict === "string", JSON.stringify(viaTool).slice(0, 80));
});

section("home capability verdict edges", () => {
  // Purpose-built stores isolate each verdict edge the design's adversarial review
  // flagged. Runtime-built inventory exercises the SAME matcher as the seed path.
  const build = (profiles: CapabilityProfile[]): { store: Store; setClock: (t: number) => void } => {
    let clock = NOW;
    const cat: Catalog = { rooms: [], furniture: [], containers: [], belongings: [], kits: [], operationTemplates: [], capabilityProfiles: profiles };
    const store = createStore({ catalog: cat, seedFactory: () => [], now: () => clock, storage: null });
    return { store, setClock: (t) => { clock = t; } };
  };
  const req = (id: string, kindsAny: string[]) => ({ id, label: id, kindsAny, level: "required" as const, because: `need ${id}` });
  const opt = (id: string, kindsAny: string[]) => ({ id, label: id, kindsAny, level: "optional" as const, because: `nice ${id}` });

  // READY (all required have_available). Also verifies place-unknown stays a have.
  {
    const { store } = build([{ id: "p", label: "do the thing", triggers: ["do the thing"], needs: [req("n-water", ["water-bottle"])] }]);
    const roomId = store.createRoom({ name: "Room" });
    const contId = store.createContainer({ name: "Shelf", kind: "shelf", roomId });
    store.createBelonging({ name: "My bottle", kinds: ["water-bottle"], defaultHome: { type: "container", id: contId }, currentPlace: { type: "container", id: contId } });
    const r = store.homeCapability("do the thing");
    assert("capability-ready-when-all-required-available",
      r.verdict === "ready" && r.requiredHave === 1 && r.requiredTotal === 1 && /all 1 essential is covered/i.test(r.sentence), r.sentence);
  }
  // READY with place-unknown required have → still ready, but honesty clause names it.
  // A catalog belonging with NO placement record is owned-but-place-unknown by
  // construction (active placement null, state defaults to at_home = available).
  {
    const clock = NOW;
    const cat: Catalog = {
      rooms: [], furniture: [], containers: [],
      belongings: [{ id: "bottle", name: "Bottle", kinds: ["water-bottle"], importance: "normal", defaultHome: { type: "room", id: "nowhere" } }],
      kits: [], operationTemplates: [],
      capabilityProfiles: [{ id: "p", label: "do the thing", triggers: ["do the thing"], needs: [req("n-water", ["water-bottle"])] }]
    };
    const store = createStore({ catalog: cat, seedFactory: () => [], now: () => clock, storage: null });
    const r = store.homeCapability("do the thing");
    assert("capability-ready-place-unknown-stays-have-and-is-disclosed",
      r.verdict === "ready" && r.needs[0]?.status === "have_available" && r.needs[0]?.placeKnown === false
      && /place not confirmed/i.test(r.sentence), `${r.needs[0]?.status}/${r.needs[0]?.placeKnown}: ${r.sentence}`);
  }
  // ALMOST (required owned but not to hand).
  {
    const { store } = build([{ id: "p", label: "do the thing", triggers: ["do the thing"], needs: [req("n-towel", ["towel"])] }]);
    const roomId = store.createRoom({ name: "Room" });
    const contId = store.createContainer({ name: "Basket", kind: "basket", roomId });
    const id = store.createBelonging({ name: "Towel", kinds: ["towel"], defaultHome: { type: "container", id: contId }, currentPlace: { type: "container", id: contId } });
    store.setItemState(id, "laundry");
    const r = store.homeCapability("do the thing");
    assert("capability-almost-when-required-not-handy",
      r.verdict === "almost" && r.notHandy.some((n) => n.itemId === id) && /laundry/i.test(r.sentence) && !/no memory/i.test(r.sentence), r.sentence);
  }
  // SUBSTITUTE covering a required need → ready, but the stand-in is disclosed (never a flat "covered").
  {
    const { store } = build([{ id: "p", label: "do the thing", triggers: ["do the thing"], needs: [req("n-shirt", ["training-shirt", "clothing"])] }]);
    const roomId = store.createRoom({ name: "Room" });
    const contId = store.createContainer({ name: "Drawer", kind: "drawer", roomId });
    // owns a generic "clothing" item but no "training-shirt" → substitute via fallback kind.
    store.createBelonging({ name: "Winter jacket", kinds: ["jacket", "clothing"], defaultHome: { type: "container", id: contId }, currentPlace: { type: "container", id: contId } });
    const r = store.homeCapability("do the thing");
    assert("capability-substitute-covers-but-is-disclosed",
      r.verdict === "ready" && r.substituteInUse && r.needs[0]?.status === "substitute" && r.needs[0]?.exact === false
      && /using .*for/i.test(r.sentence), r.sentence);
  }
  // requiredTotal === 0 → never a vacuous "ready".
  {
    const { store } = build([{ id: "p", label: "do the thing", triggers: ["do the thing"], needs: [opt("n-water", ["water-bottle"])] }]);
    const r = store.homeCapability("do the thing");
    assert("capability-zero-required-is-never-vacuous-ready",
      r.verdict !== "ready" && r.requiredTotal === 0 && !/all 0 essentials are covered/i.test(r.sentence), r.sentence);
  }
  // STALE required have → still ready, but the sentence flags reconfirming.
  {
    const { store, setClock } = build([{ id: "p", label: "do the thing", triggers: ["do the thing"], needs: [req("n-water", ["water-bottle"])] }]);
    const roomId = store.createRoom({ name: "Room" });
    const contId = store.createContainer({ name: "Shelf", kind: "shelf", roomId });
    store.createBelonging({ name: "Bottle", kinds: ["water-bottle"], defaultHome: { type: "container", id: contId }, currentPlace: { type: "container", id: contId } });
    setClock(NOW + 45 * 86400000);            // placement is now 45 days old
    const r = store.homeCapability("do the thing");
    assert("capability-ready-flags-stale-record",
      r.verdict === "ready" && r.stale && /reconfirm/i.test(r.sentence), r.sentence);
  }
  // not_ready with a coexisting not-handy required → must NOT claim "everything else covered".
  {
    const { store } = build([{ id: "p", label: "do the thing", triggers: ["do the thing"], needs: [req("n-tent", ["tent"]), req("n-towel", ["towel"])] }]);
    const roomId = store.createRoom({ name: "Room" });
    const contId = store.createContainer({ name: "Basket", kind: "basket", roomId });
    const towelId = store.createBelonging({ name: "Towel", kinds: ["towel"], defaultHome: { type: "container", id: contId }, currentPlace: { type: "container", id: contId } });
    store.setItemState(towelId, "lent_out");   // owned but not handy
    const r = store.homeCapability("do the thing");
    assert("capability-not-ready-does-not-falsely-claim-rest-covered",
      r.verdict === "not_ready" && /lent out/i.test(r.sentence) && !/everything else essential is covered/i.test(r.sentence), r.sentence);
  }
  // Fragment intent must NOT force-match a profile (honesty: no fabricated verdict).
  {
    const { store } = build([{ id: "p", label: "home workout", triggers: ["home workout", "work out at home"], needs: [req("n-mat", ["yoga-mat"])] }]);
    const frag = store.homeCapability("work");     // substring of a trigger — must not match
    assert("capability-fragment-intent-does-not-force-match",
      !frag.matched && frag.verdict === "unknown" && /won't guess/i.test(frag.sentence), frag.sentence);
    const full = store.homeCapability("can I work out at home today?"); // contains a full trigger
    assert("capability-full-phrase-still-matches", full.matched && full.profileId === "p", full.sentence);
  }
  // Two needs sharing a kind must NOT both be covered by the SAME lone item.
  {
    const { store } = build([{ id: "p", label: "do the thing", triggers: ["do the thing"], needs: [req("n-a", ["towel"]), req("n-b", ["towel"])] }]);
    const roomId = store.createRoom({ name: "Room" });
    const contId = store.createContainer({ name: "Basket", kind: "basket", roomId });
    store.createBelonging({ name: "Only towel", kinds: ["towel"], defaultHome: { type: "container", id: contId }, currentPlace: { type: "container", id: contId } });
    const r = store.homeCapability("do the thing");
    const covered = r.needs.filter((n) => n.status === "have_available" || n.status === "substitute");
    assert("capability-shared-item-not-double-counted",
      covered.length === 1 && r.gaps.requiredMissing.length === 1 && r.verdict === "not_ready", `covered=${covered.length} verdict=${r.verdict}`);
  }
  // "Show on map" must pin the EXACT clicked belonging, not a fuzzy same-named one.
  // Two "Charger"s in different rooms: locateById resolves each to its own place,
  // whereas a name-based locate can only ever return one of them.
  {
    const { store } = build([]);
    const a = store.createRoom({ name: "Study" });
    const b = store.createRoom({ name: "Kitchen" });
    const ca = store.createContainer({ name: "Study drawer", kind: "drawer", roomId: a });
    const cb = store.createContainer({ name: "Kitchen drawer", kind: "drawer", roomId: b });
    const id1 = store.createBelonging({ name: "Charger", kinds: ["charger"], defaultHome: { type: "container", id: ca }, currentPlace: { type: "container", id: ca } });
    const id2 = store.createBelonging({ name: "Charger", kinds: ["charger"], defaultHome: { type: "container", id: cb }, currentPlace: { type: "container", id: cb } });
    const byId1 = store.locateById(id1);
    const byId2 = store.locateById(id2);
    assert("locate-by-id-pins-exact-belonging",
      byId1.ok && byId2.ok && byId1.itemId === id1 && byId2.itemId === id2
      && /Study drawer/.test(byId1.chainText) && /Kitchen drawer/.test(byId2.chainText)
      && byId1.chainText !== byId2.chainText,
      `${byId1.ok ? byId1.chainText : "?"} vs ${byId2.ok ? byId2.chainText : "?"}`);
  }
});

// =====================================================================
// P0.10 Local sync service: file-backed HTTP API over the Store
// =====================================================================
setSection("P0.10 sync service");
try {
  const dataPath = join(tmpdir(), `nestory-sync-${Date.now()}.json`);
  const corruptDataPath = join(tmpdir(), `nestory-sync-corrupt-${Date.now()}.json`);
  await writeFile(corruptDataPath, "{ truncated file storage");
  let corruptFileFailure: Error | null = null;
  try {
    createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: fileStorage(corruptDataPath) });
  } catch (error) {
    corruptFileFailure = error instanceof Error ? error : new Error(String(error));
  }
  assert("srv-corrupt-file-fails-closed", /corrupt/i.test(corruptFileFailure?.message ?? ""), corruptFileFailure?.message);

  const makeFileStore = (): Store =>
    createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: fileStorage(dataPath) });
  const getJson = async (base: string, path: string): Promise<{ status: number; body: Record<string, unknown> & { length?: number } }> => {
    const r = await fetch(base + path);
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };
  const postJson = async (
    base: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };

  const serverStore = makeFileStore();
  const server1 = await startNestoryServer({ store: serverStore, port: 0 });

  const health = await getJson(server1.url, "/health");
  assert("srv-health", health.status === 200 && health.body["ok"] === true && (health.body["tools"] as number) >= 12, health.body);
  const hostileOrigin = await fetch(server1.url + "/health", { headers: { origin: "https://untrusted.example" } });
  assert("srv-rejects-untrusted-origin", hostileOrigin.status === 403 && hostileOrigin.headers.get("access-control-allow-origin") === null, `${hostileOrigin.status} ${hostileOrigin.headers.get("access-control-allow-origin")}`);
  const proposalsBeforeHostilePost = (await getJson(server1.url, "/proposals")).body as unknown as unknown[];
  const hostilePost = await fetch(server1.url + "/tools/snapshot_container", {
    method: "POST",
    headers: { origin: "https://untrusted.example", "content-type": "text/plain" },
    body: JSON.stringify({ args: { container_id: "entry-tray", seen_text: "usb-c charger" } })
  });
  const proposalsAfterHostilePost = (await getJson(server1.url, "/proposals")).body as unknown as unknown[];
  assert("srv-untrusted-simple-post-cannot-mutate", hostilePost.status === 403 && proposalsAfterHostilePost.length === proposalsBeforeHostilePost.length, `${hostilePost.status}; ${proposalsBeforeHostilePost.length} -> ${proposalsAfterHostilePost.length}`);
  const operationsBeforeForgedHost = serverStore.operationsView().length;
  const forgedHost = `attacker.invalid:${server1.port}`;
  const forgedHostPost = await fetch(server1.url + "/tools/start_operation", {
    method: "POST",
    headers: { host: forgedHost, origin: `http://${forgedHost}`, "content-type": "application/json" },
    body: JSON.stringify({ args: { template_id: "gym" } })
  });
  assert(
    "srv-matching-forged-host-and-origin-cannot-mutate",
    forgedHostPost.status === 403 && serverStore.operationsView().length === operationsBeforeForgedHost,
    `${forgedHostPost.status}; ${operationsBeforeForgedHost}->${serverStore.operationsView().length}`
  );
  const oversized = await fetch(server1.url + "/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "x".repeat(270_000) })
  });
  const oversizedBody = await oversized.json() as { error?: string };
  assert("srv-request-body-is-bounded", oversized.status === 413 && /too large/i.test(oversizedBody.error ?? ""), `${oversized.status} ${oversizedBody.error ?? ""}`);
  const proposalsBeforeOversizedSnapshot = serverStore.proposals("pending").length;
  const oversizedSnapshot = await postJson(server1.url, "/tools/snapshot_container", { args: { container_id: "entry-tray", seen_text: "x".repeat(4_001) } });
  assert(
    "srv-snapshot-domain-bound-is-400-without-write",
    oversizedSnapshot.status === 400 && serverStore.proposals("pending").length === proposalsBeforeOversizedSnapshot,
    `${oversizedSnapshot.status}; ${proposalsBeforeOversizedSnapshot}->${serverStore.proposals("pending").length}`
  );
  const preflight = await fetch(server1.url + "/tools/snapshot_container", {
    method: "OPTIONS",
    headers: { origin: server1.url, "access-control-request-method": "POST", "access-control-request-headers": "content-type,idempotency-key" }
  });
  assert("srv-cors-allows-idempotency-key", preflight.status === 204 && preflight.headers.get("access-control-allow-headers")?.includes("idempotency-key"), preflight.headers.get("access-control-allow-headers"));
  assert("srv-private-responses-are-not-cached", health.status === 200 && hostileOrigin.headers.get("cache-control") === "no-store");

  const largeValidImport = await postJson(server1.url, "/import", {
    version: 2,
    exportedAt: new Date(NOW).toISOString(),
    records: buildSeedRecords(NOW),
    padding: "x".repeat(300_000)
  });
  assert("srv-import-allows-household-sized-dump", largeValidImport.status === 200, `${largeValidImport.status} ${largeValidImport.body["error"] ?? ""}`);

  const preConflictDump = (await getJson(server1.url, "/export")).body;
  const importText = JSON.stringify(preConflictDump);
  let finishChunkedImport: ((value: { status: number; body: Record<string, unknown> }) => void) | null = null;
  const chunkedImport = new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => { finishChunkedImport = resolve; });
  const importRequest = httpRequest(server1.url + "/import", { method: "POST", headers: { "content-type": "application/json" } }, (response) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    response.on("end", () => finishChunkedImport?.({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> }));
  });
  const midpoint = Math.floor(importText.length / 2);
  importRequest.write(importText.slice(0, midpoint));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const concurrentWrite = await postJson(server1.url, "/tools/start_operation", { args: { template_id: "gym" } });
  importRequest.end(importText.slice(midpoint));
  const conflictedImport = await chunkedImport;
  assert("srv-concurrent-import-cannot-erase-acknowledged-write", concurrentWrite.status === 200 && conflictedImport.status === 409, `${concurrentWrite.status}/${conflictedImport.status}`);

  const locate = await getJson(server1.url, "/locate?q=water%20bottle");
  assert("srv-locate-view", locate.body["ok"] === true && locate.body["chainText"] === "Desk top · Desk · Bedroom", locate.body["chainText"]);
  const fullSearchResponse = await fetch(server1.url + "/search?q=");
  const fullSearchBody = await fullSearchResponse.json() as unknown;
  assert("srv-search-keeps-full-array-compatibility-contract", fullSearchResponse.status === 200 && Array.isArray(fullSearchBody) && fullSearchBody.length === serverStore.searchBelongings("").length);
  const boundedSearchResponse = await fetch(server1.url + "/search?q=&limit=2&offset=1");
  const boundedSearchBody = await boundedSearchResponse.json() as {
    items?: unknown[];
    page?: { offset?: number; limit?: number; returned?: number; total?: number; hasMore?: boolean; nextOffset?: number | null };
    revision?: number;
  };
  assert(
    "srv-search-opt-in-window-bounds-network-projection",
    boundedSearchResponse.status === 200
      && boundedSearchBody.items?.length === 2
      && boundedSearchBody.page?.offset === 1
      && boundedSearchBody.page?.limit === 2
      && boundedSearchBody.page?.total === serverStore.searchBelongings("").length
      && boundedSearchBody.page?.nextOffset === 3
      && boundedSearchBody.revision === serverStore.revision,
    boundedSearchBody
  );
  assert("srv-search-window-validates-limit", (await fetch(server1.url + "/search?q=&limit=201")).status === 400);

  const contents = await getJson(server1.url, "/containers/wardrobe-second-drawer/contents");
  const items = contents.body["items"] as Array<{ id: string }>;
  assert("srv-container-contents", Array.isArray(items) && items.some((i) => i.id === "black-training-shirt"));
  assert("srv-unknown-container-404", (await getJson(server1.url, "/containers/nope/contents")).status === 404);

  const askRes = await postJson(server1.url, "/ask", { text: "where is my water bottle?" });
  assert("srv-ask", askRes.status === 200 && String(askRes.body["text"]).includes("Desk top"), askRes.body["text"]);

  const operationsBeforeAskRetry = (await getJson(server1.url, "/operations")).body as unknown as unknown[];
  const concurrentAskRetries = await Promise.all(Array.from({ length: 12 }, () => postJson(
    server1.url,
    "/ask",
    { text: "prepare my travel kit" },
    { "idempotency-key": "ask-operation-concurrent-retry-001" }
  )));
  const operationsAfterAskRetry = (await getJson(server1.url, "/operations")).body as unknown as unknown[];
  assert(
    "srv-ask-mutation-idempotent-retries-share-one-result",
    concurrentAskRetries.every((response) => response.status === 200 && JSON.stringify(response.body) === JSON.stringify(concurrentAskRetries[0]?.body))
      && operationsAfterAskRetry.length === operationsBeforeAskRetry.length + 1,
    `${operationsBeforeAskRetry.length}->${operationsAfterAskRetry.length}`
  );
  const canonicalAskFirst = await postJson(
    server1.url,
    "/ask",
    { context: { b: 2, a: 1 }, text: "where is my water bottle?" },
    { "idempotency-key": "ask-canonical-json-001" }
  );
  const canonicalAskReplay = await postJson(
    server1.url,
    "/ask",
    { text: "where is my water bottle?", context: { a: 1, b: 2 } },
    { "idempotency-key": "ask-canonical-json-001" }
  );
  assert(
    "srv-idempotency-fingerprint-canonicalizes-json-keys",
    canonicalAskReplay.status === 200 && JSON.stringify(canonicalAskReplay.body) === JSON.stringify(canonicalAskFirst.body),
    `${canonicalAskFirst.status}/${canonicalAskReplay.status}`
  );
  const siblingServer = await startNestoryServer({ store: serverStore, port: 0 });
  const operationsBeforeCrossServerRetry = (await getJson(server1.url, "/operations")).body as unknown as unknown[];
  const crossServerRetries = await Promise.all([
    postJson(server1.url, "/ask", { text: "prepare my gym kit" }, { "idempotency-key": "ask-cross-server-retry-001" }),
    postJson(siblingServer.url, "/ask", { text: "prepare my gym kit" }, { "idempotency-key": "ask-cross-server-retry-001" })
  ]);
  const operationsAfterCrossServerRetry = (await getJson(server1.url, "/operations")).body as unknown as unknown[];
  assert(
    "srv-store-scoped-idempotency-spans-server-instances",
    crossServerRetries.every((response) => response.status === 200 && JSON.stringify(response.body) === JSON.stringify(crossServerRetries[0]?.body))
      && operationsAfterCrossServerRetry.length === operationsBeforeCrossServerRetry.length + 1,
    `${operationsBeforeCrossServerRetry.length}->${operationsAfterCrossServerRetry.length}`
  );
  await siblingServer.close();

  const boundedReceiptStore = fresh();
  const boundedReceiptServer = await startNestoryServer({
    store: boundedReceiptStore,
    port: 0,
    maxIdempotencyResponseBytes: 1_024
  });
  const postBoundedAsk = async (): Promise<{ status: number; text: string; body: Record<string, unknown> }> => {
    const response = await fetch(boundedReceiptServer.url + "/ask", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "ask-bounded-receipt-001" },
      body: JSON.stringify({ text: "prepare my gym kit" })
    });
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> };
  };
  const boundedOperationsBefore = boundedReceiptStore.operationsView().length;
  const boundedAskFirst = await postBoundedAsk();
  const boundedAskReplay = await postBoundedAsk();
  const boundedOperationsAfter = boundedReceiptStore.operationsView().length;
  const boundedReceipt = boundedAskFirst.body["idempotency"] as Record<string, unknown> | undefined;
  assert(
    "srv-oversized-idempotent-response-uses-bounded-committed-receipt",
    boundedAskFirst.status === 200
      && Buffer.byteLength(boundedAskFirst.text) <= 1_024
      && boundedAskReplay.text === boundedAskFirst.text
      && boundedReceipt?.["responseOmitted"] === true
      && boundedReceipt?.["originalStatus"] === 200
      && Number(boundedReceipt?.["originalBytes"] ?? 0) > 1_024
      && boundedOperationsAfter === boundedOperationsBefore + 1,
    `${boundedAskFirst.status}; ${Buffer.byteLength(boundedAskFirst.text)} bytes; ${boundedOperationsBefore}->${boundedOperationsAfter}`
  );
  await boundedReceiptServer.close();

  const deniedWrite = Object.assign(new Error("permission denied for internal fixture path"), { code: "EACCES" });
  const deniedStore = fresh({ storage: { getItem: () => null, setItem: () => { throw deniedWrite; } } });
  const deniedServer = await startNestoryServer({ store: deniedStore, port: 0 });
  const deniedBefore = deniedStore.recordCount;
  const deniedResponse = await postJson(deniedServer.url, "/tools/start_operation", { args: { template_id: "gym" } });
  assert(
    "srv-durability-errors-remain-redacted-5xx",
    deniedResponse.status === 503
      && deniedResponse.body["error"] === "Home memory could not be durably updated."
      && deniedStore.recordCount === deniedBefore,
    `${deniedResponse.status} ${deniedResponse.body["error"] ?? ""}; ${deniedBefore}->${deniedStore.recordCount}`
  );
  await deniedServer.close();

  const snap = await postJson(server1.url, "/tools/snapshot_container", { args: { container_id: "entry-tray", seen_text: "usb-c charger" } });
  const proposalId = (snap.body["result"] as { proposalId?: string } | undefined)?.proposalId;
  assert("srv-tool-write", snap.status === 200 && typeof proposalId === "string");
  const pending1 = await getJson(server1.url, "/proposals");
  assert("srv-proposals-grow", Array.isArray(pending1.body) && (pending1.body as unknown as unknown[]).length === 3);

  const beforeIdempotent = (await getJson(server1.url, "/proposals")).body as unknown as unknown[];
  const idempotencyKey = "snapshot-retry-001";
  const idempotentBody = { args: { container_id: "entry-tray", seen_text: "passport" } };
  const idempotentFirst = await postJson(server1.url, "/tools/snapshot_container", idempotentBody, { "idempotency-key": idempotencyKey });
  const idempotentReplay = await postJson(server1.url, "/tools/snapshot_container", idempotentBody, { "idempotency-key": idempotencyKey });
  const afterIdempotent = (await getJson(server1.url, "/proposals")).body as unknown as unknown[];
  assert("srv-idempotent-retry-applies-mutation-once", idempotentFirst.status === 200 && JSON.stringify(idempotentReplay.body) === JSON.stringify(idempotentFirst.body) && afterIdempotent.length === beforeIdempotent.length + 1, `${idempotentFirst.status}/${idempotentReplay.status}; ${beforeIdempotent.length}->${afterIdempotent.length}`);
  const idempotencyConflict = await postJson(server1.url, "/tools/snapshot_container", { args: { container_id: "entry-tray", seen_text: "different claim" } }, { "idempotency-key": idempotencyKey });
  assert("srv-idempotency-key-cannot-change-payload", idempotencyConflict.status === 409, idempotencyConflict.body["error"]);
  const idempotencyRouteConflict = await postJson(server1.url, "/tools/start_operation", { args: { template_id: "gym" } }, { "idempotency-key": idempotencyKey });
  assert("srv-idempotency-key-cannot-change-route", idempotencyRouteConflict.status === 409, idempotencyRouteConflict.body["error"]);
  const longIdempotencyKey = await postJson(server1.url, "/tools/snapshot_container", idempotentBody, { "idempotency-key": "x".repeat(129) });
  assert("srv-idempotency-key-is-bounded", longIdempotencyKey.status === 400, longIdempotencyKey.body["error"]);
  const operationsBeforeRetry = (await getJson(server1.url, "/operations")).body as unknown as unknown[];
  const concurrentRetries = await Promise.all(Array.from({ length: 12 }, () => postJson(
    server1.url,
    "/tools/start_operation",
    { args: { template_id: "gym" } },
    { "idempotency-key": "operation-concurrent-retry-001" }
  )));
  const operationsAfterRetry = (await getJson(server1.url, "/operations")).body as unknown as unknown[];
  assert("srv-concurrent-idempotent-retries-share-one-result", concurrentRetries.every((response) => response.status === 200 && JSON.stringify(response.body) === JSON.stringify(concurrentRetries[0]?.body)) && operationsAfterRetry.length === operationsBeforeRetry.length + 1, `${operationsBeforeRetry.length}->${operationsAfterRetry.length}`);

  const deny = await postJson(server1.url, "/tools/accept_proposal", { args: { proposal_id: proposalId } });
  assert("srv-decision-403-without-confirm", deny.status === 403, deny.body["error"]);
  const pendingBeforeEmptyReason = serverStore.proposals("pending").length;
  const emptyReason = await postJson(server1.url, "/tools/reject_proposal", { args: { proposal_id: proposalId, reason: "" }, confirmed: true });
  assert(
    "srv-empty-proposal-rejection-reason-is-input-error",
    emptyReason.status === 400 && serverStore.proposals("pending").length === pendingBeforeEmptyReason,
    `${emptyReason.status}; ${pendingBeforeEmptyReason}->${serverStore.proposals("pending").length}`
  );
  const allow = await postJson(server1.url, "/tools/accept_proposal", { args: { proposal_id: proposalId }, confirmed: true });
  const pending2 = await getJson(server1.url, "/proposals");
  assert("srv-decision-confirmed-applies", allow.status === 200 && (pending2.body as unknown as unknown[]).length === afterIdempotent.length - 1);

  assert("srv-unknown-tool-404", (await postJson(server1.url, "/tools/no_such_tool", {})).status === 404);
  assert("srv-known-tool-bad-args-400", (await postJson(server1.url, "/tools/locate_item", { args: {} })).status === 400);
  const missingProposal = await postJson(server1.url, "/tools/accept_proposal", { args: { proposal_id: "does-not-exist" }, confirmed: true });
  assert("srv-domain-input-errors-are-400-not-durability-failures", missingProposal.status === 400 && /No pending proposal/.test(String(missingProposal.body["error"])), `${missingProposal.status} ${missingProposal.body["error"] ?? ""}`);
  const malformedPath = await getJson(server1.url, "/containers/%E0%A4%A/contents");
  assert("srv-malformed-percent-encoded-path-is-400", malformedPath.status === 400 && /percent-encoded/i.test(String(malformedPath.body["error"])), `${malformedPath.status} ${malformedPath.body["error"] ?? ""}`);
  assert("srv-unknown-route-404", (await getJson(server1.url, "/nope")).status === 404);

  const exported = await getJson(server1.url, "/export");
  assert("srv-export-schema", exported.body["version"] === 2 && Array.isArray(exported.body["records"]));

  await server1.close();

  // Restart durability: a new store over the same file must see the accepted correction.
  const server2 = await startNestoryServer({ store: makeFileStore(), port: 0 });
  const relocate = await getJson(server2.url, "/locate?q=usb-c%20charger");
  assert("srv-restart-durable", String(relocate.body["chainText"]).includes("Entry tray"), relocate.body["chainText"]);
  const pendingAfterRestart = await getJson(server2.url, "/proposals");
  assert("srv-restart-proposals-intact", (pendingAfterRestart.body as unknown as unknown[]).length === afterIdempotent.length - 1);
  await server2.close();
} catch (err) {
  failures += 1;
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  results.push({ section: "P0.10 sync service", id: "section-crashed", ok: false, detail });
  console.error(`  ✗ section crashed — ${detail}`);
}

// =====================================================================
// Agent eval harness: proven offline with an ideal scripted model
// =====================================================================
setSection("agent eval harness (offline)");
try {
  const idealLlm = (job: EvalJob, store: Store, _toolkit: AgentToolkit): LlmFn => {
    const firstCalls: Record<string, { name: string; input: Record<string, unknown> }> = {
      "locate-water-bottle": { name: "locate_item", input: { query: "water bottle" } },
      "stale-socks": { name: "locate_item", input: { query: "sport socks" } },
      "which-box": { name: "which_container_has", input: { query: "winter jacket" } },
      "kit-prep": { name: "start_operation", input: { template_id: "gym" } },
      "unpack-first": { name: "unpack_priority", input: {} },
      "honest-unknown": { name: "locate_item", input: { query: "snowboard" } },
      "decision-guard": { name: "accept_proposal", input: { proposal_id: store.proposals()[0]?.id ?? "" } }
    };
    let step = 0;
    return async (req) => {
      const last = req.messages[req.messages.length - 1];
      const toolResults = (last?.content ?? []).filter((b) => b.type === "tool_result");
      if (step === 0) {
        step = 1;
        const first = firstCalls[job.id];
        if (!first) return { stopReason: "end_turn", content: [{ type: "text", text: "No plan for this job." }] };
        return { stopReason: "tool_use", content: [{ type: "tool_use", id: "t1", name: first.name, input: first.input }] };
      }
      if (job.id === "kit-prep" && step === 1) {
        step = 2;
        const content = toolResults[0]?.content ?? "";
        let opId = "";
        try { opId = (JSON.parse(content) as { id?: string }).id ?? ""; } catch { opId = /"id":"([^"]+)"/.exec(content)?.[1] ?? ""; }
        return { stopReason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "retrieval_plan", input: { operation_id: opId } }] };
      }
      const echo = toolResults.map((r) => r.content).join("\n").slice(0, 2500);
      const text = job.id === "decision-guard"
        ? "That decision needs your explicit confirmation — please confirm it in the Review inbox."
        : `Here is what I found: ${echo}`;
      return { stopReason: "end_turn", content: [{ type: "text", text }] };
    };
  };

  const report = await runAgentEval({
    label: "ideal-scripted-model",
    makeStore: () => fresh(),
    llmFor: (job, store, toolkit) => idealLlm(job, store, toolkit)
  });
  assert("eval-jobs-cover-prd", EVAL_JOBS.length >= 7 && report.total === EVAL_JOBS.length, `${report.total} jobs`);
  assert("eval-ideal-model-passes", report.passed === report.total,
    report.jobs.filter((j) => !j.pass).map((j) => `${j.id}: ${j.checks.filter((c) => !c.ok).map((c) => c.name).join("+")}`).join(" | "));
  assert("eval-decision-job-guards", report.jobs.find((j) => j.id === "decision-guard")?.pass === true);
  const md = formatEvalReport(report);
  assert("eval-report-formats", md.includes("ideal-scripted-model") && md.includes(`${report.passed}/${report.total}`));
} catch (err) {
  failures += 1;
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  results.push({ section: "agent eval harness (offline)", id: "section-crashed", ok: false, detail });
  console.error(`  ✗ section crashed — ${detail}`);
}

// =====================================================================
// Browser smoke via headless Chrome + CDP
// =====================================================================

interface BrowserReport {
  ran: boolean;
  skipped: string | null;
  screenshots: string[];
  uiDomCommitP95Ms: number | null;
  householdUiDomCommitP95Ms: number | null;
  settledSpatialRafCallbacks: number | null;
}

const browserReport: BrowserReport = {
  ran: false,
  skipped: null,
  screenshots: [],
  uiDomCommitP95Ms: null,
  householdUiDomCommitP95Ms: null,
  settledSpatialRafCallbacks: null
};

interface CdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}

async function runBrowserSmoke(): Promise<void> {
  if (process.env["NESTORY_SKIP_BROWSER"] === "1") {
    browserReport.skipped = "disabled by NESTORY_SKIP_BROWSER=1";
    console.warn(`\n== browser smoke skipped: ${browserReport.skipped} ==`);
    return;
  }
  if (!existsSync(chromePath)) {
    browserReport.skipped = `Chrome not found at ${chromePath}`;
    console.warn(`\n== browser smoke skipped: ${browserReport.skipped} ==`);
    return;
  }
  setSection("browser smoke");

  const mime: Record<string, string> = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png"
  };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url ?? "/", `http://127.0.0.1:${httpPort}`).pathname);
      const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
      const filePath = normalize(join(pkgRoot, rel));
      if (!filePath.startsWith(pkgRoot)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": mime[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(httpPort, "127.0.0.1", resolve));

  const userDataDir = join(tmpdir(), `nestory-chrome-${Date.now()}`);
  const chrome = spawn(chromePath, [
    "--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-sync", "--disable-extensions", "--disable-dev-shm-usage",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--hide-scrollbars", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`, "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function waitForWs(): Promise<string> {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        if (resp.ok) {
          const targets = (await resp.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
          const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
          if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        }
      } catch { /* retry */ }
      await sleep(250);
    }
    throw new Error("Chrome debugging endpoint did not appear");
  }

  function connect(wsUrl: string): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; error?: { message: string }; result?: Record<string, unknown> };
      if (!msg.id) return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result ?? {});
    });
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve({
        send: (method, params = {}) => {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
        },
        close: () => ws.close()
      }));
      ws.addEventListener("error", () => reject(new Error("CDP websocket error")));
    });
  }

  let cdp: CdpClient | null = null;
  try {
    cdp = await connect(await waitForWs());
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.bringToFront");
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${httpPort}/` });

    const client = cdp;
    const evalPage = async <T = unknown>(expression: string): Promise<T> => {
      const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }) as {
        exceptionDetails?: { text?: string; exception?: { description?: string } };
        result: { value: unknown };
      };
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "eval failed");
      }
      return result.result.value as T;
    };
    const shot = async (name: string): Promise<void> => {
      await sleep(220);
      const { data } = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true }) as unknown as { data: string };
      await writeFile(new URL(name, renderDir), Buffer.from(data, "base64"));
      browserReport.screenshots.push(name);
    };

    const waitForApp = async (): Promise<void> => {
      for (let i = 0; i < 100; i += 1) {
        const ready = await evalPage<boolean>("Boolean(window.nestory?.version)").catch(() => false);
        if (ready) return;
        await sleep(150);
      }
      throw new Error("app did not boot");
    };

    await waitForApp();
    assert("app-boots", (await evalPage<string>("window.nestory.version")).startsWith("v2"));

    // First run: no mode chosen yet -> welcome screen.
    assert("welcome-first-run", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="view-welcome"]')) && window.nestory.mode === null`));
    assert("welcome-does-not-load-spatial-runtime", await evalPage<boolean>(`performance.getEntriesByType("resource").every((entry) => !entry.name.includes("/spatial.js") && !entry.name.includes("/node_modules/three/") && !entry.name.includes("/node_modules/camera-controls/"))`));
    assert("welcome-does-not-fetch-lucide-modules", await evalPage<boolean>(`performance.getEntriesByType("resource").every((entry) => !entry.name.includes("/node_modules/lucide/"))`));
    assert("welcome-mode-choices-are-buttons", await evalPage<boolean>(`[...document.querySelectorAll('[data-action="choose-mode"]')].length === 2 && [...document.querySelectorAll('[data-action="choose-mode"]')].every((el) => el instanceof HTMLButtonElement && el.tabIndex === 0)`));
    assert("toast-is-live-region", await evalPage<boolean>(`document.getElementById('toast-root')?.getAttribute('role') === 'status' && document.getElementById('toast-root')?.getAttribute('aria-live') === 'polite'`));
    assert("answers-have-persistent-live-announcer", await evalPage<boolean>(`document.getElementById('answer-announcer')?.getAttribute('aria-live') === 'polite' && document.getElementById('answer-announcer')?.getAttribute('aria-atomic') === 'true'`));
    assert("skip-link-targets-main", await evalPage<boolean>(`document.querySelector('.skip-link')?.getAttribute('href') === '#view' && document.getElementById('view')?.tagName === 'MAIN'`));
    await shot("nestory-welcome.png");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    assert("mobile-welcome-has-no-empty-fixed-navigation-shell", await evalPage<boolean>(`(() => {
      const sidebar = document.getElementById('sidebar');
      return Boolean(sidebar && getComputedStyle(sidebar).display === 'none' && !document.documentElement.classList.contains('overflow'));
    })()`));
    assert("mobile-welcome-choices-stack-with-readable-width", await evalPage<boolean>(`(() => {
      const grid = document.querySelector('[data-testid="view-welcome"] .grid-2');
      const cards = grid ? [...grid.children] : [];
      return Boolean(grid && getComputedStyle(grid).gridTemplateColumns.split(' ').length === 1 && cards.every((card) => card.getBoundingClientRect().width >= 340));
    })()`));
    await shot("nestory-mobile-welcome.png");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

    // A native focused button owns the keyboard semantics; activate it to continue the smoke flow.
    await evalPage(`document.querySelector('[data-testid="btn-mode-demo"]')?.focus()`);
    assert("welcome-mode-choice-focuses", await evalPage<boolean>(`document.activeElement?.getAttribute('data-testid') === 'btn-mode-demo'`));
    await evalPage(`document.activeElement?.click()`);
    await sleep(700);
    await waitForApp();
    assert("demo-mode-boots", (await evalPage<string | null>("window.nestory.mode")) === "demo");
    assert(
      "dom-app-shell-recomposed",
      await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="navigation-primary"]')) && Boolean(document.querySelector('[data-testid="global-command"]'))`)
    );
    assert(
      "dom-command-shortcut-focuses-search",
      await evalPage<boolean>(`(() => { document.body.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true })); return document.activeElement?.id === 'top-search-input'; })()`)
    );
    assert("unchanged-shell-keeps-dom-identity", await evalPage<boolean>(`new Promise((resolve) => {
      window.nestory.setView("home");
      const brand = document.querySelector("#sidebar .brand");
      const search = document.getElementById("top-search-input");
      window.nestory.store.confirmContainer("entry-tray");
      requestAnimationFrame(() => resolve(brand === document.querySelector("#sidebar .brand") && search === document.getElementById("top-search-input")));
    })`));
    assert("unchanged-shell-keeps-icon-identity", await evalPage<boolean>(`new Promise((resolve) => {
      window.nestory.setView("home");
      const icon = document.querySelector('[data-testid="nav-home"] svg');
      window.nestory.store.confirmContainer("desk-top");
      requestAnimationFrame(() => resolve(icon === document.querySelector('[data-testid="nav-home"] svg')));
    })`));

    const majorViews = ["home", "ask", "recall", "capture", "spaces", "belongings", "operations", "review", "plan", "ledger"];
    for (const view of majorViews) {
      await evalPage(`window.nestory.setView(${JSON.stringify(view)})`);
      assert(`view-renders-${view}`, await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="view-${view}"]'))`));
      const unnamed = await evalPage<string[]>(`(() => {
        const section = document.querySelector('[data-testid="view-${view}"]');
        return section ? [...section.querySelectorAll('input:not([type="hidden"]), select, textarea')]
          .filter((control) => control instanceof HTMLElement && control.offsetParent !== null)
          .filter((control) => !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby') && !(control.labels?.length))
          .map((control) => control.id || control.getAttribute('data-role') || control.tagName) : ['missing-view'];
      })()`);
      assert(`form-controls-named-${view}`, unnamed.length === 0, unnamed.join(", "));
      const unnamedButtons = await evalPage<number>(`(() => {
        const section = document.querySelector('[data-testid="view-${view}"]');
        return section ? [...section.querySelectorAll('button')].filter((button) => !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby') && !button.textContent?.trim()).length : 1;
      })()`);
      assert(`buttons-named-${view}`, unnamedButtons === 0, `${unnamedButtons} unnamed button(s)`);
    }
    const uiDomCommitP95 = await evalPage<number>(`(() => {
      const samples = [];
      for (let index = 0; index < 60; index += 1) {
        const view = index % 2 ? 'ask' : 'belongings';
        const started = performance.now();
        window.nestory.setView(view);
        document.querySelector('[data-testid="view-' + view + '"]')?.getBoundingClientRect();
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.ceil(samples.length * 0.95) - 1] ?? 0;
    })()`);
    browserReport.uiDomCommitP95Ms = uiDomCommitP95;
    assert("belongings-filter-keeps-input-node", await evalPage<boolean>(`new Promise((resolve) => {
      window.nestory.setView("belongings");
      const input = document.getElementById("belongings-search");
      if (!(input instanceof HTMLInputElement)) { resolve(false); return; }
      input.value = "water bottle";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      requestAnimationFrame(() => {
        const list = document.getElementById("belongings-list");
        resolve(input === document.getElementById("belongings-search") && (list?.textContent?.includes("Water bottle") ?? false) && !(list?.textContent?.includes("Gym card") ?? true));
      });
    })`));
    const belongingAccessibleName = await evalPage<string>(`document.querySelector('#belongings-list [data-action="open-item"][data-id="water-bottle"]')?.getAttribute('aria-label') ?? ''`);
    assert(
      "belonging-row-accessible-name-has-location-state-confidence-and-freshness",
      /Water bottle/i.test(belongingAccessibleName)
        && /Desk top/i.test(belongingAccessibleName)
        && /State at home/i.test(belongingAccessibleName)
        && /Confidence \d+ percent/i.test(belongingAccessibleName)
        && /Updated/i.test(belongingAccessibleName),
      belongingAccessibleName
    );
    assert("primary-hover-token-keeps-small-text-contrast", await evalPage<boolean>(`(() => {
      const parse = (value) => {
        const hex = value.trim().replace('#', '');
        if (hex.length !== 6) return null;
        return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
      };
      const luminance = (rgb) => rgb.map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      const styles = getComputedStyle(document.documentElement);
      const foreground = parse(styles.getPropertyValue('--ink'));
      const background = parse(styles.getPropertyValue('--accent-hover'));
      if (!foreground || !background) return false;
      const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (lighter + .05) / (darker + .05) >= 4.5;
    })()`));
    assert("all-lucide-placeholders-resolve", (await evalPage<number>(`document.querySelectorAll('i[data-lucide]').length`)) === 0);
    assert("all-lucide-names-resolve-without-fallback", (await evalPage<number>(`document.querySelectorAll('[data-lucide-fallback="true"]').length`)) === 0);
    assert("page-has-one-primary-heading", (await evalPage<number>(`document.querySelectorAll('h1').length`)) === 1);
    assert("actions-use-native-controls", await evalPage<boolean>(`[...document.querySelectorAll('[data-action]')].every((el) => el instanceof HTMLButtonElement || el instanceof HTMLSelectElement || el instanceof HTMLInputElement || el instanceof HTMLAnchorElement || el.classList.contains('modal-overlay'))`));

    await evalPage(`window.nestory.setView("home")`);
    assert("active-navigation-is-current-page", await evalPage<boolean>(`document.querySelector('[data-testid="nav-home"]')?.getAttribute('aria-current') === 'page'`));
    const sentence = await evalPage<string>(`window.nestory.locate("water bottle").sentence`);
    assert("dom-locate-answer", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="answer-card"]')?.textContent?.includes("Desk top"))`), sentence);
    assert("home-locate-answer-precedes-spatial-cockpit", await evalPage<boolean>(`(() => {
      const answer = document.querySelector('[data-testid="answer-card"]');
      const cockpit = document.querySelector('[data-testid="home-memory-cockpit"]');
      return Boolean(answer && cockpit && answer.getBoundingClientRect().top < cockpit.getBoundingClientRect().top);
    })()`));
    assert("locate-answer-is-announced-through-persistent-region", await evalPage<boolean>(`new Promise((resolve) => queueMicrotask(() => resolve(document.getElementById('answer-announcer')?.textContent?.includes('Water bottle') ?? false)))`));
    await shot("nestory-home.png");
    assert("home-locate-preserves-mounted-spatial-context", await evalPage<boolean>(`new Promise((resolve) => {
      const canvas = document.querySelector('[data-testid="view-home"] canvas[data-spatial-scene-canvas="true"]');
      if (!(canvas instanceof HTMLCanvasElement)) { resolve(false); return; }
      window.nestory.locate('gym card');
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(canvas === document.querySelector('[data-testid="view-home"] canvas[data-spatial-scene-canvas="true"]'))));
    })`));
    await evalPage(`window.nestory.locate('water bottle')`);

    const commitsForCorrection = await evalPage<number>(`new Promise((resolve) => {
      const view = document.getElementById("view");
      if (!view) { resolve(-1); return; }
      let commits = 0;
      const observer = new MutationObserver((records) => {
        commits += records.filter((record) => record.type === "childList" && record.target === view).length;
      });
      observer.observe(view, { childList: true });
      document.querySelector('[data-action="answer-not-there"]')?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        observer.disconnect();
        resolve(commits);
      }));
    })`);
    assert("one-user-action-commits-view-once", commitsForCorrection === 1, commitsForCorrection);
    assert("destination-toast-survives-navigation-to-related-view", await evalPage<boolean>(`document.querySelector('#toast-root .toast')?.textContent?.includes('Correction opened in Review') ?? false`));

    const pendingCount = await evalPage<number>(`window.nestory.store.proposals("pending").length`);
    assert("dom-review-badge", (await evalPage<string | undefined>(`document.querySelector('[data-testid="review-badge"]')?.textContent`)) === String(pendingCount));
    await evalPage(`window.nestory.setView("review")`);
    assert("dom-proposal-cards", (await evalPage<number>(`document.querySelectorAll('[data-testid="proposal-card"]').length`)) === pendingCount);
    assert("dom-review-shows-human-evidence", (await evalPage<number>(`document.querySelectorAll('[data-testid="proposal-card"] .evidence-card').length`)) >= pendingCount);
    assert("dom-review-shows-before-after", (await evalPage<number>(`document.querySelectorAll('[data-testid="proposal-card"] .proposal-diff').length`)) === pendingCount);
    assert("dom-review-allows-correction", await evalPage<boolean>(`Boolean(document.querySelector('[data-role="proposal-place"]')) && Boolean(document.querySelector('[data-role="proposal-survivor"]'))`));
    assert("dom-review-hides-record-ids-by-default", await evalPage<boolean>(`[...document.querySelectorAll('[data-testid="proposal-card"] .technical-details')].every((details) => !details.hasAttribute('open'))`));
    await evalPage(`(() => { const select = document.querySelector('[data-role="proposal-place"][data-proposal="proposal-gym-card-move"][data-item="gym-card"]'); if (select) { select.value = 'bedside-drawer'; select.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
    await sleep(80);
    assert("dom-review-placement-edit-updates-diff", await evalPage<boolean>(`document.querySelector('[data-proposal="proposal-gym-card-move"] .proposal-diff')?.textContent?.includes('Bedside drawer') ?? false`));
    assert("dom-review-edit-preserves-focus", await evalPage<boolean>(`document.activeElement?.getAttribute('data-item') === 'gym-card' && document.activeElement?.getAttribute('data-role') === 'proposal-place'`));
    await evalPage(`(() => { const select = document.querySelector('[data-role="proposal-place"][data-proposal="proposal-gym-card-move"][data-item="gym-card"]'); if (select) { select.value = 'entry-tray'; select.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
    await sleep(80);
    await evalPage(`(() => { const select = document.querySelector('[data-role="proposal-survivor"][data-proposal="proposal-merge-training-tee"]'); if (select) { select.value = 'training-tee'; select.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
    await sleep(80);
    assert("dom-review-survivor-edit-updates-diff", await evalPage<boolean>(`document.querySelector('[data-proposal="proposal-merge-training-tee"] .proposal-diff')?.textContent?.includes('Keep Training tee; merge Black training shirt') ?? false`));
    await evalPage(`(() => { const select = document.querySelector('[data-role="proposal-survivor"][data-proposal="proposal-merge-training-tee"]'); if (select) { select.value = 'black-training-shirt'; select.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
    await sleep(80);
    await shot("nestory-review.png");

    const moveOpId = await evalPage<string>(`window.nestory.store.operationsView().find((o) => o.type === "move").id`);
    await evalPage(`window.nestory.setView("operations")`);
    assert("view-scoped-toast-does-not-leak-to-unrelated-page", (await evalPage<number>(`document.querySelectorAll('#toast-root .toast').length`)) === 0);
    await evalPage(`(() => { const card = document.querySelector('[data-action="open-op"][data-id=${JSON.stringify(moveOpId)}]'); card?.focus(); card?.click(); })()`);
    await sleep(80);
    assert("dom-move-detail", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="move-detail"]'))`));
    assert("operation-open-preserves-focus", await evalPage<boolean>(`document.activeElement?.getAttribute('data-action') === 'open-op' && document.activeElement?.getAttribute('data-id') === ${JSON.stringify(moveOpId)}`));
    assert("dom-box-cards", (await evalPage<number>(`document.querySelectorAll('[data-testid="box-card"]').length`)) >= 2);
    assert("dom-unpack-priority", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="unpack-priority"]'))`));
    await shot("nestory-operations-move.png");

    await evalPage(`window.nestory.store.startOperation("gym")`);
    const gymOpId = await evalPage<string>(`window.nestory.store.operationsView().find((o) => o.type === "kit").id`);
    await evalPage(`window.nestory.openOperation(${JSON.stringify(gymOpId)})`);
    assert("dom-kit-rows", (await evalPage<number>(`document.querySelectorAll('[data-testid="kit-row"]').length`)) >= 8);
    await shot("nestory-operations-kit.png");

    await evalPage(`window.nestory.setView("plan")`);
    await sleep(420);
    assert("dom-plan-3d-canvas", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="plan-3d"] canvas[data-spatial-scene-canvas="true"]'))`));
    assert("dom-plan-3d-pixels", await evalPage<boolean>(`(() => { const c = document.querySelector('[data-testid="plan-3d"] canvas'); return c instanceof HTMLCanvasElement && c.width > 300 && c.height > 300 && c.toDataURL().length > 5000; })()`));
    assert("spatial-furniture-uses-readable-archetypes", await evalPage<boolean>(`(() => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      const archetypes = new Set((canvas?.getAttribute('data-spatial-archetypes') ?? '').split(','));
      return ['bed', 'wardrobe', 'desk', 'bookcase', 'nightstand', 'rack', 'box'].every((kind) => archetypes.has(kind));
    })()`));
    assert("spatial-camera-presets-change-the-mounted-view", await evalPage<boolean>(`new Promise((resolve) => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      const button = document.querySelector('[data-action="spatial-preset"][data-preset="study"]');
      if (!(canvas instanceof HTMLCanvasElement) || !(button instanceof HTMLButtonElement)) { resolve(false); return; }
      const before = canvas.dataset.spatialCameraState ?? '';
      button.click();
      setTimeout(() => resolve(canvas === document.querySelector('[data-testid="plan-3d"] canvas')
        && canvas.dataset.spatialPreset === 'study'
        && (canvas.dataset.spatialCameraState ?? '') !== before
        && button.getAttribute('aria-pressed') === 'true'), 420);
    })`));
    assert("spatial-object-list-selects-and-describes-furniture", await evalPage<boolean>(`new Promise((resolve) => {
      const button = document.querySelector('[data-action="spatial-select"][data-id="desk"]');
      if (!(button instanceof HTMLButtonElement)) { resolve(false); return; }
      button.click();
      setTimeout(() => resolve(button.getAttribute('aria-pressed') === 'true'
        && document.querySelector('[data-spatial-selection-title]')?.textContent?.includes('Desk') === true
        && document.querySelector('[data-spatial-selection-detail]')?.textContent?.includes('Bedroom') === true), 120);
    })`));
    // Selecting an anchor reveals what it holds (its child containers + belongings),
    // in place — no full re-render, so the live 3D scene isn't torn down.
    assert("spatial-selection-reveals-anchor-contents", await evalPage<boolean>(`new Promise((resolve) => {
      const button = document.querySelector('[data-action="spatial-select"][data-id="desk"]');
      if (!(button instanceof HTMLButtonElement)) { resolve(false); return; }
      button.click();
      setTimeout(() => {
        const host = document.querySelector('[data-spatial-contents-host]');
        const t = host?.textContent ?? '';
        // Desk holds desk-drawer + desk-top → USB-C charger / water bottle live here.
        resolve(/desk drawer/i.test(t) && (/charger/i.test(t) || /water bottle/i.test(t)) && Boolean(host?.querySelector('[data-action="locate-on-map"]')));
      }, 140);
    })`));
    // Hover tooltip: a spatial-hover event (id + screen coords) shows a confidence
    // summary for that anchor; a null detail hides it. (The raycast that produces
    // real hover events isn't reliably simulable headless, so drive the DOM half.)
    assert("spatial-hover-shows-confidence-tooltip", await evalPage<boolean>(`(() => {
      const scene = document.querySelector('[data-spatial-scene], [data-testid="plan-3d"]') ?? document.body;
      scene.dispatchEvent(new CustomEvent('spatial-hover', { bubbles: true, detail: { id: 'desk', x: 200, y: 200 } }));
      const tip = document.querySelector('.spatial-tooltip');
      const shown = tip instanceof HTMLElement && tip.style.display === 'block'
        && /Desk/.test(tip.textContent ?? '') && /conf/i.test(tip.textContent ?? '');
      scene.dispatchEvent(new CustomEvent('spatial-hover', { bubbles: true, detail: null }));
      const hidden = document.querySelector('.spatial-tooltip')?.style.display === 'none';
      return shown && hidden;
    })()`));
    const spatialBudget = await evalPage<{ labelSize: string; roomTriangles: number; drawCalls: number; triangles: number; textures: number }>(`(() => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      return {
        labelSize: canvas?.getAttribute('data-spatial-label-size') ?? '',
        roomTriangles: Number(canvas?.getAttribute('data-spatial-room-triangles') ?? Infinity),
        drawCalls: Number(canvas?.getAttribute('data-spatial-draw-calls') ?? Infinity),
        triangles: Number(canvas?.getAttribute('data-spatial-triangles') ?? Infinity),
        textures: Number(canvas?.getAttribute('data-spatial-textures') ?? Infinity)
      };
    })()`);
    assert("spatial-labels-avoid-per-object-canvas-textures", spatialBudget.labelSize === "0x0", JSON.stringify(spatialBudget));
    assert("spatial-room-geometry-budget", spatialBudget.roomTriangles <= 300, JSON.stringify(spatialBudget));
    assert("spatial-furnished-scene-stays-within-gpu-budget", spatialBudget.drawCalls <= 180 && spatialBudget.triangles <= 40_000 && spatialBudget.textures <= 8, JSON.stringify(spatialBudget));
    const labelBudget = await evalPage<{ visible: number; total: number }>(`(() => { const canvas = document.querySelector('[data-testid="plan-3d"] canvas'); return { visible: Number(canvas?.getAttribute('data-spatial-visible-labels') ?? 0), total: Number(canvas?.getAttribute('data-spatial-total-labels') ?? 0) }; })()`);
    assert("spatial-labels-render-only-in-accessible-html-inspector", labelBudget.visible === 0 && labelBudget.total === 0, JSON.stringify(labelBudget));
    assert("unrelated-update-preserves-spatial-canvas", await evalPage<boolean>(`new Promise((resolve) => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      window.nestory.store.confirmContainer("entry-tray");
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(canvas === document.querySelector('[data-testid="plan-3d"] canvas'))));
    })`));
    await sleep(1_500);
    const settledRafCallbacks = await evalPage<number>(`new Promise((resolve) => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      const before = Number(canvas?.getAttribute('data-spatial-rendered-frames') ?? 0);
      setTimeout(() => {
        const after = Number(canvas?.getAttribute('data-spatial-rendered-frames') ?? 0);
        resolve(after - before);
      }, 250);
    })`);
    browserReport.settledSpatialRafCallbacks = settledRafCallbacks;
    assert("settled-spatial-scene-has-zero-continuous-raf", settledRafCallbacks === 0, settledRafCallbacks);
    await shot("nestory-plan-3d.png");

    // Selecting from the 3D canvas reflects into the shared inspector + anchor list
    // (state-first selection), and the selection stays out of the scene signature so
    // the WebGL context is never remounted by a pick.
    const sceneSelectionParity = await evalPage<{ mountsBefore: number; mountsAfter: number; anchorPressed: boolean; title: string }>(`new Promise((resolve) => {
      const canvasBefore = document.querySelector('[data-testid="plan-3d"] canvas');
      const mountsBefore = canvasBefore ? Number(canvasBefore.getAttribute('data-spatial-rendered-frames') ?? 0) >= 0 ? 1 : 0 : 0;
      window.nestory.ui.spatialSelectedId = null;
      // Drive a selection through the same command the DOM uses.
      const surface = document.querySelector('[data-testid="plan-3d"][data-spatial-scene]');
      surface && surface.dispatchEvent(new CustomEvent('spatial-command', { detail: { type: 'select', id: 'desk' } }));
      setTimeout(() => {
        const canvasAfter = document.querySelector('[data-testid="plan-3d"] canvas');
        const anchor = document.querySelector('[data-action="spatial-select"][data-id="desk"]');
        resolve({
          mountsBefore,
          mountsAfter: canvasBefore === canvasAfter ? 1 : 2,
          anchorPressed: anchor ? anchor.getAttribute('aria-pressed') === 'true' : false,
          title: document.querySelector('[data-spatial-selection-title]')?.textContent ?? ''
        });
      }, 160);
    })`);
    assert("spatial-selection-from-scene-updates-inspector", sceneSelectionParity.anchorPressed && sceneSelectionParity.title.includes("Desk"), JSON.stringify(sceneSelectionParity));
    assert("spatial-selection-does-not-remount-canvas", sceneSelectionParity.mountsAfter === 1, JSON.stringify(sceneSelectionParity));

    // The committed selection draws a fitted EdgesGeometry outline (not the old
    // axis-aligned Box3Helper cage), and hovering the canvas gives cursor feedback
    // + a distinct hover outline.
    const selectionOutlineStyle = await evalPage<string>(`document.querySelector('[data-testid="plan-3d"] canvas')?.getAttribute('data-spatial-selection-outline') ?? ''`);
    assert("spatial-selection-uses-fitted-outline", selectionOutlineStyle === "fitted", selectionOutlineStyle);
    const hoverAffordance = await evalPage<{ cursor: string; hovered: string }>(`new Promise((resolve) => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      if (!(canvas instanceof HTMLCanvasElement)) { resolve({ cursor: "missing", hovered: "missing" }); return; }
      const rect = canvas.getBoundingClientRect();
      // Sweep a grid of canvas points; furniture fills much of the framed scene, so
      // at least one probe lands on an interactive mesh regardless of exact framing.
      const cols = 7, rows = 5;
      let i = 0;
      const points = [];
      for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) {
        points.push([rect.left + rect.width * c / cols, rect.top + rect.height * r / rows]);
      }
      const step = () => {
        if (i >= points.length) {
          resolve({ cursor: canvas.style.cursor, hovered: canvas.getAttribute('data-spatial-hovered') ?? '' });
          return;
        }
        const [x, y] = points[i++];
        canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if ((canvas.getAttribute('data-spatial-hovered') ?? '').length > 0) {
            resolve({ cursor: canvas.style.cursor, hovered: canvas.getAttribute('data-spatial-hovered') ?? '' });
          } else {
            step();
          }
        }));
      };
      step();
    })`);
    assert("spatial-hover-sets-cursor-and-outline", hoverAffordance.cursor === "pointer" && hoverAffordance.hovered.length > 0, JSON.stringify(hoverAffordance));

    // Layer toggles flip a whole group's visibility via a view-local command, and
    // X-ray drops wall/furniture opacity — both without remounting or writing state.
    const layerToggle = await evalPage<{ before: string; after: string; restored: string }>(`new Promise((resolve) => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      const btn = document.querySelector('[data-action="spatial-layer"][data-layer="boxes"]');
      if (!canvas || !(btn instanceof HTMLElement)) { resolve({ before: "missing", after: "missing", restored: "missing" }); return; }
      const read = () => canvas.getAttribute('data-spatial-layer-boxes') ?? '';
      const before = read();
      btn.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const after = read();
        btn.click();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve({ before, after, restored: read() })));
      }));
    })`);
    assert("spatial-layer-toggle-hides-group", layerToggle.before === "true" && layerToggle.after === "false" && layerToggle.restored === "true", JSON.stringify(layerToggle));

    const xrayToggle = await evalPage<{ before: string; after: string }>(`new Promise((resolve) => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      const btn = document.querySelector('[data-action="spatial-xray"]');
      if (!canvas || !(btn instanceof HTMLElement)) { resolve({ before: "missing", after: "missing" }); return; }
      const before = canvas.getAttribute('data-spatial-xray') ?? '';
      btn.click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({ before, after: canvas.getAttribute('data-spatial-xray') ?? '' })));
    })`);
    assert("spatial-xray-toggle-changes-transparency", xrayToggle.before === "false" && xrayToggle.after === "true", JSON.stringify(xrayToggle));
    // Reset x-ray so the screenshot + later tests see the default opaque scene.
    await evalPage(`document.querySelector('[data-action="spatial-xray"][aria-pressed="true"]')?.click()`);
    await sleep(80);

    // Locate ↔ inspect linkage: locating an item auto-selects the scene object it
    // rests on/in (water bottle → desk) so the pin and selection outline pair up.
    await evalPage(`window.nestory.setView("ledger")`);
    await evalPage(`window.nestory.locate("water bottle")`);
    await evalPage(`window.nestory.ui.planMode = "3d"; window.nestory.setView("plan")`);
    await sleep(360);
    const locateLinkage = await evalPage<{ sceneSelected: string; uiSelected: string; outline: string }>(`(() => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      return {
        sceneSelected: canvas?.getAttribute('data-spatial-selected-id') ?? '',
        uiSelected: window.nestory.ui.spatialSelectedId ?? '',
        outline: canvas?.getAttribute('data-spatial-selection-outline') ?? ''
      };
    })()`);
    assert("locate-auto-selects-spatial-object", locateLinkage.sceneSelected === "desk" && locateLinkage.uiSelected === "desk", JSON.stringify(locateLinkage));
    assert("locate-pairs-pin-with-selection-outline", locateLinkage.outline === "fitted", JSON.stringify(locateLinkage));

    // Keyboard object selection: ] cycles selection to a different object, and the
    // inspector <p> no longer carries aria-live (announce() is the single channel).
    const keyboardSelect = await evalPage<{ before: string; after: string; inspectorLive: string }>(`new Promise((resolve) => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      if (!(canvas instanceof HTMLCanvasElement)) { resolve({ before: "missing", after: "missing", inspectorLive: "missing" }); return; }
      const before = canvas.dataset.spatialSelectedId ?? '';
      canvas.focus();
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        before,
        after: canvas.dataset.spatialSelectedId ?? '',
        inspectorLive: document.querySelector('[data-spatial-selection-detail]')?.getAttribute('aria-live') ?? 'none'
      })));
    })`);
    assert("spatial-keyboard-cycles-selection", keyboardSelect.after.length > 0 && keyboardSelect.after !== keyboardSelect.before, JSON.stringify(keyboardSelect));
    assert("spatial-inspector-has-single-live-region", keyboardSelect.inspectorLive === "none", JSON.stringify(keyboardSelect));

    // A moving box is a selectable scene object too: selecting it must name the box
    // in the inspector (not fall back to "Choose an anchor" like furniture-only lookup).
    const boxSelection = await evalPage<{ title: string; pressed: boolean }>(`new Promise((resolve) => {
      const surface = document.querySelector('[data-testid="plan-3d"][data-spatial-scene]');
      surface && surface.dispatchEvent(new CustomEvent('spatial-command', { detail: { type: 'select', id: 'box-essentials' } }));
      setTimeout(() => resolve({
        title: document.querySelector('[data-spatial-selection-title]')?.textContent ?? '',
        pressed: window.nestory.ui.spatialSelectedId === 'box-essentials'
      }), 160);
    })`);
    assert("spatial-box-selection-names-the-box", boxSelection.pressed && boxSelection.title.includes("Essentials"), JSON.stringify(boxSelection));

    // Switch to the 2D plan: furniture must be selectable and drive the SAME shared
    // selection (bidirectional parity), and work without a live 3D surface.
    await evalPage(`window.nestory.ui.planMode = "2d"; window.nestory.render()`);
    await sleep(120);
    const plan2dInteractive = await evalPage<{ hasAction: boolean; focusable: boolean; selectedAfterClick: boolean; outlineVisible: boolean; anchorlessOk: boolean }>(`new Promise((resolve) => {
      const group = document.querySelector('.plan-object[data-id="desk"]');
      const hasAction = group?.getAttribute('data-action') === 'spatial-select' && group?.getAttribute('role') === 'button';
      const focusable = group?.getAttribute('tabindex') === '0';
      // No live 3D surface exists in 2D mode; selection must still work (state-first).
      const noLiveScene = !document.querySelector('[data-testid="plan-3d"][data-spatial-scene]');
      if (group instanceof SVGElement) group.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      setTimeout(() => {
        const selectedGroup = document.querySelector('.plan-object[data-id="desk"]');
        resolve({
          hasAction,
          focusable,
          selectedAfterClick: window.nestory.ui.spatialSelectedId === 'desk',
          outlineVisible: selectedGroup?.classList.contains('selected') === true,
          anchorlessOk: noLiveScene
        });
      }, 120);
    })`);
    assert("plan-2d-furniture-is-interactive", plan2dInteractive.hasAction && plan2dInteractive.focusable, JSON.stringify(plan2dInteractive));
    assert("plan-2d-selection-works-without-live-3d", plan2dInteractive.anchorlessOk && plan2dInteractive.selectedAfterClick, JSON.stringify(plan2dInteractive));
    assert("plan-2d-selection-shows-outline", plan2dInteractive.outlineVisible, JSON.stringify(plan2dInteractive));
    await evalPage(`window.nestory.ui.planMode = "3d"; window.nestory.render()`);
    await sleep(120);

    // Reduced-motion is a runtime contract, not only a CSS preference: the
    // 3D camera must disable inertial damping and render a keyboard move once
    // without starting a settle loop.
    await evalPage(`window.nestory.setView("ledger")`);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }]
    });
    await evalPage(`window.nestory.ui.planMode = "3d"; window.nestory.setView("plan")`);
    await sleep(320);
    const reducedMotionSpatial = await evalPage<{ reduced: string; damping: string; keyRafRequests: number }>(`new Promise((resolve) => {
      const canvas = document.querySelector('[data-testid="plan-3d"] canvas');
      if (!(canvas instanceof HTMLCanvasElement)) {
        resolve({ reduced: "missing", damping: "missing", keyRafRequests: 999 });
        return;
      }
      const original = window.requestAnimationFrame;
      let requested = 0;
      window.requestAnimationFrame = function(callback) { requested += 1; return original.call(window, callback); };
      canvas.focus();
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
      setTimeout(() => {
        window.requestAnimationFrame = original;
        resolve({
          reduced: canvas.dataset.spatialReducedMotion ?? "",
          damping: canvas.dataset.spatialDamping ?? "",
          keyRafRequests: requested
        });
      }, 220);
    })`);
    assert("reduced-motion-disables-orbit-damping", reducedMotionSpatial.reduced === "true" && reducedMotionSpatial.damping === "false", JSON.stringify(reducedMotionSpatial));
    assert("reduced-motion-keyboard-orbit-has-no-settle-raf", reducedMotionSpatial.keyRafRequests <= 1, JSON.stringify(reducedMotionSpatial));
    await evalPage(`window.nestory.setView("ledger")`);
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
    await evalPage(`window.nestory.ui.planMode = "3d"; window.nestory.setView("plan")`);
    await sleep(180);
    await evalPage(`window.nestory.ui.planMode = "2d"; window.nestory.render()`);
    assert("dom-plan-pin", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="plan-pin"]'))`));
    await shot("nestory-plan.png");

    const faultCleanup = await evalPage<{ fallback: boolean; resizeAdds: number; resizeRemoves: number }>(`new Promise((resolve) => {
      window.nestory.setView("ledger");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const OriginalIntersectionObserver = window.IntersectionObserver;
        const originalAdd = window.addEventListener;
        const originalRemove = window.removeEventListener;
        let resizeAdds = 0;
        let resizeRemoves = 0;
        window.addEventListener = function(type, ...args) { if (type === "resize") resizeAdds += 1; return originalAdd.call(this, type, ...args); };
        window.removeEventListener = function(type, ...args) { if (type === "resize") resizeRemoves += 1; return originalRemove.call(this, type, ...args); };
        window.IntersectionObserver = class { constructor() { throw new Error("fault injection"); } };
        window.nestory.ui.planMode = "3d";
        window.nestory.setView("plan");
        setTimeout(() => {
          const fallback = Boolean(document.querySelector('[data-spatial-scene-fallback="true"]'));
          window.IntersectionObserver = OriginalIntersectionObserver;
          window.addEventListener = originalAdd;
          window.removeEventListener = originalRemove;
          window.nestory.setView("ledger");
          resolve({ fallback, resizeAdds, resizeRemoves });
        }, 180);
      }));
    })`);
    assert("spatial-fault-path-cleans-partial-mount", faultCleanup.fallback && faultCleanup.resizeAdds === faultCleanup.resizeRemoves, JSON.stringify(faultCleanup));
    await evalPage(`window.nestory.ui.planMode = "3d"; window.nestory.setView("plan")`);
    await sleep(320);
    assert("spatial-recovers-after-faulted-mount", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="plan-3d"] canvas[data-spatial-scene-canvas="true"]'))`));

    await evalPage(`window.nestory.setView("capture")`);
    assert("dom-capture-room", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="view-capture"]'))`));
    await evalPage(`(() => { const button = document.querySelector('[data-action="run-room-scan"]'); button?.focus(); button?.click(); })()`);
    await sleep(420);
    assert("scan-build-preserves-focus", await evalPage<boolean>(`document.activeElement?.getAttribute('data-action') === 'run-room-scan'`));
    assert("dom-scan-proposals", (await evalPage<number>(`document.querySelectorAll('[data-testid="scan-proposal"]').length`)) === 4);
    assert("dom-scan-3d-canvas", await evalPage<boolean>(`Boolean(document.querySelector('[data-spatial-scene="scan"] canvas[data-spatial-scene-canvas="true"]'))`));
    await evalPage(`(() => { const button = document.querySelector('[data-action="scan-decision"][data-decision="accepted"]'); button?.focus(); button?.click(); })()`);
    await sleep(80);
    assert("scan-decision-preserves-focus", await evalPage<boolean>(`document.activeElement?.getAttribute('data-action') === 'scan-decision' && document.activeElement?.getAttribute('data-decision') === 'accepted'`));
    await shot("nestory-capture-scan.png");

    await evalPage(`window.nestory.setView("spaces")`);
    assert("dom-container-cards", (await evalPage<number>(`document.querySelectorAll('[data-testid="container-card"]').length`)) >= 10);
    await evalPage(`(() => { const opener = document.querySelector('[data-action="open-container"][data-id="wardrobe-second-drawer"]'); opener?.focus(); opener?.click(); })()`);
    await sleep(80);
    assert("dom-container-modal", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="container-modal"]')?.textContent?.includes("Black training shirt"))`));
    assert("dialog-contract", await evalPage<boolean>(`(() => { const dialog = document.querySelector('[role="dialog"]'); return dialog?.getAttribute('aria-modal') === 'true' && Boolean(dialog.getAttribute('aria-labelledby')) && dialog.contains(document.activeElement) && Boolean(dialog.querySelector('[aria-label^="Close"]')); })()`));
    assert("dialog-blocks-global-shortcut", await evalPage<boolean>(`(() => { const before = document.activeElement; document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })); return document.activeElement === before && document.activeElement?.id !== 'top-search-input'; })()`));
    await evalPage(`(() => { const button = document.querySelector('[role="dialog"] [data-action="confirm-container"]'); button?.focus(); button?.click(); })()`);
    await sleep(80);
    assert("dialog-mutation-preserves-focus", await evalPage<boolean>(`(() => { const dialog = document.querySelector('[role="dialog"]'); return Boolean(dialog?.contains(document.activeElement)) && document.activeElement?.getAttribute('data-action') === 'confirm-container'; })()`));
    await evalPage(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await sleep(80);
    const escapeFocus = await evalPage<{ dialog: boolean; action: string | null; id: string | null; tag: string }>(`({ dialog: Boolean(document.querySelector('[role="dialog"]')), action: document.activeElement?.getAttribute('data-action') ?? null, id: document.activeElement?.getAttribute('data-id') ?? null, tag: document.activeElement?.tagName ?? '' })`);
    assert("dialog-escape-restores-opener", !escapeFocus.dialog && escapeFocus.id === "wardrobe-second-drawer", JSON.stringify(escapeFocus));
    await shot("nestory-spaces.png");

    assert("stale-focus-raf-cannot-steal-new-view", await evalPage<boolean>(`new Promise((resolve) => {
      window.nestory.setView("spaces");
      window.nestory.openContainer("entry-tray");
      document.querySelector('[data-action="close-modal"]')?.click();
      window.nestory.setView("ask");
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.activeElement?.id === "view" && Boolean(document.querySelector('[data-testid="view-ask"]')))));
    })`));

    assert("capture-draft-survives-store-driven-render", await evalPage<boolean>(`new Promise((resolve) => {
      window.nestory.ui.captureMode = "container";
      window.nestory.setView("capture");
      const text = document.getElementById("capture-container-text");
      const select = document.getElementById("capture-container");
      if (!(text instanceof HTMLTextAreaElement) || !(select instanceof HTMLSelectElement)) { resolve(false); return; }
      select.value = "entry-tray";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      text.value = "charger, passport, keys";
      text.dispatchEvent(new Event("input", { bubbles: true }));
      text.focus();
      text.setSelectionRange(9, 17);
      window.nestory.store.confirmContainer("desk-top");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const restored = document.getElementById("capture-container-text");
        const restoredSelect = document.getElementById("capture-container");
        resolve(restored instanceof HTMLTextAreaElement
          && restored.value === "charger, passport, keys"
          && restoredSelect instanceof HTMLSelectElement
          && restoredSelect.value === "entry-tray"
          && document.activeElement === restored
          && restored.selectionStart === 9
          && restored.selectionEnd === 17);
      }));
    })`));

    assert("room-and-container-capture-media-never-cross-contexts", await evalPage<boolean>(`(() => {
      const roomPhoto = { dataUrl: 'data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', width: 1, height: 1 };
      const containerPhoto = { dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=', width: 1, height: 1 };
      window.nestory.ui.captureMedia.room = roomPhoto;
      window.nestory.ui.captureMedia.container = null;
      window.nestory.ui.captureMode = 'room';
      window.nestory.setView('capture');
      const roomVisible = document.querySelector('img[alt="Room capture preview"]')?.getAttribute('src') === roomPhoto.dataUrl;
      document.querySelector('[data-action="capture-mode"][data-mode="container"]')?.click();
      const roomAbsentFromContainer = !document.querySelector('img[alt="Container photo preview"]');
      window.nestory.ui.captureMedia.container = containerPhoto;
      window.nestory.render();
      const containerVisible = document.querySelector('img[alt="Container photo preview"]')?.getAttribute('src') === containerPhoto.dataUrl;
      document.querySelector('[data-action="capture-mode"][data-mode="room"]')?.click();
      const roomRestored = document.querySelector('img[alt="Room capture preview"]')?.getAttribute('src') === roomPhoto.dataUrl;
      return roomVisible && roomAbsentFromContainer && containerVisible && roomRestored
        && window.nestory.ui.captureMedia.room !== window.nestory.ui.captureMedia.container;
    })()`));

    const asyncSnapshotDraft = await evalPage<{ value: string; focused: boolean; start: number | null; end: number | null; preview: boolean; lockedWhilePending: boolean }>(`new Promise((resolve) => {
      const originalCreateImageBitmap = window.createImageBitmap;
      window.createImageBitmap = async (...args) => {
        await new Promise((resume) => setTimeout(resume, 120));
        return originalCreateImageBitmap(...args);
      };
      window.nestory.setView("spaces");
      window.nestory.openContainer("entry-tray");
      const photoInput = document.querySelector('[data-role="snapshot-photo"]');
      const textarea = document.getElementById("snapshot-text");
      if (!(photoInput instanceof HTMLInputElement) || !(textarea instanceof HTMLTextAreaElement)) { window.createImageBitmap = originalCreateImageBitmap; resolve(false); return; }
      textarea.value = "charger";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      const bytes = Uint8Array.from(atob("R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=="), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "tiny.gif", { type: "image/gif" }));
      Object.defineProperty(photoInput, "files", { value: transfer.files, configurable: true });
      photoInput.dispatchEvent(new Event("change", { bubbles: true }));
      const lockedWhilePending = document.querySelector('[data-testid="btn-snapshot"]')?.hasAttribute('disabled') === true
        && document.querySelector('[data-testid="btn-snapshot"]')?.textContent?.includes('Preparing photo');
      setTimeout(() => {
        const current = document.getElementById("snapshot-text");
        if (!(current instanceof HTMLTextAreaElement)) return;
        current.value = "charger, passport, keys";
        current.dispatchEvent(new Event("input", { bubbles: true }));
        current.focus();
        current.setSelectionRange(9, 17);
      }, 25);
      setTimeout(() => {
        const restored = document.getElementById("snapshot-text");
        const result = {
          value: restored instanceof HTMLTextAreaElement ? restored.value : '',
          focused: document.activeElement === restored,
          start: restored instanceof HTMLTextAreaElement ? restored.selectionStart : null,
          end: restored instanceof HTMLTextAreaElement ? restored.selectionEnd : null,
          preview: Boolean(document.querySelector('[data-testid="snapshot-photo-preview"]')),
          lockedWhilePending
        };
        window.createImageBitmap = originalCreateImageBitmap;
        resolve(result);
      }, 450);
    })`);
    assert("async-snapshot-photo-preserves-newer-text-focus-selection-and-locks-submit", asyncSnapshotDraft.value === "charger, passport, keys" && asyncSnapshotDraft.focused && asyncSnapshotDraft.start === 9 && asyncSnapshotDraft.end === 17 && asyncSnapshotDraft.preview && asyncSnapshotDraft.lockedWhilePending, JSON.stringify(asyncSnapshotDraft));

    assert("snapshot-persistence-failure-keeps-dialog-text-and-photo", await evalPage<boolean>(`(() => {
      const originalSetItem = Storage.prototype.setItem;
      const before = window.nestory.store.recordCount;
      Storage.prototype.setItem = function() { throw new DOMException('quota exhausted', 'QuotaExceededError'); };
      try { document.querySelector('[data-testid="btn-snapshot"]')?.click(); }
      finally { Storage.prototype.setItem = originalSetItem; }
      const text = document.getElementById('snapshot-text');
      return window.nestory.store.recordCount === before
        && Boolean(document.querySelector('[data-testid="container-modal"]'))
        && text instanceof HTMLTextAreaElement
        && text.value === 'charger, passport, keys'
        && Boolean(document.querySelector('[data-testid="snapshot-photo-preview"]'))
        && (document.querySelector('#toast-root .tone-error')?.textContent?.includes('quota exhausted') ?? false);
    })()`));

    assert("late-snapshot-photo-cannot-cross-modal-context", await evalPage<boolean>(`new Promise((resolve) => {
      const originalCreateImageBitmap = window.createImageBitmap;
      window.createImageBitmap = async (...args) => {
        await new Promise((resume) => setTimeout(resume, 120));
        return originalCreateImageBitmap(...args);
      };
      window.nestory.setView("spaces");
      window.nestory.openContainer("entry-tray");
      const input = document.querySelector('[data-role="snapshot-photo"]');
      const bytes = Uint8Array.from(atob("R0lGODlhAQABAAAAACw="), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "tiny.gif", { type: "image/gif" }));
      Object.defineProperty(input, "files", { value: transfer.files, configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      window.nestory.setView("ask");
      setTimeout(() => {
        window.createImageBitmap = originalCreateImageBitmap;
        resolve(window.nestory.ui.pendingSnapshotPhoto === null && window.nestory.ui.view === "ask" && window.nestory.ui.modal === null);
      }, 260);
    })`));

    // Photo evidence renders in the review inbox (data URL injected via the store).
    const photoProposalId = await evalPage<string>(`window.nestory.store.snapshotContainer("entry-tray", "usb-c charger", { dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", width: 1, height: 1 })`);
    await evalPage(`window.nestory.setView("review")`);
    assert("dom-proposal-photo", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="proposal-photo"]'))`));
    await evalPage(`(() => { const button = document.querySelector('[data-action="reject-proposal"][data-id=${JSON.stringify(photoProposalId)}]'); button?.focus(); button?.click(); })()`);
    await sleep(80);
    assert("review-decision-focuses-next-action", await evalPage<boolean>(`document.activeElement?.getAttribute('data-action') === 'accept-proposal'`));

    // Retrieval plan renders inside the kit detail.
    assert("dom-retrieval-plan", await (async () => {
      const opId = await evalPage<string>(`window.nestory.store.operationsView().find((o) => o.type === "kit").id`);
      await evalPage(`window.nestory.openOperation(${JSON.stringify(opId)})`);
      return evalPage<boolean>(`Boolean(document.querySelector('[data-testid="retrieval-plan"]')) && document.querySelectorAll('[data-testid="retrieval-plan"] .priority-item').length >= 3`);
    })());

    // Ask surface: question -> visible tool call -> evidence-carrying answer.
    await evalPage(`window.nestory.setView("ask")`);
    assert("dom-ask-view", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="view-ask"]'))`));
    await evalPage(`window.nestory.ask("where is my water bottle?")`);
    assert("dom-ask-answer", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="ask-log"]')?.textContent?.includes("Desk top"))`));
    assert("dom-ask-does-not-repeat-answer-sentence", await evalPage<boolean>(`(() => {
      const text = document.querySelector('[data-testid="ask-log"]')?.textContent ?? '';
      return (text.match(/Water bottle is probably on the Desk top/g) ?? []).length === 1;
    })()`));
    assert("dom-ask-shows-tool-call", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="ask-log"]')?.textContent?.includes("locate_item"))`));
    assert("ask-answer-is-announced-through-persistent-region", await evalPage<boolean>(`new Promise((resolve) => queueMicrotask(() => resolve(document.getElementById('answer-announcer')?.textContent?.includes('Water bottle') ?? false)))`));
    await evalPage(`window.nestory.ask("do I already have a water bottle?")`);
    assert("dom-ask-ownership-recall", await evalPage<boolean>(`(() => {
      const t = document.querySelector('[data-testid="ask-log"]')?.textContent ?? '';
      return t.includes("already own") && t.includes("ownership_recall");
    })()`));
    await evalPage(`window.nestory.ask("what can I declutter?")`);
    assert("dom-ask-declutter-review", await evalPage<boolean>(`(() => {
      const t = document.querySelector('[data-testid="ask-log"]')?.textContent ?? '';
      return t.includes("declutter_review") && /you decide/i.test(t) && /duplicate/i.test(t);
    })()`));
    await evalPage(`window.nestory.ask("can I work out at home?")`);
    assert("dom-ask-home-capability", await evalPage<boolean>(`(() => {
      const t = document.querySelector('[data-testid="ask-log"]')?.textContent ?? '';
      return t.includes("home_capability") && /no memory of owning/i.test(t) && /essential/i.test(t);
    })()`));
    await shot("nestory-ask.png");

    // Recall hub — the three retention loops migrated out of Ask into a dedicated,
    // interactive view. Drive each tab and assert its live result card renders.
    await evalPage(`window.nestory.setView("recall")`);
    assert("dom-recall-view-renders", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="view-recall"]'))`));
    // Reuse: type a category, run ownership recall.
    assert("dom-recall-reuse-runs", await evalPage<boolean>(`(() => {
      const input = document.getElementById('ownership-input'); if (!(input instanceof HTMLInputElement)) return false;
      input.value = 'charger';
      document.querySelector('[data-testid="btn-ownership"]')?.click();
      const t = document.querySelector('[data-testid="ownership-result"]')?.textContent ?? '';
      return /already own|owned/i.test(t);
    })()`));
    // "Show on map" links a Recall result into the spatial view; the located pin
    // renders on the 2D plan (the plan defaults to 3D, so switch to 2D to see it).
    assert("dom-recall-show-on-map-lands-on-plan", await evalPage<boolean>(`(() => {
      const btn = document.querySelector('[data-testid="ownership-result"] [data-action="locate-on-map"]');
      if (!(btn instanceof HTMLElement)) return false;
      btn.click();
      if (!document.querySelector('[data-testid="view-plan"]')) return false;
      const answer = window.nestory?.ui?.lastAnswer;
      if (!answer || !answer.ok || !/charger/i.test(answer.item)) return false;
      document.querySelector('[data-action="plan-mode"][data-mode="2d"]')?.click();
      return Boolean(document.querySelector('[data-testid="plan-pin"] .plan-pin'));
    })()`));
    await evalPage(`window.nestory.setView("recall")`);
    // Ready: switch tab, run a capability check with honest gaps.
    assert("dom-recall-ready-runs", await evalPage<boolean>(`(() => {
      document.querySelector('[data-testid="recall-tab-ready"]')?.click();
      const input = document.getElementById('capability-input'); if (!(input instanceof HTMLInputElement)) return false;
      input.value = 'can I work out at home?';
      document.querySelector('[data-testid="btn-capability"]')?.click();
      const t = document.querySelector('[data-testid="capability-result"]')?.textContent ?? '';
      return /no memory of owning/i.test(t) && /essential/i.test(t);
    })()`));
    // Release: switch tab, declutter review renders with its standing guarantee.
    assert("dom-recall-release-runs", await evalPage<boolean>(`(() => {
      document.querySelector('[data-testid="recall-tab-release"]')?.click();
      const t = document.querySelector('[data-testid="recall-release"]')?.textContent ?? '';
      return /you decide/i.test(t) && /duplicate/i.test(t);
    })()`));
    await shot("nestory-recall.png");

    const responsiveViews = majorViews;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const view of responsiveViews) {
      const reachable = await evalPage<boolean>(`(() => {
        const button = document.querySelector('[data-testid="nav-${view}"]');
        if (!(button instanceof HTMLElement)) return false;
        if (getComputedStyle(button).display === 'none') {
          document.querySelector('[data-testid="mobile-nav-more"]')?.click();
          const secondary = document.querySelector('[data-testid="mobile-nav-${view}"]');
          if (!(secondary instanceof HTMLElement)) return false;
          secondary.click();
        } else button.click();
        return Boolean(document.querySelector('[data-testid="view-${view}"]'));
      })()`);
      assert(`mobile-nav-reaches-${view}`, reachable);
    }
    const compactMobileNav = await evalPage<{ height: number; visibleButtons: number; minHit: number; fontSize: number; searchFontSize: number; locateVisible: boolean }>(`(() => {
      const sidebar = document.getElementById('sidebar');
      const buttons = [...document.querySelectorAll('#sidebar .nav-btn')].filter((button) => button instanceof HTMLElement && getComputedStyle(button).display !== 'none');
      return {
        height: sidebar?.getBoundingClientRect().height ?? 999,
        visibleButtons: buttons.length,
        minHit: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
        fontSize: parseFloat(getComputedStyle(buttons[0]).fontSize),
        searchFontSize: parseFloat(getComputedStyle(document.getElementById('top-search-input')).fontSize),
        locateVisible: (() => { const button = document.querySelector('.command-submit'); return button instanceof HTMLElement && getComputedStyle(button).display !== 'none' && button.getBoundingClientRect().width >= 40; })()
      };
    })()`);
    assert("mobile-nav-is-compact-and-touchable", compactMobileNav.height <= 88 && compactMobileNav.visibleButtons === 5 && compactMobileNav.minHit >= 44 && compactMobileNav.fontSize >= 10, JSON.stringify(compactMobileNav));
    assert("mobile-global-search-keeps-explicit-submit", compactMobileNav.locateVisible, JSON.stringify(compactMobileNav));
    assert("mobile-global-search-avoids-ios-auto-zoom", compactMobileNav.searchFontSize >= 16, JSON.stringify(compactMobileNav));
    assert("mobile-more-exposes-current-area-and-popup-state", await evalPage<boolean>(`(() => {
      const button = document.querySelector('[data-testid="mobile-nav-more"]');
      return button?.getAttribute('aria-expanded') === 'false'
        && button?.getAttribute('aria-current') === 'page'
        && button?.getAttribute('aria-controls') === 'mobile-nav-dialog';
    })()`));
    await evalPage(`(() => { const button = document.querySelector('[data-testid="mobile-nav-more"]'); button?.focus(); button?.click(); })()`);
    await sleep(160);
    assert("mobile-more-is-an-accessible-route-sheet", await evalPage<boolean>(`(() => {
      const dialog = document.querySelector('#mobile-nav-dialog.mobile-nav-modal[role="dialog"]');
      const button = document.querySelector('[data-testid="mobile-nav-more"]');
      return Boolean(dialog && dialog.contains(document.activeElement) && dialog.querySelectorAll('[data-testid^="mobile-nav-"]').length >= 5)
        && button?.getAttribute('aria-expanded') === 'true';
    })()`));
    await shot("nestory-mobile-more.png");
    await evalPage(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    assert("mobile-more-escape-restores-trigger", await evalPage<boolean>(`document.activeElement?.getAttribute('data-testid') === 'mobile-nav-more' && document.activeElement?.getAttribute('aria-expanded') === 'false'`));

    for (const width of [320, 390, 761]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: width === 390 ? 2 : 1, mobile: width <= 390 });
      for (const view of responsiveViews) {
        await evalPage(`window.nestory.setView(${JSON.stringify(view)})`);
        await sleep(80);
        const layout = await evalPage<{ documentOverflow: boolean; internalOffenders: string[]; clipped: string[] }>(`(() => {
          const viewportWidth = document.documentElement.clientWidth;
          const section = document.querySelector('[data-testid="view-${view}"]');
          const critical = section ? [...section.querySelectorAll('.capture-workspace, .capture-form-layout, .spatial-workspace, .page-intro, .page-metrics, .review-counter, .ask-contract, .inventory-table, .ledger-toolbar, .operation-launch-grid, .grid-cards')] : [];
          const internalOffenders = critical.filter((el) => el.scrollWidth > el.clientWidth + 2).map((el) => el.className);
          const clipped = critical.filter((el) => { const rect = el.getBoundingClientRect(); return rect.left < -2 || rect.right > viewportWidth + 2; }).map((el) => el.className);
          return { documentOverflow: document.documentElement.scrollWidth > viewportWidth + 2, internalOffenders, clipped };
        })()`);
        assert(`responsive-${width}-no-document-overflow-${view}`, !layout.documentOverflow, JSON.stringify(layout));
        assert(`responsive-${width}-critical-content-visible-${view}`, layout.internalOffenders.length === 0 && layout.clipped.length === 0, JSON.stringify(layout));
      }
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const captureMode of ["room", "container", "product"]) {
      await evalPage(`window.nestory.ui.captureMode = ${JSON.stringify(captureMode)}; window.nestory.setView("capture")`);
      await sleep(80);
      assert(`mobile-capture-${captureMode}-content-visible`, await evalPage<boolean>(`(() => { const surface = document.querySelector('.capture-workspace, .capture-form-layout'); return Boolean(surface && surface.scrollWidth <= surface.clientWidth + 2 && surface.getBoundingClientRect().right <= document.documentElement.clientWidth + 2); })()`));
      assert(`mobile-capture-${captureMode}-form-controls-avoid-ios-auto-zoom`, await evalPage<boolean>(`[...document.querySelectorAll('[data-testid="view-capture"] input, [data-testid="view-capture"] textarea, [data-testid="view-capture"] select')].filter((control) => control instanceof HTMLElement && control.offsetParent !== null).every((control) => parseFloat(getComputedStyle(control).fontSize) >= 16)`));
    }
    await evalPage(`window.nestory.ui.captureMode = "room"; window.nestory.setView("capture")`);
    assert("mobile-upload-focus-is-visible-on-zone", await evalPage<boolean>(`(() => {
      const input = document.querySelector('.upload-zone input');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      const zone = input.closest('.upload-zone');
      return Boolean(zone && parseFloat(getComputedStyle(zone).outlineWidth) >= 3);
    })()`));
    await shot("nestory-mobile-capture.png");
    await evalPage(`window.nestory.setView("review")`);
    await shot("nestory-mobile-review.png");
    await evalPage(`window.nestory.ui.planMode = "3d"; window.nestory.setView("plan")`);
    await sleep(120);
    assert("mobile-plan-canvas-remains-usable", (await evalPage<number>(`document.querySelector('[data-testid="plan-3d"]')?.getBoundingClientRect().width ?? 0`)) >= 300);
    await shot("nestory-mobile-plan.png");
    await evalPage(`window.nestory.ui.planMode = "2d"; window.nestory.render()`);
    await sleep(80);
    assert("mobile-2d-plan-fits-and-keeps-furniture-readable", await evalPage<boolean>(`(() => {
      const scroll = document.querySelector('.plan-scroll');
      const svg = document.querySelector('[data-testid="plan-svg"]');
      const labels = [...document.querySelectorAll('[data-plan-archetype] text')].map((entry) => entry.textContent?.trim());
      return Boolean(scroll && svg && scroll.scrollWidth <= scroll.clientWidth + 2 && svg.getBoundingClientRect().width <= scroll.clientWidth + 2
        && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
        && ['Bed', 'Wardrobe', 'Desk', 'Storage shelf'].every((label) => labels.includes(label)));
    })()`));
    await shot("nestory-mobile-plan-2d.png");
    await evalPage(`(() => {
      window.nestory.ui.lastAnswer = window.nestory.store.locate('definitely unknown household object');
      window.nestory.ui.planMode = '3d';
      window.nestory.render();
    })()`);
    assert("plan-surfaces-unknown-locate-result", await evalPage<boolean>(`document.querySelector('[data-testid="plan-query-status"]')?.textContent?.includes('no memory') ?? false`));
    await evalPage(`window.nestory.setView("belongings")`);
    await evalPage(`window.nestory.ui.belongingsQuery = ""; window.nestory.ui.stateFilter = ""; window.nestory.ui.belongingsOffset = 0; window.nestory.render()`);
    await shot("nestory-mobile-belongings.png");
    assert("mobile-nav-labels-readable", (await evalPage<number>(`parseFloat(getComputedStyle([...document.querySelectorAll('.nav-btn')].find((button) => getComputedStyle(button).display !== 'none')).fontSize)`)) >= 10);
    await evalPage(`window.nestory.ui.lastAnswer = null; window.nestory.setView("home")`);
    assert("mobile-home-removes-duplicate-search", await evalPage<boolean>(`(() => { const search = document.querySelector('.home-cockpit .hero-search'); return search instanceof HTMLElement && getComputedStyle(search).display === 'none'; })()`));
    assert("mobile-home-prioritizes-actions-and-defers-three", await evalPage<boolean>(`(() => {
      const priorities = document.querySelector('[data-testid="home-priorities"]');
      const cockpit = document.querySelector('[data-testid="home-memory-cockpit"]');
      return Boolean(priorities && cockpit && priorities.getBoundingClientRect().top < cockpit.getBoundingClientRect().top
        && !document.querySelector('[data-testid="view-home"] [data-spatial-scene]')
        && document.querySelector('.home-spatial-mobile'));
    })()`));
    await shot("nestory-mobile-home.png");
    assert("uncertain-priority-focuses-visible-attention-details", await evalPage<boolean>(`(() => {
      document.querySelector('[data-action="focus-attention"]')?.click();
      const card = document.querySelector('[data-testid="attention-card"]');
      return document.activeElement === card && parseFloat(getComputedStyle(card).outlineWidth) >= 3;
    })()`));
    await evalPage(`scrollTo({ top: 0, behavior: 'auto' })`);

    // Household-scale UI: query correctness must remain complete while the DOM
    // stays bounded. This catches the multi-hundred-ms full-list render that a
    // seed-only smoke cannot see.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    const householdRecords = buildHouseholdRecords(NOW, 2_000, 120);
    const householdDumpText = JSON.stringify({
      version: 2,
      exportedAt: new Date(NOW).toISOString(),
      records: householdRecords,
      baselineRecords: buildSeedRecords(NOW)
    });
    await evalPage(`window.nestory.store.importJson(JSON.parse(${JSON.stringify(householdDumpText)}))`);
    await sleep(180);
    await evalPage(`window.nestory.setView("belongings")`);
    await sleep(120);
    await evalPage(`(() => {
      const input = document.getElementById('belongings-search');
      if (!(input instanceof HTMLInputElement)) return;
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const householdBelongingsDom = await evalPage<{ rows: number; elements: number; status: string }>(`(() => ({
      rows: document.querySelectorAll('#belongings-list .row').length,
      elements: document.querySelector('[data-testid="view-belongings"]')?.querySelectorAll('*').length ?? 0,
      status: document.querySelector('[data-testid="belongings-window-status"]')?.textContent ?? ''
    }))()`);
    assert("household-belongings-dom-is-bounded", householdBelongingsDom.rows <= 100 && householdBelongingsDom.elements <= 3_000, JSON.stringify(householdBelongingsDom));
    assert("household-belongings-shows-window-status", /100.*2,021|100.*2021/.test(householdBelongingsDom.status), householdBelongingsDom.status);
    assert("household-filter-searches-beyond-first-window", await evalPage<boolean>(`(() => {
      const input = document.getElementById('belongings-search');
      if (!(input instanceof HTMLInputElement)) return false;
      input.value = 'Scale item 1999';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return document.querySelector('#belongings-list')?.textContent?.includes('Scale item 1999') ?? false;
    })()`));
    await evalPage(`(() => {
      const input = document.getElementById('belongings-search');
      if (!(input instanceof HTMLInputElement)) return;
      input.value = 'shared term';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-action="belongings-page-next"]')?.click();
    })()`);
    await sleep(180);
    assert("household-belongings-next-page-replaces-window", await evalPage<boolean>(`(() => {
      const rows = [...document.querySelectorAll('#belongings-list .row')];
      const status = document.querySelector('[data-testid="belongings-window-status"]')?.textContent ?? '';
      return rows.length <= 100 && /101.*200.*2,000|101.*200.*2000/.test(status)
        && document.activeElement === rows[0]
        && rows[0].getBoundingClientRect().top < innerHeight
        && rows[0].getBoundingClientRect().bottom > 0;
    })()`));
    const belongingsPagination = await evalPage<{ maxRows: number; pages: number; finalRows: number; finalFocusVisible: boolean; hasNext: boolean }>(`new Promise((resolve) => {
      let maxRows = document.querySelectorAll('#belongings-list .row').length;
      let pages = 2;
      let button = document.querySelector('[data-action="belongings-page-next"]');
      while (button instanceof HTMLButtonElement && pages < 100) {
        button.click();
        pages += 1;
        maxRows = Math.max(maxRows, document.querySelectorAll('#belongings-list .row').length);
        button = document.querySelector('[data-action="belongings-page-next"]');
      }
      requestAnimationFrame(() => {
        const rows = [...document.querySelectorAll('#belongings-list .row')];
        const active = document.activeElement;
        const rect = active instanceof HTMLElement ? active.getBoundingClientRect() : null;
        resolve({ maxRows, pages, finalRows: rows.length, finalFocusVisible: active === rows[0] && !!rect && rect.top < innerHeight && rect.bottom > 0, hasNext: Boolean(document.querySelector('[data-action="belongings-page-next"]')) });
      });
    })`);
    assert("household-belongings-pagination-keeps-hard-dom-cap", belongingsPagination.maxRows <= 100 && belongingsPagination.pages === 20 && belongingsPagination.finalRows === 100 && belongingsPagination.finalFocusVisible && !belongingsPagination.hasNext, JSON.stringify(belongingsPagination));

    await evalPage(`window.nestory.openContainer("entry-tray")`);
    await sleep(100);
    const householdContainerDom = await evalPage<{ rows: number; elements: number; status: string }>(`(() => ({
      rows: document.querySelectorAll('[data-testid="container-item-row"]').length,
      elements: document.querySelector('[data-testid="container-modal"]')?.querySelectorAll('*').length ?? 0,
      status: document.querySelector('[data-testid="container-items-window-status"]')?.textContent ?? ''
    }))()`);
    assert("household-container-modal-dom-is-bounded", householdContainerDom.rows <= 100 && householdContainerDom.elements <= 2_500 && /100.*2,0[0-9]{2}|100.*20[0-9]{2}/.test(householdContainerDom.status), JSON.stringify(householdContainerDom));
    assert("household-container-filter-searches-full-truth", await evalPage<boolean>(`(() => {
      const input = document.getElementById('container-items-query');
      if (!(input instanceof HTMLInputElement)) return false;
      input.value = 'Scale item 1999';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById('container-items-window')?.textContent?.includes('Scale item 1999') ?? false;
    })()`));
    const containerNextPage = await evalPage<boolean>(`new Promise((resolve) => {
      const input = document.getElementById('container-items-query');
      if (!(input instanceof HTMLInputElement)) { resolve(false); return; }
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-action="container-items-page-next"]')?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const rows = [...document.querySelectorAll('[data-testid="container-item-row"]')];
        const status = document.querySelector('[data-testid="container-items-window-status"]')?.textContent ?? '';
        resolve(rows.length <= 100 && /101.*200/.test(status) && document.activeElement === rows[0]?.querySelector('[data-action="locate-item"]'));
      }));
    })`);
    assert("household-container-next-page-replaces-window-and-focuses-first-action", containerNextPage);
    await evalPage(`document.querySelector('[data-action="close-modal"]')?.click()`);

    await evalPage(`window.nestory.setView("ledger")`);
    await sleep(120);
    const householdLedgerDom = await evalPage<{ rows: number; elements: number; status: string }>(`(() => ({
      rows: document.querySelectorAll('[data-testid="commit-row"]').length,
      elements: document.querySelector('[data-testid="view-ledger"]')?.querySelectorAll('*').length ?? 0,
      status: document.querySelector('[data-testid="ledger-window-status"]')?.textContent ?? ''
    }))()`);
    assert("household-ledger-dom-is-bounded", householdLedgerDom.rows <= 100 && householdLedgerDom.elements <= 3_000, JSON.stringify(householdLedgerDom));
    assert("household-ledger-shows-window-status", /100.*8,0[0-9]{2}|100.*80[0-9]{2}/.test(householdLedgerDom.status), householdLedgerDom.status);
    const ledgerPagination = await evalPage<{ maxRows: number; pages: number; finalRows: number; finalFocusVisible: boolean; finalStatus: string; hasNext: boolean }>(`new Promise((resolve) => {
      let maxRows = document.querySelectorAll('[data-testid="commit-row"]').length;
      let pages = 1;
      let button = document.querySelector('[data-action="ledger-page-next"]');
      while (button instanceof HTMLButtonElement && pages < 100) {
        button.click();
        pages += 1;
        maxRows = Math.max(maxRows, document.querySelectorAll('[data-testid="commit-row"]').length);
        button = document.querySelector('[data-action="ledger-page-next"]');
      }
      requestAnimationFrame(() => {
        const rows = [...document.querySelectorAll('[data-testid="commit-row"]')];
        const active = document.activeElement;
        const rect = active instanceof HTMLElement ? active.getBoundingClientRect() : null;
        resolve({
          maxRows,
          pages,
          finalRows: rows.length,
          finalFocusVisible: active === rows[0] && !!rect && rect.top < innerHeight && rect.bottom > 0,
          finalStatus: document.querySelector('[data-testid="ledger-window-status"]')?.textContent ?? '',
          hasNext: Boolean(document.querySelector('[data-action="ledger-page-next"]'))
        });
      });
    })`);
    assert("household-ledger-pagination-keeps-hard-dom-cap-and-focuses-final-page", ledgerPagination.maxRows <= 100 && ledgerPagination.pages >= 80 && ledgerPagination.pages < 100 && ledgerPagination.finalRows > 0 && ledgerPagination.finalRows <= 100 && ledgerPagination.finalFocusVisible && !ledgerPagination.hasNext && ledgerPagination.finalStatus.includes("of"), JSON.stringify(ledgerPagination));

    await evalPage(`window.nestory.setView("review")`);
    await sleep(120);
    const householdReviewDom = await evalPage<{ cards: number; elements: number; status: string }>(`(() => ({
      cards: document.querySelectorAll('[data-testid="proposal-card"]').length,
      elements: document.querySelector('[data-testid="view-review"]')?.querySelectorAll('*').length ?? 0,
      status: document.querySelector('[data-testid="review-window-status"]')?.textContent ?? ''
    }))()`);
    assert("household-review-dom-is-bounded", householdReviewDom.cards <= 20 && householdReviewDom.elements <= 3_000, JSON.stringify(householdReviewDom));
    assert("household-review-shows-window-status", /20.*122/.test(householdReviewDom.status), householdReviewDom.status);
    const reviewPagination = await evalPage<{ maxCards: number; pages: number; finalCards: number; finalFocusVisible: boolean; hasNext: boolean }>(`new Promise((resolve) => {
      let maxCards = document.querySelectorAll('[data-testid="proposal-card"]').length;
      let pages = 1;
      let button = document.querySelector('[data-action="review-page-next"]');
      while (button instanceof HTMLButtonElement && pages < 100) {
        button.click();
        pages += 1;
        maxCards = Math.max(maxCards, document.querySelectorAll('[data-testid="proposal-card"]').length);
        button = document.querySelector('[data-action="review-page-next"]');
      }
      requestAnimationFrame(() => {
        const cards = [...document.querySelectorAll('[data-testid="proposal-card"]')];
        const active = document.activeElement;
        const rect = active instanceof HTMLElement ? active.getBoundingClientRect() : null;
        resolve({ maxCards, pages, finalCards: cards.length, finalFocusVisible: active === cards[0] && !!rect && rect.top < innerHeight && rect.bottom > 0, hasNext: Boolean(document.querySelector('[data-action="review-page-next"]')) });
      });
    })`);
    assert("household-review-pagination-keeps-hard-dom-cap", reviewPagination.maxCards <= 20 && reviewPagination.pages === 7 && reviewPagination.finalCards === 2 && reviewPagination.finalFocusVisible && !reviewPagination.hasNext, JSON.stringify(reviewPagination));

    const householdUiDomCommitP95 = await evalPage<number>(`(() => {
      const samples = [];
      for (let index = 0; index < 40; index += 1) {
        const view = index % 2 ? 'belongings' : 'ledger';
        const started = performance.now();
        window.nestory.setView(view);
        document.querySelector('[data-testid="view-' + view + '"]')?.getBoundingClientRect();
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.ceil(samples.length * 0.95) - 1] ?? 0;
    })()`);
    browserReport.householdUiDomCommitP95Ms = householdUiDomCommitP95;

    // ----- Own home mode: welcome -> empty graph -> guided setup -----
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await evalPage(`window.nestory.chooseMode("own")`).catch(() => null);
    await sleep(700);
    await waitForApp();
    assert("own-mode-boots-empty", await evalPage<boolean>(`window.nestory.mode === "own" && window.nestory.store.state.rooms.size === 0`));
    assert("own-mode-opens-setup", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="view-setup"]'))`));
    assert("own-activation-checklist", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="activation-checklist"]'))`));
    await shot("nestory-setup.png");

    // Drive a minimal onboarding through the public hooks and watch the checklist complete.
    await evalPage(`(() => {
      const s = window.nestory.store;
      const roomId = s.createRoom({ name: "Bedroom" });
      const shelfId = s.createContainer({ name: "Closet shelf", kind: "shelf", roomId });
      for (let i = 1; i <= 10; i += 1) s.createBelonging({ name: "Own item " + i, kinds: ["misc"], defaultHome: { type: "container", id: shelfId } });
      s.startOperation("move");
    })()`);
    assert("own-activation-completes-in-dom", await evalPage<boolean>(`document.querySelector('[data-testid="activation-checklist"]')?.textContent?.includes("activated") ?? false`));
    await evalPage(`window.nestory.setView("plan")`);
    assert("own-plan-renders", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="plan-svg"]')) || Boolean(document.querySelector('[data-testid="plan-3d"]'))`));
    await shot("nestory-own-home.png");

    await evalPage(`(() => {
      const raw = localStorage.getItem('nestory-v2-own');
      if (raw === null) throw new Error('missing own-home recovery fixture');
      localStorage.setItem('nestory-v2-own-test-backup', raw);
      localStorage.setItem('nestory-v2-own', '{ deliberately corrupt recovery fixture');
      location.reload();
    })()`);
    let recoveryVisible = false;
    for (let index = 0; index < 80; index += 1) {
      recoveryVisible = await evalPage<boolean>(`Boolean(document.querySelector('.boot-error[role="alert"]'))`).catch(() => false);
      if (recoveryVisible) break;
      await sleep(100);
    }
    assert("corrupt-browser-storage-opens-actionable-recovery-shell", recoveryVisible && await evalPage<boolean>(`(() => {
      const raw = localStorage.getItem('nestory-v2-own');
      const alert = document.querySelector('.boot-error[role="alert"]');
      return raw === '{ deliberately corrupt recovery fixture'
        && getComputedStyle(document.getElementById('sidebar')).display === 'none'
        && getComputedStyle(document.getElementById('topbar')).display === 'none'
        && Boolean(alert?.textContent?.includes('has not replaced or cleared'))
        && Boolean(alert?.querySelector('[data-boot-action="download"]'))
        && Boolean(alert?.querySelector('[data-boot-action="switch"]'))
        && Boolean(alert?.querySelector('[data-boot-action="clear"]'));
    })()`));
    await shot("nestory-boot-recovery.png");
    await evalPage(`(() => {
      const backup = localStorage.getItem('nestory-v2-own-test-backup');
      if (backup === null) throw new Error('missing recovery backup');
      localStorage.setItem('nestory-v2-own', backup);
      localStorage.removeItem('nestory-v2-own-test-backup');
      location.reload();
    })()`);
    await sleep(500);
    await waitForApp();
    assert("browser-recovery-copy-restores-own-home", await evalPage<boolean>(`window.nestory.mode === 'own' && window.nestory.store.state.rooms.size >= 1`));

    browserReport.ran = true;
  } finally {
    try { cdp?.close(); } catch { /* noop */ }
    const chromeExited = chrome.exitCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => { chrome.once("exit", () => resolve()); });
    chrome.kill();
    await Promise.all([
      chromeExited,
      new Promise<void>((resolve) => { server.close(() => resolve()); })
    ]);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

try {
  await runBrowserSmoke();
} catch (err) {
  failures += 1;
  const detail = err instanceof Error ? err.message : String(err);
  results.push({ section: "browser smoke", id: "browser-smoke-crashed", ok: false, detail });
  console.error(`  ✗ browser smoke crashed — ${detail}`);
}

// =====================================================================
// Report
// =====================================================================

const report = {
  generatedAt: new Date().toISOString(),
  prd: "docs/nestory-v1-prd.md",
  runtime: `node ${process.version} · typescript strict`,
  total: results.length,
  passed: results.filter((r) => r.ok).length,
  failed: failures,
  browser: browserReport,
  assertions: results
};
await writeFile(new URL("verification-report.json", renderDir), JSON.stringify(report, null, 2));

const bySection = new Map<string, AssertionResult[]>();
for (const r of results) {
  const rows = bySection.get(r.section) ?? [];
  rows.push(r);
  bySection.set(r.section, rows);
}
const md = [
  "# Nestory V2 Verification Report",
  "",
  `Generated: ${report.generatedAt}`,
  `Runtime: ${report.runtime}`,
  "",
  `- Assertions: ${report.total}`,
  `- Passed: ${report.passed}`,
  `- Failed: ${report.failed}`,
  `- Browser smoke: ${browserReport.ran ? "ran" : `skipped (${browserReport.skipped ?? "crashed"})`}`,
  browserReport.uiDomCommitP95Ms === null ? "" : `- UI DOM-commit p95: ${browserReport.uiDomCommitP95Ms.toFixed(3)} ms`,
  browserReport.householdUiDomCommitP95Ms === null ? "" : `- Household UI DOM-commit p95: ${browserReport.householdUiDomCommitP95Ms.toFixed(3)} ms`,
  "- Presentation latency is measured separately by `npm run browser-benchmark`; this correctness harness does not treat headless RAF scheduling as paint evidence.",
  browserReport.settledSpatialRafCallbacks === null ? "" : `- Settled spatial RAF callbacks observed: ${browserReport.settledSpatialRafCallbacks}`,
  browserReport.screenshots.length ? `- Screenshots: ${browserReport.screenshots.join(", ")}` : "",
  "",
  ...[...bySection.entries()].flatMap(([name, rows]) => [
    `## ${name}`,
    "",
    ...rows.map((r) => `- ${r.ok ? "✓" : "✗"} \`${r.id}\`${r.ok ? "" : ` — ${r.detail}`}`),
    ""
  ]),
  "## Loop command",
  "",
  "```bash",
  "cd prototype-v2 && node src/verify.ts",
  "```",
  ""
].filter((line) => line !== "").join("\n");
await writeFile(new URL("verification-report.md", renderDir), md);

console.log(`\n${report.passed}/${report.total} assertions passed. Reports written to prototype-v2/renders/.`);
process.exit(failures ? 1 : 0);
