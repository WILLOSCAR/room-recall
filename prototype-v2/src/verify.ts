// Nestory V2 verification harness (TypeScript).
// 0. Gate: `npx tsc` must typecheck and emit dist/ for the browser.
// 1. Node-native assertions against store.ts, mapped to docs/nestory-v1-prd.md §5.
//    (Runs directly on Node >= 23.6 via type stripping — no build needed for logic.)
// 2. Headless Chrome smoke (self-served static files + CDP) with screenshots.
// Usage: node src/verify.ts    (from prototype-v2/, after `npm install` once)

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { catalog, buildSeedRecords, emptyCatalog } from "./data.ts";
import { createStore } from "./store.ts";
import { createAgentToolkit } from "./agent.ts";
import type { AgentToolkit } from "./agent.ts";
import { ask } from "./ask.ts";
import { runAgentTurn } from "./agent-runtime.ts";
import type { LlmFn, LlmReply } from "./agent-runtime.ts";
import { fileStorage, startNestoryServer } from "./server.ts";
import { runAgentEval, formatEvalReport, EVAL_JOBS } from "./agent-eval.ts";
import type { EvalJob } from "./agent-eval.ts";
import type {
  KitOperationView, LocateAnswer, LocateSuccess, MoveOperationView, StorageLike, Store, StoreOptions
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

function expectOk(answer: ReturnType<Store["locate"]>): LocateSuccess {
  if (!answer.ok) throw new Error(`Expected a successful locate answer, got: ${answer.sentence}`);
  return answer;
}

function expectKit(store: Store, opId: string): KitOperationView {
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
  const moveOp = store.operationsView().find((o): o is MoveOperationView => o.type === "move");
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

  store.unpackItem("medicine-kit");
  const medAfter = store.belongingView("medicine-kit");
  assert("unpack-returns-to-default-home", medAfter?.state === "at_home" && medAfter.atDefaultHome === true, medAfter?.chainText);
  assert("empty-box-auto-unpacked", store.state.containers.get(boxId)?.boxStatus === "unpacked");
  assert("unpack-history-preserved", medAfter?.history.length === 3 && medAfter.history[1]?.contradictedReason === "unpacked");
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
  const store3 = fresh();
  store3.importJson(dump);
  assert("import-round-trip", store3.searchBelongings("yoga mat")[0]?.name === "Yoga mat");

  const ledger = store3.commitsView();
  const newest = ledger[0];
  const oldest = ledger[ledger.length - 1];
  assert("ledger-newest-first", !!newest && !!oldest && new Date(newest.at) >= new Date(oldest.at));
  assert("ledger-ops-summaries", ledger.every((c) => Array.isArray(c.ops) && typeof c.summary === "string"));

  store3.reset();
  assert("reset-ledgered", store3.commitsView()[0]?.summary === "Reset home memory to seed");
  assert("reset-back-to-seed", store3.proposals().length === 2 && !store3.searchBelongings("yoga mat").length);
});

// =====================================================================
// P0.8b Import is a trust boundary
// =====================================================================
// `importJson` replaces the entire home memory from an outside dump. Three
// contracts, each asserted against real store behaviour rather than types:
//   A1 a legitimate export still round-trips,
//   A2 a malformed dump is refused with a path-named error,
//   A3 a refused dump changes NOTHING — records, seq, and persisted storage.
// Scope note: this validates record SHAPE. Referential integrity (does this room
// exist? does this itemId resolve?) is a separate contract over the catalog and the
// existing ledger, and is NOT covered here — the cases below say so explicitly
// rather than pretending shape validation catches them.
section("P0.8b import trust boundary", () => {
  // ---- A1 — a legitimate export is still accepted, unchanged.
  // The source is MUTATED first, so the dump genuinely differs from the target's
  // starting state. Without this the two stores are seeded identically and the
  // assertion would pass even if importJson did nothing at all.
  const source = fresh();
  source.createBelonging({ name: "Round-trip marker", kinds: ["marker"], defaultHome: { type: "room", id: "bedroom" } });
  const goodDump = source.exportJson();
  const target = fresh();
  const targetBefore = JSON.stringify(target.exportJson().records);
  assert("import-roundtrip-fixture-actually-differs",
    targetBefore !== JSON.stringify(goodDump.records),
    "the dump must differ from the target's initial state or A1 proves nothing");
  target.importJson(goodDump);
  assert("import-accepts-legitimate-export",
    JSON.stringify(target.exportJson().records) === JSON.stringify(goodDump.records)
      && target.searchBelongings("round-trip marker").length === 1,
    `${goodDump.records.length} records, marker present`);

  // ---- A2 — malformed / untrusted shapes are refused, each with a path-named error.
  // On the base version five of these were accepted silently; the null-record, bare-string
  // and unknown-recordType cases DID throw, but only downstream in derive() — after the
  // records had already been replaced and persisted (66 -> 1). So all eight were unsafe,
  // three of them loudly rather than silently.
  const rejected = (payload: unknown): { threw: boolean; message: string } => {
    const store = fresh();
    try { store.importJson(payload); return { threw: false, message: "" }; }
    catch (err) { return { threw: true, message: err instanceof Error ? err.message : String(err) }; }
  };
  const commitWith = (ops: unknown): unknown =>
    ({ version: 2, records: [{ recordType: "commit", id: "c1", at: "2026-01-01T00:00:00.000Z", summary: "x", ops }] });

  const unknownOp = rejected(commitWith([{ type: "drop_database" }]));
  assert("import-rejects-unknown-commit-op", unknownOp.threw && /\.type has unsupported value/.test(unknownOp.message), unknownOp.message);

  const opsNotArray = rejected(commitWith("everything"));
  assert("import-rejects-non-array-ops", opsNotArray.threw && /\.ops must be an array/.test(opsNotArray.message), opsNotArray.message);

  const badConfidence = rejected(commitWith([
    { type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "bedroom" }, relation: "inside", confidence: 99 },
  ]));
  assert("import-rejects-out-of-range-confidence", badConfidence.threw && /confidence must be between 0 and 1/.test(badConfidence.message), badConfidence.message);

  const badTimestamp = rejected({ version: 2, records: [
    { recordType: "evidence", id: "e1", kind: "user_confirmation", summary: "x", at: "whenever" },
  ] });
  assert("import-rejects-invalid-timestamp", badTimestamp.threw && /\.at must be a valid ISO timestamp/.test(badTimestamp.message), badTimestamp.message);

  const nullRecord = rejected({ version: 2, records: [null] });
  assert("import-rejects-null-record", nullRecord.threw && /must be an object/.test(nullRecord.message), nullRecord.message);

  const bareString = rejected({ version: 2, records: ["not-a-record"] });
  assert("import-rejects-bare-string-record", bareString.threw && /must be an object/.test(bareString.message), bareString.message);

  const unknownRecordType = rejected({ version: 2, records: [
    { recordType: "evil", id: "x", at: "2026-01-01T00:00:00.000Z" },
  ] });
  assert("import-rejects-unknown-record-type", unknownRecordType.threw && /\.recordType has unsupported value/.test(unknownRecordType.message), unknownRecordType.message);

  const duplicateId = rejected({ version: 2, records: [
    { recordType: "evidence", id: "dup", kind: "user_confirmation", summary: "a", at: "2026-01-01T00:00:00.000Z" },
    { recordType: "evidence", id: "dup", kind: "user_confirmation", summary: "b", at: "2026-01-01T00:00:00.000Z" },
  ] });
  assert("import-rejects-duplicate-record-id", duplicateId.threw && /duplicates/.test(duplicateId.message), duplicateId.message);

  const emptyDump = rejected({ version: 2, records: [] });
  assert("import-rejects-empty-dump", emptyDump.threw && /contains no records/.test(emptyDump.message), emptyDump.message);

  const versionless = rejected({ records: [] });
  assert("import-rejects-unsupported-version", versionless.threw && /unsupported schema version/.test(versionless.message), versionless.message);

  const notAnObject = rejected("a string, not a dump");
  assert("import-rejects-non-object-dump", notAnObject.threw && /must be an object/.test(notAnObject.message), notAnObject.message);

  // A field the type declares as `string | null` must be PRESENT. An absent key yields
  // an object violating its own type, and reads like `box?.operationId === opId` then
  // silently mismatch — detaching a box from its move operation.
  const boxMissingOperationId = rejected(commitWith([
    { type: "create_container", container: { id: "box-z", name: "Box Z", kind: "box", parent: { type: "room", id: "bedroom" }, box: { label: "L", destination: "D" } } },
  ]));
  assert("import-rejects-absent-required-nullable-field",
    boxMissingOperationId.threw && /must be present \(use null when empty\)/.test(boxMissingOperationId.message),
    boxMissingOperationId.message);

  // THE INVARIANT: whatever the store's own write path accepts, the import path must
  // accept back. Export is a backup; a validator stricter than the writer makes that
  // backup unrestorable. Three separate defects of exactly this shape were found in
  // review (over-cap names, blank summaries, an untrimmed box destination), each time on
  // a field the previous fix did not cover — so this drives every write method AT and
  // BEYOND its boundaries in one pass rather than pinning a few sample lengths.
  const selfInflicted: string[] = [];
  const roundTrips = (label: string, write: (store: Store) => void): void => {
    const writer = fresh();
    try { write(writer); } catch { return; } // the writer refusing its own input is fine
    const dump = JSON.parse(JSON.stringify(writer.exportJson())) as ReturnType<Store["exportJson"]>;
    try { fresh().importJson(dump); }
    catch (err) { selfInflicted.push(`${label}: ${err instanceof Error ? err.message : String(err)}`); }
  };
  const pad = (n: number): string => "x".repeat(n);
  const bedroom = { type: "room", id: "bedroom" } as const;
  for (const n of [1, 2, 2000, 2001, 5000]) {
    roundTrips(`createRoom name ${n}`, (st) => { st.createRoom({ name: pad(n) }); });
    roundTrips(`createBelonging name ${n}`, (st) => { st.createBelonging({ name: pad(n), kinds: ["k"], defaultHome: bedroom }); });
    roundTrips(`createBox label ${n}`, (st) => { st.createBox({ label: pad(n), destination: "New home" }); });
  }
  for (const blank of ["", " ", "\t", "   "]) {
    roundTrips(`createBox destination ${JSON.stringify(blank)}`, (st) => { st.createBox({ label: "Kitchen", destination: blank }); });
    roundTrips(`correctPlacement note ${JSON.stringify(blank)}`, (st) => { st.correctPlacement("passport", bedroom, { note: blank }); });
    roundTrips(`rejectProposal reason ${JSON.stringify(blank)}`, (st) => {
      const pending = st.proposals().find((pr) => pr.status === "pending");
      if (pending) st.rejectProposal(pending.id, blank);
    });
  }
  for (const k of [1, 500, 501]) {
    roundTrips(`kind length ${k}`, (st) => { st.createBelonging({ name: "K", kinds: [pad(k)], defaultHome: bedroom }); });
  }
  for (const count of [1, 500, 501]) {
    roundTrips(`kind count ${count}`, (st) => { st.createBelonging({ name: "K", kinds: Array.from({ length: count }, (_, i) => `k${i}`), defaultHome: bedroom }); });
  }
  for (const d of [{ width: 0.001, depth: 0.001, height: 0.001 }, { width: 1e6, depth: 1, height: 1 }]) {
    roundTrips(`dimensions ${JSON.stringify(d)}`, (st) => {
      st.createBelonging({ name: "D", kinds: ["k"], defaultHome: bedroom,
        dimensions: { ...d, unit: "m", source: "manual", verified: false } });
    });
  }
  for (const n of [1, 2000, 2001]) {
    roundTrips(`createContainer name ${n}`, (st) => { st.createContainer({ name: pad(n), kind: "tray", roomId: "bedroom" }); });
  }
  // The one asymmetry NOT resolved here, recorded rather than hidden. The writer accepts
  // impossible geometry — a negative belonging dimension and a zero-area room plan — which
  // import rejects as `must be positive`. Both are pre-existing write-path gaps (the base
  // store has no dimension guard at all), so bounding them means changing a write path
  // this slice does not own; dropping the import check instead would admit nonsense
  // geometry into the Place Graph. Left for a write-validation slice, pinned here so the
  // asymmetry is visible and this lock fails if either side changes.
  const geometryAsymmetry: string[] = [];
  const writeThenImport = (label: string, write: (store: Store) => void): void => {
    const w = fresh();
    try { write(w); } catch { return; }
    const dump = JSON.parse(JSON.stringify(w.exportJson())) as ReturnType<Store["exportJson"]>;
    try { fresh().importJson(dump); } catch { geometryAsymmetry.push(label); }
  };
  writeThenImport("negative belonging dimension", (st) => {
    st.createBelonging({ name: "Neg", kinds: ["k"], defaultHome: bedroom,
      dimensions: { width: -5, depth: 1, height: 1, unit: "m", source: "manual", verified: false } });
  });
  writeThenImport("zero-area room plan", (st) => { st.createRoom({ name: "Zero", plan: { x: 0, y: 0, w: 0, h: 0 } }); });
  assert("write-path-impossible-geometry-is-not-yet-bounded", geometryAsymmetry.length === 2,
    `documented gap: writer accepts what import refuses (${geometryAsymmetry.join(", ")}); write-validation slice`);

  assert("import-accepts-everything-the-write-path-writes", selfInflicted.length === 0,
    selfInflicted.length ? selfInflicted.slice(0, 4).join(" | ") : "no self-inflicted unimportable export across write-path boundaries");

  // The store writes "" for a blank rejection reason; refusing it here would make the
  // product's own export unreadable. Locks the round-trip end to end.
  const blankReason = fresh();
  const pendingProposal = blankReason.proposals().find((p) => p.status === "pending");
  if (pendingProposal) {
    blankReason.rejectProposal(pendingProposal.id, "");
    const blankDump = blankReason.exportJson();
    const blankTarget = fresh();
    let blankThrew = "";
    try { blankTarget.importJson(blankDump); } catch (err) { blankThrew = err instanceof Error ? err.message : String(err); }
    assert("import-accepts-store-written-empty-optional-string", blankThrew === "",
      blankThrew || "a blank reject reason still round-trips");
  }

  // `correctPlacement` passes a caller's note straight into an evidence `summary` with
  // only `??` guarding it, so "" and whitespace reach the ledger. Locked end to end
  // because a validator that demanded non-empty summaries would make the product's own
  // export permanently unreadable — the same class as the long-name and blank-reason
  // cases above, on a different field.
  for (const blankNote of ["", "   "]) {
    const noted = fresh();
    noted.correctPlacement("passport", { type: "room", id: "bedroom" }, { note: blankNote });
    const notedDump = JSON.parse(JSON.stringify(noted.exportJson())) as ReturnType<Store["exportJson"]>;
    const notedTarget = fresh();
    let notedThrew = "";
    try { notedTarget.importJson(notedDump); } catch (err) { notedThrew = err instanceof Error ? err.message : String(err); }
    assert(`import-accepts-store-written-blank-summary-${blankNote === "" ? "empty" : "whitespace"}`,
      notedThrew === "", notedThrew || "a blank correctPlacement note still round-trips");
  }

  // ---- A2 boundary, stated honestly: NOT covered by shape validation.
  // A structurally perfect reference to a room that does not exist is a
  // REFERENTIAL INTEGRITY problem, not a field-shape problem. Shape validation
  // accepts it, and this assertion pins that limit so a later reader cannot mistake
  // this batch for full import validation. Closing it needs cross-record semantics
  // over the catalog + existing ledger — a separate contract, deliberately not here.
  const nonexistentRoom = rejected(commitWith([
    { type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "room-does-not-exist" }, relation: "inside", confidence: 1 },
  ]));
  assert("import-shape-does-not-yet-check-place-existence", nonexistentRoom.threw === false,
    "documented gap: referential integrity is a separate contract, not shape validation");

  // Second documented gap, pinned for the same reason: `loadRecords` deserialises
  // localStorage, which is equally user-writable, and is NOT validated by this change.
  // Hardening it changes boot behaviour for anyone holding an already-invalid store, so
  // it is a separate slice. This lock records the limit instead of implying it is closed.
  // The fixture must be something the validator genuinely REFUSES, so this lock fails the
  // moment the gap is closed. A well-formed fixture would pass either way and prove
  // nothing. `set_box_status` with an unsupported status is invalid shape but still
  // derives without crashing, so the assertion observes acceptance rather than a throw.
  const invalidForImport = { version: 2, records: [
    { recordType: "commit", id: "tampered", at: "2026-01-01T00:00:00.000Z", summary: "x",
      ops: [{ type: "set_box_status", boxId: "box-essentials", status: "teleported" }] },
  ] };
  let importRefusesFixture = false;
  try { fresh().importJson(invalidForImport); } catch { importRefusesFixture = true; }
  assert("load-from-storage-fixture-is-genuinely-invalid", importRefusesFixture,
    "the storage-gap fixture must be refused by importJson or the gap lock proves nothing");
  const tamperedStorage = memStorage();
  tamperedStorage.setItem("nestory-v2", JSON.stringify(invalidForImport));
  const fromStorage = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: tamperedStorage });
  assert("load-from-storage-is-not-yet-validated", fromStorage.exportJson().records.length === 1,
    "documented gap: loadRecords accepts what importJson refuses; separate slice");

  // ---- A3 — a refused import leaves records, seq, and STORAGE untouched.
  // This is the contract that matters most: before the fix, a rejected dump had
  // already replaced 66 records with 1 and written that to storage.
  const storage = memStorage();
  const guarded = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage });
  // One real write FIRST: createStore never persists on construction, so without this
  // `persistedBefore` would be null and the storage assertion would compare null to
  // null — passing even if a refused import wrote garbage.
  guarded.createBelonging({ name: "Persist primer", kinds: ["primer"], defaultHome: { type: "room", id: "bedroom" } });
  const beforeCount = guarded.exportJson().records.length;
  const beforeIds = guarded.exportJson().records.map((r) => r.id).join(",");
  const persistedBefore = storage.getItem("nestory-v2");
  assert("import-refusal-fixture-has-real-persisted-state",
    typeof persistedBefore === "string" && persistedBefore.length > 0,
    "storage must hold real content before the refusal or the storage lock proves nothing");
  let refusedMessage = "";
  try { guarded.importJson(commitWith([{ type: "drop_database" }])); }
  catch (err) { refusedMessage = err instanceof Error ? err.message : String(err); }
  const afterRecords = guarded.exportJson().records;
  const persistedAfter = storage.getItem("nestory-v2");
  assert("import-refusal-leaves-records-unchanged",
    refusedMessage !== "" && afterRecords.length === beforeCount && afterRecords.map((r) => r.id).join(",") === beforeIds,
    `${beforeCount} -> ${afterRecords.length}`);
  assert("import-refusal-writes-nothing-to-storage",
    persistedAfter === persistedBefore,
    `persisted changed: ${persistedBefore !== persistedAfter}`);
  // seq is observable ONLY through the id the store mints next (ids are
  // `prefix-<seq base36>-<random>`); it never affects the record count. Compare the
  // minted seq segment against an untouched store at the same point, so a refused
  // import that silently reset seq is caught.
  const seqOf = (mintedId: string): string => mintedId.split("-")[1] ?? "";
  const control = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: memStorage() });
  control.createBelonging({ name: "Persist primer", kinds: ["primer"], defaultHome: { type: "room", id: "bedroom" } });
  const controlSeq = seqOf(control.createBelonging({ name: "Seq probe", kinds: ["probe"], defaultHome: { type: "room", id: "bedroom" } }));
  const guardedSeq = seqOf(guarded.createBelonging({ name: "Seq probe", kinds: ["probe"], defaultHome: { type: "room", id: "bedroom" } }));
  assert("import-refusal-leaves-seq-unchanged",
    guardedSeq !== "" && guardedSeq === controlSeq,
    `minted seq after refusal ${guardedSeq} vs untouched control ${controlSeq}`);

  // A successful import after a refused one still works — the guard is not sticky.
  // Uses the MUTATED dump so the marker's arrival proves the import actually ran.
  const recovered = fresh();
  try { recovered.importJson({ version: 2, records: [null] }); } catch { /* expected refusal */ }
  recovered.importJson(goodDump);
  assert("import-recovers-after-refusal",
    recovered.exportJson().records.length === goodDump.records.length
      && recovered.searchBelongings("round-trip marker").length === 1,
    "a refused import does not block a later good one");
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

    const allowed = await runAgentTurn({ toolkit, llm: scripted(decisionReplies()), userText: "yes, accept it", allowDecisionTools: true });
    assert("runtime-decision-allowed-explicitly", allowed.events.some((e) => e.kind === "tool_call" && !e.isError) && store.proposals().length === 1);
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

  const help = ask(store, toolkit, "???");
  assert("ask-help-fallback", help.intent === "help" && help.toolCalls.length === 0);
});

// =====================================================================
// P0.10 Local sync service: file-backed HTTP API over the Store
// =====================================================================
setSection("P0.10 sync service");
try {
  const dataPath = join(tmpdir(), `nestory-sync-${Date.now()}.json`);
  const makeFileStore = (): Store =>
    createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: fileStorage(dataPath) });
  const getJson = async (base: string, path: string): Promise<{ status: number; body: Record<string, unknown> & { length?: number } }> => {
    const r = await fetch(base + path);
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };
  const postJson = async (base: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };

  const server1 = await startNestoryServer({ store: makeFileStore(), port: 0 });

  const health = await getJson(server1.url, "/health");
  assert("srv-health", health.status === 200 && health.body["ok"] === true && (health.body["tools"] as number) >= 12, health.body);

  const locate = await getJson(server1.url, "/locate?q=water%20bottle");
  assert("srv-locate-view", locate.body["ok"] === true && locate.body["chainText"] === "Desk top · Desk · Bedroom", locate.body["chainText"]);

  const contents = await getJson(server1.url, "/containers/wardrobe-second-drawer/contents");
  const items = contents.body["items"] as Array<{ id: string }>;
  assert("srv-container-contents", Array.isArray(items) && items.some((i) => i.id === "black-training-shirt"));
  assert("srv-unknown-container-404", (await getJson(server1.url, "/containers/nope/contents")).status === 404);

  const askRes = await postJson(server1.url, "/ask", { text: "where is my water bottle?" });
  assert("srv-ask", askRes.status === 200 && String(askRes.body["text"]).includes("Desk top"), askRes.body["text"]);

  const snap = await postJson(server1.url, "/tools/snapshot_container", { args: { container_id: "entry-tray", seen_text: "usb-c charger" } });
  const proposalId = (snap.body["result"] as { proposalId?: string } | undefined)?.proposalId;
  assert("srv-tool-write", snap.status === 200 && typeof proposalId === "string");
  const pending1 = await getJson(server1.url, "/proposals");
  assert("srv-proposals-grow", Array.isArray(pending1.body) && (pending1.body as unknown as unknown[]).length === 3);

  const deny = await postJson(server1.url, "/tools/accept_proposal", { args: { proposal_id: proposalId } });
  assert("srv-decision-403-without-confirm", deny.status === 403, deny.body["error"]);
  const allow = await postJson(server1.url, "/tools/accept_proposal", { args: { proposal_id: proposalId }, confirmed: true });
  const pending2 = await getJson(server1.url, "/proposals");
  assert("srv-decision-confirmed-applies", allow.status === 200 && (pending2.body as unknown as unknown[]).length === 2);

  assert("srv-unknown-tool-404", (await postJson(server1.url, "/tools/no_such_tool", {})).status === 404);
  assert("srv-unknown-route-404", (await getJson(server1.url, "/nope")).status === 404);

  const exported = await getJson(server1.url, "/export");
  assert("srv-export-schema", exported.body["version"] === 2 && Array.isArray(exported.body["records"]));

  await server1.close();

  // Restart durability: a new store over the same file must see the accepted correction.
  const server2 = await startNestoryServer({ store: makeFileStore(), port: 0 });
  const relocate = await getJson(server2.url, "/locate?q=usb-c%20charger");
  assert("srv-restart-durable", String(relocate.body["chainText"]).includes("Entry tray"), relocate.body["chainText"]);
  const pendingAfterRestart = await getJson(server2.url, "/proposals");
  assert("srv-restart-proposals-intact", (pendingAfterRestart.body as unknown as unknown[]).length === 2);
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
}

const browserReport: BrowserReport = { ran: false, skipped: null, screenshots: [] };

interface CdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}

async function runBrowserSmoke(): Promise<void> {
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
    await shot("nestory-welcome.png");

    // Choose the demo home (persists mode + reloads the page).
    await evalPage(`window.nestory.chooseMode("demo")`).catch(() => null);
    await sleep(700);
    await waitForApp();
    assert("demo-mode-boots", (await evalPage<string | null>("window.nestory.mode")) === "demo");

    for (const view of ["home", "spaces", "belongings", "operations", "review", "plan", "ledger"]) {
      await evalPage(`window.nestory.setView(${JSON.stringify(view)})`);
      assert(`view-renders-${view}`, await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="view-${view}"]'))`));
    }

    await evalPage(`window.nestory.setView("home")`);
    const sentence = await evalPage<string>(`window.nestory.locate("water bottle").sentence`);
    assert("dom-locate-answer", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="answer-card"]')?.textContent?.includes("Desk top"))`), sentence);
    await shot("nestory-home.png");

    const pendingCount = await evalPage<number>(`window.nestory.store.proposals("pending").length`);
    assert("dom-review-badge", (await evalPage<string | undefined>(`document.querySelector('[data-testid="review-badge"]')?.textContent`)) === String(pendingCount));
    await evalPage(`window.nestory.setView("review")`);
    assert("dom-proposal-cards", (await evalPage<number>(`document.querySelectorAll('[data-testid="proposal-card"]').length`)) === pendingCount);
    await shot("nestory-review.png");

    const moveOpId = await evalPage<string>(`window.nestory.store.operationsView().find((o) => o.type === "move").id`);
    await evalPage(`window.nestory.openOperation(${JSON.stringify(moveOpId)})`);
    assert("dom-move-detail", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="move-detail"]'))`));
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
    await shot("nestory-plan-3d.png");
    await evalPage(`window.nestory.ui.planMode = "2d"; window.nestory.render()`);
    assert("dom-plan-pin", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="plan-pin"]'))`));
    await shot("nestory-plan.png");

    await evalPage(`window.nestory.setView("capture")`);
    assert("dom-capture-room", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="view-capture"]'))`));
    await evalPage(`document.querySelector('[data-action="run-room-scan"]')?.click()`);
    await sleep(420);
    assert("dom-scan-proposals", (await evalPage<number>(`document.querySelectorAll('[data-testid="scan-proposal"]').length`)) === 4);
    assert("dom-scan-3d-canvas", await evalPage<boolean>(`Boolean(document.querySelector('[data-spatial-scene="scan"] canvas[data-spatial-scene-canvas="true"]'))`));
    await shot("nestory-capture-scan.png");

    await evalPage(`window.nestory.setView("spaces")`);
    assert("dom-container-cards", (await evalPage<number>(`document.querySelectorAll('[data-testid="container-card"]').length`)) >= 10);
    await evalPage(`window.nestory.openContainer("wardrobe-second-drawer")`);
    assert("dom-container-modal", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="container-modal"]')?.textContent?.includes("Black training shirt"))`));
    await evalPage(`window.nestory.setView("spaces")`);
    await shot("nestory-spaces.png");

    // Photo evidence renders in the review inbox (data URL injected via the store).
    await evalPage(`window.nestory.store.snapshotContainer("entry-tray", "usb-c charger", { dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", width: 1, height: 1 })`);
    await evalPage(`window.nestory.setView("review")`);
    assert("dom-proposal-photo", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="proposal-photo"]'))`));

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
    assert("dom-ask-shows-tool-call", await evalPage<boolean>(`Boolean(document.querySelector('[data-testid="ask-log"]')?.textContent?.includes("locate_item"))`));
    await shot("nestory-ask.png");

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const view of ["home", "capture", "plan", "operations", "spaces", "setup", "ask"]) {
      await evalPage(`window.nestory.setView(${JSON.stringify(view)})`);
      await sleep(120);
      const overflow = await evalPage<boolean>(`document.documentElement.scrollWidth > window.innerWidth + 2`);
      assert(`mobile-no-overflow-${view}`, overflow === false);
    }
    await evalPage(`window.nestory.setView("home")`);
    await shot("nestory-mobile-home.png");

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

    browserReport.ran = true;
  } finally {
    try { cdp?.close(); } catch { /* noop */ }
    chrome.kill();
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
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
