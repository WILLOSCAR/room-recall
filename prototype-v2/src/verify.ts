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
import { validatedLedgerRecords } from "./ledger-validation.ts";
import { ROW_STATUSES } from "./types.ts";
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
  // Export -> import is only half the question. The BOOT path now runs the same two
  // passes, so a writer whose output boot refuses loses the person's work on reload
  // rather than merely failing an export. That is how the geometry regression reached a
  // green suite, so every write below is also driven through a real storage round trip:
  // write, construct a NEW store from the storage the write produced, and require the
  // records to come back with no recovery.
  const lostOnReload: string[] = [];
  const roundTrips = (label: string, write: (store: Store) => void): void => {
    const writer = fresh();
    try { write(writer); } catch { return; } // the writer refusing its own input is fine
    const dump = JSON.parse(JSON.stringify(writer.exportJson())) as ReturnType<Store["exportJson"]>;
    try { fresh().importJson(dump); }
    catch (err) { selfInflicted.push(`${label}: ${err instanceof Error ? err.message : String(err)}`); }

    const storage = memStorage();
    const persisted = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage });
    try { write(persisted); } catch { return; }
    const wrote = persisted.exportJson().records.length;
    const rebooted = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage });
    const recovered = rebooted.storageRecovery();
    if (recovered !== null || rebooted.exportJson().records.length !== wrote) {
      lostOnReload.push(`${label}: wrote ${wrote}, reloaded ${rebooted.exportJson().records.length}${recovered ? ` — ${recovered.reason}` : ""}`);
    }
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
  // This asymmetry is now CLOSED, and closing it was forced by the boot gate. The writer
  // used to accept impossible geometry — a negative belonging dimension, a zero-area room
  // plan — that import rejects. Harmless while only `importJson` enforced the rule; once
  // the BOOT path enforces it too, a reader stricter than its own writer means an ordinary
  // typo in the product's own form silently discards the person's work on the next reload.
  // Measured on the pre-fix candidate: write 68 records, reload, get 66 seed records back.
  // So the rule moved to the earliest owner, the write itself, where it can still be shown
  // to the person. This lock was written to fail when that happened; it now asserts the
  // positive contract instead.
  const geometryAsymmetry: string[] = [];
  const refusedAtWrite: string[] = [];
  const writeThenImport = (label: string, write: (store: Store) => void): void => {
    const w = fresh();
    try { write(w); } catch { refusedAtWrite.push(label); return; }
    const dump = JSON.parse(JSON.stringify(w.exportJson())) as ReturnType<Store["exportJson"]>;
    try { fresh().importJson(dump); } catch { geometryAsymmetry.push(label); }
  };
  writeThenImport("negative belonging dimension", (st) => {
    st.createBelonging({ name: "Neg", kinds: ["k"], defaultHome: bedroom,
      dimensions: { width: -5, depth: 1, height: 1, unit: "m", source: "manual", verified: false } });
  });
  writeThenImport("zero-area room plan", (st) => { st.createRoom({ name: "Zero", plan: { x: 0, y: 0, w: 0, h: 0 } }); });
  assert("write-path-impossible-geometry-is-refused-at-the-write",
    geometryAsymmetry.length === 0 && refusedAtWrite.length === 2,
    `writer must refuse impossible geometry outright (refused: ${refusedAtWrite.join(", ") || "none"}; still asymmetric: ${geometryAsymmetry.join(", ") || "none"})`);

  // The whole point of bounding the writer: work done through the product's own form must
  // survive a reload. Before the fix this lost the person's belonging on the next boot.
  const survivalStorage = memStorage();
  const survivor = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: survivalStorage });
  survivor.createBelonging({ name: "Bookshelf", kinds: ["furniture"], defaultHome: bedroom,
    dimensions: { width: 0.8, depth: 0.3, height: 1.8, unit: "m", source: "manual", verified: false } });
  const survivorCount = survivor.exportJson().records.length;
  const afterReload = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: survivalStorage });
  assert("valid-geometry-written-by-the-product-survives-a-reload",
    afterReload.exportJson().records.length === survivorCount && afterReload.storageRecovery() === null,
    `wrote ${survivorCount}, reloaded ${afterReload.exportJson().records.length}, recovery ${JSON.stringify(afterReload.storageRecovery())}`);

  // A refused write must leave NOTHING behind — no orphan evidence record. Checking the
  // dimension at the op-construction site instead of with the preconditions did exactly
  // that, and a partial write is the failure mode this project's import work exists to stop.
  const noPartial = fresh();
  const beforePartial = noPartial.exportJson().records.length;
  try {
    noPartial.createBelonging({ name: "Bad", kinds: ["k"], defaultHome: bedroom,
      dimensions: { width: -5, depth: 1, height: 1, unit: "m", source: "manual", verified: false } });
  } catch { /* expected */ }
  assert("refused-geometry-write-leaves-no-partial-record",
    noPartial.exportJson().records.length === beforePartial,
    `refusal appended ${noPartial.exportJson().records.length - beforePartial} record(s)`);

  assert("import-accepts-everything-the-write-path-writes", selfInflicted.length === 0,
    selfInflicted.length ? selfInflicted.slice(0, 4).join(" | ") : "no self-inflicted unimportable export across write-path boundaries");

  // The reader must never be stricter than the writer: anything the product writes must
  // still be there after a reload. This is the lock the geometry regression needed.
  assert("work-written-by-the-product-always-survives-a-reload", lostOnReload.length === 0,
    lostOnReload.length ? lostOnReload.slice(0, 4).join(" | ") : "no write-path output is refused by its own boot");

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

  // ---- Referential integrity. This was a DOCUMENTED GAP in the previous slice: shape
  // validation accepts a structurally perfect reference to a room that does not exist,
  // and the gap lock recorded that limit. The semantics pass now closes it, so the lock
  // is converted from "not yet checked" into the positive contract it was waiting for.
  const nonexistentRoom = rejected(commitWith([
    { type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "room-does-not-exist" }, relation: "inside", confidence: 1 },
  ]));
  assert("import-rejects-placement-into-nonexistent-room",
    nonexistentRoom.threw && /unknown Place Reference room:room-does-not-exist/.test(nonexistentRoom.message),
    nonexistentRoom.message);

  // The second documented gap, CLOSED by this slice. P2 pinned it with a lock that
  // asserted `loadRecords` accepts what `importJson` refuses, deliberately written to
  // FAIL the moment the gap closed. It has closed, so that lock is now inverted into
  // the positive contract it was holding a place for.
  //
  // Boot is not import. An import can be refused and retried; a boot cannot, and the
  // bad bytes stay in storage, so a refusal here would brick the app on every reload
  // instead of once. The contract is therefore: validate with the SAME two passes, but
  // degrade to a usable seeded home, preserve the unreadable bytes, and disclose it.
  // The fixture must still be something the validator genuinely refuses, or the lock
  // below would pass on a well-formed dump and prove nothing.
  const invalidForImport = { version: 2, records: [
    { recordType: "commit", id: "tampered", at: "2026-01-01T00:00:00.000Z", summary: "x",
      ops: [{ type: "set_box_status", boxId: "box-essentials", status: "teleported" }] },
  ] };
  let importRefusesFixture = false;
  try { fresh().importJson(invalidForImport); } catch { importRefusesFixture = true; }
  assert("load-from-storage-fixture-is-genuinely-invalid", importRefusesFixture,
    "the storage fixture must be refused by importJson or the locks below prove nothing");

  const tamperedRaw = JSON.stringify(invalidForImport);
  const tamperedStorage = memStorage();
  tamperedStorage.setItem("nestory-v2", tamperedRaw);
  let bootThrew: string | null = null;
  let fromStorage: Store | null = null;
  try {
    fromStorage = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: tamperedStorage });
  } catch (err) { bootThrew = err instanceof Error ? err.message : String(err); }
  assert("load-from-storage-boots-instead-of-refusing", bootThrew === null && fromStorage !== null,
    bootThrew ?? "boot returned no store");
  assert("load-from-storage-rejects-what-import-rejects",
    (fromStorage?.exportJson().records.length ?? 0) !== 1,
    "loadRecords must no longer accept a ledger importJson refuses");
  assert("load-from-storage-degrades-to-a-usable-home",
    (fromStorage?.exportJson().records.length ?? 0) === buildSeedRecords(NOW).length,
    fromStorage?.exportJson().records.length);
  const storageRecovery = fromStorage?.storageRecovery() ?? null;
  assert("load-from-storage-discloses-the-recovery",
    storageRecovery !== null && typeof storageRecovery.reason === "string" && storageRecovery.reason.length > 0,
    storageRecovery);
  // The non-destructive contract: the unreadable value is COPIED aside, and the
  // original key is left exactly as it was found. Nothing is repaired by deletion.
  assert("load-from-storage-preserves-the-original-bytes",
    tamperedStorage.getItem("nestory-v2") === tamperedRaw,
    "the unreadable original must survive untouched");
  assert("load-from-storage-preserves-a-readable-copy",
    storageRecovery?.preservedAt === "nestory-v2-unreadable"
      && tamperedStorage.getItem("nestory-v2-unreadable") === tamperedRaw,
    { preservedAt: storageRecovery?.preservedAt });
  // A boot that recovered must never answer from the ledger it refused.
  assert("load-from-storage-recovered-boot-answers-honestly",
    !/in the \.|in the$/.test(fromStorage?.locate("passport").sentence ?? ""),
    fromStorage?.locate("passport").sentence);
  // Reload stability: recovery is idempotent, not a brick that returns next boot.
  const reboots = [0, 1, 2].map(() => {
    try {
      const s = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: tamperedStorage });
      return s.exportJson().records.length === buildSeedRecords(NOW).length;
    } catch { return false; }
  });
  assert("load-from-storage-recovery-survives-reloads", reboots.every(Boolean), reboots);

  // A VALID saved ledger must pass through this gate untouched — the case an
  // over-eager validator would break. Byte-identical, no quarantine key written.
  const savedStorage = memStorage();
  const savedDump = JSON.stringify({ version: 2, records: fresh().exportJson().records });
  savedStorage.setItem("nestory-v2", savedDump);
  const savedBoot = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: savedStorage });
  assert("load-from-storage-valid-ledger-loads-unchanged",
    JSON.stringify(savedBoot.exportJson().records) === JSON.stringify(JSON.parse(savedDump).records)
      && savedBoot.storageRecovery() === null
      && savedStorage.getItem("nestory-v2-unreadable") === null,
    { recovery: savedBoot.storageRecovery(), quarantined: savedStorage.getItem("nestory-v2-unreadable") !== null });

  // A SECOND corruption must never clobber the first preserved copy. After a recovered
  // boot the live key fills with seed-derived writes as the person keeps using the app,
  // so overwriting the quarantine on a later corruption would replace the only surviving
  // copy of their real data with something worthless — silent, permanent loss, and the
  // exact outcome this slice exists to prevent. First copy wins.
  const twiceStorage = memStorage();
  const precious = JSON.stringify({ version: 2, records: [
    ...buildSeedRecords(NOW),
    { recordType: "written-by-a-newer-build", id: "precious-marker" },
  ] });
  twiceStorage.setItem("nestory-v2", precious);
  createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: twiceStorage });
  assert("load-from-storage-first-corruption-is-preserved",
    (twiceStorage.getItem("nestory-v2-unreadable") ?? "").includes("precious-marker"),
    "the first quarantine must hold the real data or the lock below proves nothing");
  twiceStorage.setItem("nestory-v2", "{ a different, worthless corruption");
  createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: twiceStorage });
  assert("load-from-storage-second-corruption-does-not-clobber-the-copy",
    (twiceStorage.getItem("nestory-v2-unreadable") ?? "").includes("precious-marker"),
    `the preserved copy was overwritten: ${(twiceStorage.getItem("nestory-v2-unreadable") ?? "").slice(0, 60)}`);

  // Independent review found these three, each a way the recovery could betray its own
  // promise. Locked here because all three passed a typecheck and a green suite.

  // (1) THE BANNER'S PROMISE MUST BE TRUE. After a recovery the person's next ordinary
  // write called persist(), overwriting the live key — and when the quarantine copy
  // failed (quota: the likeliest cause of a truncated ledger in the first place) that key
  // held their ONLY copy. The notice promised recoverability while the product destroyed
  // the thing to be recovered. Storage that refuses the quarantine write is the fixture.
  const MARK = "irreplaceable-marker";
  const preciousLedger = JSON.stringify({ version: 2, records: [
    ...buildSeedRecords(NOW),
    { recordType: "a-newer-build-wrote-this", id: MARK },
  ] });
  const quotaStorage = memStorage();
  const realSet = quotaStorage.setItem.bind(quotaStorage);
  quotaStorage.setItem = (k: string, v: string) => {
    if (k.endsWith("-unreadable")) throw new Error("quota exceeded");
    realSet(k, v);
  };
  quotaStorage.setItem("nestory-v2", preciousLedger);
  const quotaStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: quotaStorage });
  assert("recovery-under-quota-reports-no-copy-was-made",
    quotaStore.storageRecovery()?.preservedAt === null,
    "the fixture must produce a failed quarantine copy or the lock below proves nothing");
  quotaStore.createRoom({ name: "Study" });   // one ordinary write, the moment of loss
  const survivesQuota = ["nestory-v2", "nestory-v2-unreadable"]
    .some((k) => (quotaStorage.getItem(k) ?? "").includes(MARK));
  assert("recovery-write-never-destroys-the-only-copy", survivesQuota,
    "the person's original was overwritten by their next write while the banner promised it was kept");

  // (2) THE DISCLOSURE MUST OUTLIVE THE BOOT THAT CAUSED IT. Once the person writes, the
  // live key is readable again and every later boot looked ordinary — while the
  // unreadable original sat in storage, unmentioned by any surface.
  const durableStorage = memStorage();
  durableStorage.setItem("nestory-v2", preciousLedger);
  const firstBoot = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: durableStorage });
  assert("recovery-disclosed-on-the-boot-that-recovered",
    firstBoot.storageRecovery()?.seededThisBoot === true, firstBoot.storageRecovery());
  firstBoot.createRoom({ name: "Study" });
  const laterBoot = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: durableStorage });
  assert("recovery-still-disclosed-after-a-write-and-reload",
    laterBoot.storageRecovery() !== null,
    "the quarantine copy is still held but no longer disclosed anywhere");
  // ...and that later notice must NOT claim the person is looking at a starter home,
  // because their own records loaded fine this time.
  assert("later-disclosure-does-not-claim-a-seeded-session",
    laterBoot.storageRecovery()?.seededThisBoot === false
      && laterBoot.exportJson().records.some((r) => r.id === "room-study" || r.recordType === "commit"),
    laterBoot.storageRecovery());

  // (4) WHEN AN OLDER COPY IS KEPT, DO NOT POINT AT IT AS IF IT WERE THIS LEDGER.
  // "First copy wins" was right, but the notice still claimed `preservedAt` and reported
  // the CURRENT value's byte count — sending the person to a key holding unrelated bytes
  // while their real original sat untouched at the live key.
  const staleQ = memStorage();
  staleQ.setItem("nestory-v2-unreadable", "{ an older, unrelated scrap");
  staleQ.setItem("nestory-v2", preciousLedger);
  const staleStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: staleQ });
  // Whatever key is named must actually hold THIS ledger — never the older, unrelated one.
  const claimed = staleStore.storageRecovery()?.preservedAt;
  assert("recovery-never-points-at-an-older-unrelated-copy",
    !claimed || (staleQ.getItem(claimed) ?? "").includes(MARK),
    `pointed at ${claimed}, which does not hold this ledger`);
  assert("older-copy-is-still-not-overwritten",
    staleQ.getItem("nestory-v2-unreadable") === "{ an older, unrelated scrap",
    "the older copy must survive");
  assert("recovery-original-bytes-describe-what-is-actually-preserved",
    staleStore.storageRecovery()?.originalBytes === preciousLedger.length,
    staleStore.storageRecovery()?.originalBytes);
  // ...and with no copy claimed, the live original must survive the next write.
  staleStore.createRoom({ name: "Study" });
  assert("live-original-survives-when-no-new-copy-could-be-made",
    ["nestory-v2", "nestory-v2-unreadable", "nestory-v2-unreadable-2"]
      .some((k) => (staleQ.getItem(k) ?? "").includes(MARK)),
    "the person's real ledger was overwritten while no copy of it existed");

  // (5) A REFUSED WRITE MUST NEVER LOOK LIKE SUCCESS. Guarding persist() introduced a
  // worse failure than the one it fixed: with the quarantine slot occupied by an EARLIER
  // original, writes were refused forever — so the live key never became readable and the
  // block never lifted — while the UI toasted "Room added" and the checklist ticked. The
  // person watched their work be confirmed and lost all of it on reload, repeatedly.
  // A single secondary slot breaks the deadlock; if even that is unavailable the refusal
  // is REPORTED (savingBlocked) so the interface can say changes are not being saved.
  const occupied = memStorage();
  occupied.setItem("nestory-v2-unreadable", "{ an older, different original");
  occupied.setItem("nestory-v2-unreadable-2", "{ a second older original");
  occupied.setItem("nestory-v2", "{ this boot's corruption");
  const blockedStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: occupied });
  assert("occupied-quarantine-probe-reaches-the-blocked-branch",
    blockedStore.storageRecovery()?.preservedAt === null,
    "fixture must produce the no-copy branch or the locks below prove nothing");
  const roomsBefore = blockedStore.state.rooms.size;
  blockedStore.createRoom({ name: "Study" });
  const afterWrite = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: occupied });
  const persistedOk = afterWrite.state.rooms.size === roomsBefore + 1;
  const reportedBlocked = blockedStore.storageRecovery()?.savingBlocked === true;
  assert("a-write-either-persists-or-is-reported-as-not-saved", persistedOk || reportedBlocked,
    `write neither landed (rooms ${afterWrite.state.rooms.size} vs ${roomsBefore + 1}) nor was reported blocked`);
  assert("older-original-survives-the-blocked-write",
    occupied.getItem("nestory-v2-unreadable") === "{ an older, different original",
    "the earlier original must never be overwritten to make room");
  // With no slot at all available, the refusal must be REPORTED rather than silent.
  const noSlots = memStorage();
  noSlots.setItem("nestory-v2-unreadable", "{ older original A");
  noSlots.setItem("nestory-v2-unreadable-2", "{ older original B");
  noSlots.setItem("nestory-v2", "{ this boot's corruption");
  const noSlotStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: noSlots });
  // The warning must be true BEFORE the first write, not learned by failing one. P3
  // computed it lazily in `persist()`, so the person was told "Room added" and only then
  // told it had not been saved — the work was already lost by the time the notice was
  // accurate. The state is now computed at boot, read-only.
  assert("unsaveable-session-is-disclosed-at-boot-before-any-write",
    noSlotStore.storageRecovery()?.savingBlocked === true,
    "the person can start building a home before being told nothing is being saved");
  const noSlotWritesBefore = noSlots.getItem("nestory-v2-unreadable");
  noSlotStore.createRoom({ name: "Study" });
  assert("unsaveable-session-is-disclosed-not-silent",
    noSlotStore.storageRecovery()?.savingBlocked === true,
    "writes were discarded with no way for the interface to say so");
  assert("boot-time-probe-did-not-consume-or-alter-a-slot",
    noSlots.getItem("nestory-v2-unreadable") === noSlotWritesBefore,
    "asking whether saving is possible must not itself write");

  // The mirror case, which a too-eager version of this would break: when a slot IS
  // available the boot must NOT cry wolf, and the write must genuinely persist.
  const freeSlot = memStorage();
  freeSlot.setItem("nestory-v2-unreadable", "{ an older original");
  freeSlot.setItem("nestory-v2", "{ this boot's corruption");
  const freeSlotStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: freeSlot });
  assert("available-slot-boot-does-not-claim-saving-is-blocked",
    freeSlotStore.storageRecovery()?.savingBlocked === false,
    freeSlotStore.storageRecovery());
  const roomsBeforeFree = freeSlotStore.state.rooms.size;
  freeSlotStore.createRoom({ name: "Study" });
  const freeSlotReboot = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: freeSlot });
  assert("available-slot-write-actually-persists",
    freeSlotReboot.state.rooms.size === roomsBeforeFree + 1,
    `wrote 1 room, reloaded ${freeSlotReboot.state.rooms.size - roomsBeforeFree}`);

  // And a HEALTHY store must gain no notice at all from this change.
  const healthy = memStorage();
  healthy.setItem("nestory-v2", JSON.stringify({ version: 2, records: fresh().exportJson().records }));
  const healthyStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: healthy });
  assert("healthy-store-gains-no-recovery-notice",
    healthyStore.storageRecovery() === null && healthy.getItem("nestory-v2-unreadable") === null,
    healthyStore.storageRecovery());

  // THE PROMISE AND THE BEHAVIOUR MUST NOT DRIFT. `savingIsPossible()` (the boot probe)
  // and `securedBeforeOverwrite()` (the writer's own check) duplicate the slot logic, so
  // they could disagree: the boot says saving works, the write is then refused, and the
  // person silently loses it — the exact defect this slice removes. Swept over every
  // reachable combination of {slot1, slot2, live key}, asserting that whenever the notice
  // claims saving is possible, a real write actually survives a reload.
  const driftSlotValues = [null, "{ A", "{ B", "{ same"];
  const driftLiveValues = ["{ corrupt", "{ same", JSON.stringify({ version: 2, records: fresh().exportJson().records })];
  // `memStorage()` never throws, so on its own it cannot reach the family this feature
  // exists for: quota is named in the source as the likeliest cause of a truncated
  // ledger. A throwing `setItem` also makes `quarantine()`'s own copy fail, which leaves
  // `preservedAt` null with a slot still FREE — the state a sweep over non-throwing
  // storage can never produce, and the one an earlier equivalence claim wrongly ruled out.
  const driftStorage = (throwing: boolean): StorageLike & { snapshot: Map<string, string> } => {
    const m = new Map<string, string>();
    return {
      snapshot: m,
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { if (throwing) throw new Error("quota exceeded"); m.set(k, v); },
    };
  };
  const drifted: string[] = [];
  let driftStates = 0;
  let possibleClaims = 0;
  for (const throwing of [false, true]) for (const q1 of driftSlotValues) for (const q2 of driftSlotValues) for (const live of driftLiveValues) {
    const st = driftStorage(throwing);
    if (q1) st.snapshot.set("nestory-v2-unreadable", q1);
    if (q2) st.snapshot.set("nestory-v2-unreadable-2", q2);
    st.snapshot.set("nestory-v2", live);
    const store = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: st });
    const rec = store.storageRecovery();
    if (!rec) continue;
    driftStates += 1;
    if (rec.savingBlocked) continue;                       // claims blocked: nothing promised
    possibleClaims += 1;
    const before = store.exportJson().records.length;
    store.createRoom({ name: "Study" });
    const reloaded = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: st });
    const persisted = reloaded.exportJson().records.length > before;
    // On throwing storage the boot answer is a PREDICTION that cannot see a failing
    // setItem; what must hold there is that the person is told before they lose more —
    // `persist()` discovers the refusal and sets the flag, the pre-existing behaviour.
    if (!persisted && !(throwing && store.storageRecovery()?.savingBlocked === true)) {
      drifted.push(`throwing=${throwing} slot1=${q1 ?? "-"} slot2=${q2 ?? "-"} live=${live.slice(0, 12)}`);
    }
  }
  assert("drift-sweep-actually-exercised-recovery-states", driftStates >= 10, driftStates);
  assert("drift-sweep-actually-exercised-possible-claims", possibleClaims >= 5, possibleClaims);
  assert("boot-promise-and-write-behaviour-never-disagree", drifted.length === 0,
    drifted.length ? drifted.slice(0, 3).join(" | ") : "no state promises saving and then loses the write without saying so");

  // The mirror direction, which the sweep above cannot see: a boot that claims BLOCKED
  // while the write would actually have succeeded. That is a false alarm, and a warning
  // people learn to ignore protects no one. Same sweep, opposite question.
  const criedWolf: string[] = [];
  let blockedClaims = 0;
  for (const throwing of [false, true]) for (const q1 of driftSlotValues) for (const q2 of driftSlotValues) for (const live of driftLiveValues) {
    const st = driftStorage(throwing);
    if (q1) st.snapshot.set("nestory-v2-unreadable", q1);
    if (q2) st.snapshot.set("nestory-v2-unreadable-2", q2);
    st.snapshot.set("nestory-v2", live);
    const store = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: st });
    const rec = store.storageRecovery();
    if (!rec || !rec.savingBlocked) continue;              // only the "blocked" claims
    blockedClaims += 1;
    const before = store.exportJson().records.length;
    store.createRoom({ name: "Study" });
    const reloaded = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: st });
    if (reloaded.exportJson().records.length > before) {
      criedWolf.push(`throwing=${throwing} slot1=${q1 ?? "-"} slot2=${q2 ?? "-"} live=${live.slice(0, 12)}`);
    }
  }
  // Its OWN counter: reusing the shared one would let this pass vacuously if the
  // population of blocked claims ever went to zero.
  assert("false-alarm-sweep-actually-exercised-blocked-claims", blockedClaims >= 5, blockedClaims);
  assert("boot-never-claims-blocked-when-saving-would-have-worked", criedWolf.length === 0,
    criedWolf.length ? criedWolf.slice(0, 3).join(" | ") : "no false alarm across the swept states");

  // THE BOUNDARY OF THE BOOT ANSWER, locked so it is visible rather than discovered.
  // A read-only probe cannot know that `setItem` will throw, so on out-of-quota storage
  // the boot answer can be `false` and the refusal is only found by the first write.
  // What must ALWAYS hold is the outcome the person experiences: they end up warned, and
  // no original is destroyed. This asserts that weaker-but-true contract explicitly,
  // rather than letting the stronger boot-time claim quietly not apply here.
  const p4QuotaMap = new Map<string, string>([
    ["nestory-v2-unreadable", "{ an older original"],
    ["nestory-v2", "{ this boot's corruption"],
  ]);
  const p4QuotaStorage: StorageLike = {
    getItem: (k) => p4QuotaMap.get(k) ?? null,
    setItem: () => { throw new Error("quota exceeded"); },
  };
  const p4QuotaStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: p4QuotaStorage });
  assert("quota-boot-still-discloses-the-recovery", p4QuotaStore.storageRecovery() !== null,
    "the recovery itself must still be reported when storage rejects every write");
  p4QuotaStore.createRoom({ name: "Study" });
  assert("quota-write-is-reported-as-not-saved",
    p4QuotaStore.storageRecovery()?.savingBlocked === true,
    "a rejected write must set the flag; ignoring the throw let the session claim success");
  assert("quota-write-destroys-no-original",
    p4QuotaMap.get("nestory-v2-unreadable") === "{ an older original"
      && p4QuotaMap.get("nestory-v2") === "{ this boot's corruption" && p4QuotaMap.size === 2,
    [...p4QuotaMap.keys()].join(", "));

  // TRANSIENT QUOTA — the state where the SECOND slot is load-bearing and only the real
  // implementation is correct. Storage is full during boot, so `quarantine()`'s copy
  // fails and `preservedAt` stays null with slot 2 still free; quota then eases before
  // the person's first write. A probe that ignored slot 2, or that wrote during boot,
  // would cry wolf here — say blocked, then save anyway. Every fixture above pins
  // `throwing` for a whole run, so none of them can reach this; without it the second
  // slot rests on argument rather than on a lock.
  const transientMap = new Map<string, string>([
    ["nestory-v2-unreadable", "{ an older original"],
    ["nestory-v2", "{ this boot's corruption"],
  ]);
  let quotaFull = true;
  const transientStorage: StorageLike = {
    getItem: (k) => transientMap.get(k) ?? null,
    setItem: (k, v) => { if (quotaFull) throw new Error("quota exceeded"); transientMap.set(k, v); },
  };
  const transientStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: transientStorage });
  assert("transient-quota-probe-reaches-the-uncopied-state",
    transientStore.storageRecovery()?.preservedAt === null,
    "the fixture must leave preservedAt null with a slot free, or the locks below prove nothing");
  assert("transient-quota-boot-does-not-cry-wolf",
    transientStore.storageRecovery()?.savingBlocked === false,
    transientStore.storageRecovery());
  quotaFull = false;                                   // quota eases before the first write
  const transientBefore = transientStore.exportJson().records.length;
  transientStore.createRoom({ name: "Study" });
  const transientReload = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: transientStorage });
  assert("transient-quota-boot-promise-was-true",
    transientReload.exportJson().records.length > transientBefore,
    "boot said saving was possible; the write must actually have survived");
  assert("transient-quota-used-the-second-slot",
    transientMap.get("nestory-v2-unreadable-2") === "{ this boot's corruption",
    [...transientMap.keys()].join(", "));
  assert("transient-quota-left-the-older-original-untouched",
    transientMap.get("nestory-v2-unreadable") === "{ an older original",
    transientMap.get("nestory-v2-unreadable"));

  // Clearing: once saving becomes possible again the warning must go away, or it becomes
  // a permanent false alarm the person learns to ignore.
  // `StorageLike` is get/set only — the store never deletes, deliberately — so the slot
  // is freed through a local backing map rather than by widening that interface.
  const clearingMap = new Map<string, string>([
    ["nestory-v2-unreadable", "{ older original A"],
    ["nestory-v2-unreadable-2", "{ older original B"],
    ["nestory-v2", "{ this boot's corruption"],
  ]);
  const clearing: StorageLike = {
    getItem: (k) => clearingMap.get(k) ?? null,
    setItem: (k, v) => { clearingMap.set(k, v); },
  };
  const clearingStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: clearing });
  assert("clearing-case-starts-blocked", clearingStore.storageRecovery()?.savingBlocked === true,
    "fixture must start blocked or the clearing lock proves nothing");
  clearingMap.delete("nestory-v2-unreadable-2");   // a slot frees up mid-session
  clearingStore.createRoom({ name: "Study" });
  assert("warning-clears-once-saving-is-possible-again",
    clearingStore.storageRecovery()?.savingBlocked === false,
    clearingStore.storageRecovery());
  assert("unsaveable-session-still-protects-both-originals",
    noSlots.getItem("nestory-v2-unreadable") === "{ older original A"
      && noSlots.getItem("nestory-v2") === "{ this boot's corruption",
    "originals must survive a blocked session");

  // (6) THE SLOT COUNT IS BOUNDED AND NO ORIGINAL IS EVER LOST. A second quarantine slot
  // exists only to break the deadlock above; if it could grow without bound it would be a
  // storage leak, and if a later corruption could displace an earlier original it would be
  // the data loss this path exists to prevent. Six distinct corruptions, then the checks.
  const boundedStorage = memStorage();
  for (let i = 1; i <= 6; i++) {
    boundedStorage.setItem("nestory-v2", `{ distinct corruption ${i}`);
    createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: boundedStorage });
  }
  const slotKeys = ["nestory-v2-unreadable", "nestory-v2-unreadable-2", "nestory-v2-unreadable-3"]
    .filter((k) => boundedStorage.getItem(k) !== null);
  assert("quarantine-slots-are-bounded-at-two", slotKeys.length <= 2, slotKeys);
  assert("earliest-original-is-never-displaced",
    boundedStorage.getItem("nestory-v2-unreadable") === "{ distinct corruption 1",
    boundedStorage.getItem("nestory-v2-unreadable"));
  assert("newest-original-is-still-protected-in-place",
    boundedStorage.getItem("nestory-v2") === "{ distinct corruption 6",
    boundedStorage.getItem("nestory-v2"));
  // Repeated IDENTICAL corruption must not consume the spare slot.
  const idempotent = memStorage();
  idempotent.setItem("nestory-v2", "{ the same corruption");
  for (let i = 0; i < 4; i++) createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: idempotent });
  assert("identical-corruption-does-not-consume-the-spare-slot",
    idempotent.getItem("nestory-v2-unreadable-2") === null,
    "a repeated identical failure must reuse the copy it already made");

  // (3) A BOUNDED REASON. The validator quotes offending values, which can be text the
  // person typed; an unbounded message would push the rest of the notice off screen.
  const longName = "x".repeat(3000);
  const longStorage = memStorage();
  longStorage.setItem("nestory-v2", JSON.stringify({ version: 2, records: [
    { recordType: "commit", id: "c-long", at: "2026-01-01T00:00:00.000Z", summary: "x",
      ops: [{ type: "set_box_status", boxId: "box-essentials", status: longName }] },
  ] }));
  const longStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: longStorage });
  assert("recovery-reason-is-produced-for-a-long-value",
    (longStore.storageRecovery()?.reason.length ?? 0) > 0, longStore.storageRecovery()?.reason.length);

  // ---------------------------------------------------------------- P5: a refused write
  // on a HEALTHY store must be disclosed. Everything above concerns a saved ledger that
  // could not be READ. This is the other failure: the saved data is fine, and the write
  // of a NEW change is rejected (quota, private mode, a full disk). There is no recovery
  // object to carry the fact, and it used to be dropped — the session went on confirming
  // every change while nothing reached storage, and the work vanished on reload with
  // nothing having said so. Reproduced against the real interface before being changed.
  //
  // A storage that accepts a first write and then refuses every later one, which is what
  // filling a real quota looks like from the store's side.
  const refusingStorage = (): StorageLike & { writes: number } => {
    const m = new Map<string, string>();
    let writes = 0;
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => {
        // Only the app's own key is refused; the quarantine slots are irrelevant here
        // because nothing is being recovered.
        if (k === "nestory-v2" && writes >= 1) throw new DOMException("quota", "QuotaExceededError");
        writes += 1; m.set(k, v);
      },
      get writes() { return writes; }
    } as StorageLike & { writes: number };
  };

  const refuse = refusingStorage();
  const refuseStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: refuse });
  // The store's own construction does not write, so nothing is reported before a change.
  assert("healthy-store-reports-no-write-failure-before-any-write",
    refuseStore.storageWriteFailure() === null && refuseStore.storageRecovery() === null,
    { wf: refuseStore.storageWriteFailure(), rec: refuseStore.storageRecovery() });

  // The FIRST write succeeds, so it must stay silent: a false alarm is its own defect.
  refuseStore.createRoom({ name: "P5 First Room" });
  const afterFirst = refuse.getItem("nestory-v2");
  assert("a-write-that-lands-reports-no-failure",
    refuseStore.storageWriteFailure() === null && afterFirst !== null && afterFirst.includes("P5 First Room"),
    { wf: refuseStore.storageWriteFailure(), persisted: afterFirst !== null });

  // The SECOND write is refused. In memory it exists; in storage it must not, and the
  // store must now say so. Before this slice, `storageWriteFailure()` did not exist and
  // the rejection was swallowed by an empty `catch`.
  const roomsBeforeRefusal = refuseStore.state.rooms.size;
  refuseStore.createRoom({ name: "P5 Refused Room" });
  const storedAfterRefusal = refuse.getItem("nestory-v2");
  assert("a-refused-write-is-reported-not-swallowed",
    refuseStore.storageWriteFailure() !== null
      && refuseStore.state.rooms.size === roomsBeforeRefusal + 1     // memory advanced
      && storedAfterRefusal === afterFirst                            // storage did not
      && (storedAfterRefusal ?? "").includes("P5 Refused Room") === false,
    { wf: refuseStore.storageWriteFailure(), storageUnchanged: storedAfterRefusal === afterFirst });

  // The last SUCCESSFUL save is still intact and still loads. "Not saved" must never mean
  // "what you had is gone" — a reboot on the same bytes must recover the first room.
  const rebootAfterRefusal = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: { getItem: (k) => refuse.getItem(k), setItem: () => {} } });
  assert("the-last-successful-save-survives-a-refusal",
    rebootAfterRefusal.storageRecovery() === null
      && [...rebootAfterRefusal.state.rooms.values()].some((r) => r.name === "P5 First Room")
      && ![...rebootAfterRefusal.state.rooms.values()].some((r) => r.name === "P5 Refused Room"),
    [...rebootAfterRefusal.state.rooms.values()].map((r) => r.name).slice(-3));

  // `since` marks the FIRST unresolved refusal and must not be restamped by later ones:
  // the exposure began with the earliest unsaved change, and moving the timestamp forward
  // would understate how much work is at risk. Caught as a real defect during the walk —
  // the first version of this code called `nowIso()` unconditionally.
  const firstFailureSince = refuseStore.storageWriteFailure()?.since ?? null;
  let tick = NOW;
  const tickingRefuse = refusingStorage();
  const tickingStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => (tick += 60_000), storage: tickingRefuse });
  tickingStore.createRoom({ name: "T1" });                    // lands
  tickingStore.createRoom({ name: "T2" });                    // refused -> since = t
  const sinceAfterOne = tickingStore.storageWriteFailure()?.since ?? null;
  tickingStore.createRoom({ name: "T3" });                    // refused -> must NOT restamp
  tickingStore.createRoom({ name: "T4" });
  const wfLater = tickingStore.storageWriteFailure();
  // Read defensively: a mutant that returns null here must FAIL this assertion, not crash
  // the section — a crash aborts the assertions that follow and hides what they would say.
  assert("since-marks-the-first-refusal-not-the-latest",
    wfLater !== null && sinceAfterOne !== null
      && wfLater.since === sinceAfterOne && wfLater.unsavedChanges === 3,
    { sinceAfterOne, later: wfLater });
  assert("unsaved-changes-counts-every-refusal",
    refuseStore.storageWriteFailure()?.unsavedChanges === 1 && (firstFailureSince?.length ?? 0) > 0,
    refuseStore.storageWriteFailure());

  // Only a write that ACTUALLY LANDS clears it. Not time passing, not a retry attempt.
  const healingStorage = (): StorageLike & { allow: (v: boolean) => void } => {
    const m = new Map<string, string>();
    let refusing = false;
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { if (refusing && k === "nestory-v2") throw new DOMException("quota", "QuotaExceededError"); m.set(k, v); },
      allow: (v: boolean) => { refusing = !v; }
    } as StorageLike & { allow: (v: boolean) => void };
  };
  const heal = healingStorage();
  const healStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: heal });
  healStore.createRoom({ name: "Heal Base" });
  heal.allow(false);
  healStore.createRoom({ name: "Heal Refused" });
  assert("healing-case-starts-in-failure", healStore.storageWriteFailure() !== null, healStore.storageWriteFailure());
  heal.allow(true);
  healStore.createRoom({ name: "Heal Retry" });
  const healedRaw = heal.getItem("nestory-v2") ?? "";
  assert("a-successful-write-clears-the-failure-and-saves-the-backlog",
    healStore.storageWriteFailure() === null
      && healedRaw.includes("Heal Refused")      // the earlier in-memory change is now saved
      && healedRaw.includes("Heal Retry"),
    { wf: healStore.storageWriteFailure(), hasBacklog: healedRaw.includes("Heal Refused") });

  // The two states are INDEPENDENT. An unreadable ledger AND refused writes can hold at
  // once, and neither may be reported as the other: a write failure must not claim the
  // saved data is corrupt, and a recovery must not claim writes are being refused.
  const bothStorage = (): StorageLike => {
    const m = new Map<string, string>([["nestory-v2", "{ corrupt"]]);
    return { getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { if (k === "nestory-v2") throw new DOMException("quota", "QuotaExceededError"); m.set(k, v); } };
  };
  const bothStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: bothStorage() });
  assert("recovery-alone-does-not-set-a-write-failure",
    bothStore.storageRecovery() !== null && bothStore.storageWriteFailure() === null,
    { rec: Boolean(bothStore.storageRecovery()), wf: bothStore.storageWriteFailure() });
  bothStore.createRoom({ name: "Both Room" });
  assert("both-states-can-hold-at-once-and-stay-distinct",
    bothStore.storageRecovery() !== null && bothStore.storageRecovery()!.savingBlocked === true
      && bothStore.storageWriteFailure() !== null
      // and the recovery's own fields are untouched by the write failure
      && bothStore.storageRecovery()!.originalKey === "nestory-v2",
    { savingBlocked: bothStore.storageRecovery()?.savingBlocked, wf: bothStore.storageWriteFailure() });
  // Byte PRESENCE is not save PROVENANCE. In the compound state `persistKey` holds the
  // bytes this build could NOT read, so counting them as a save would put "could not be
  // read" and "exactly as it was at the last successful save" on the same screen. A
  // reviewer reproduced that against this very fixture, which asserted the two states hold
  // without ever inspecting what the copy would then claim.
  assert("unreadable-bytes-do-not-count-as-a-successful-save",
    bothStore.storageWriteFailure()?.hasStoredData === false,
    bothStore.storageWriteFailure());

  // A throwing `getItem` at the moment of failure cannot confirm anything is stored, so the
  // defensive branch must report false rather than assume. Flipping it to `return true`
  // passed the whole suite for a reviewer: the branch was reachable but untested. The
  // understatement is the safe direction — it withholds a reassurance rather than inventing
  // one — but "safe by accident" is not the same as locked.
  const throwingReadRefusingWrite = (): StorageLike => ({
    getItem: (k) => { if (k === "nestory-v2") throw new Error("read blocked"); return null; },
    setItem: () => { throw new DOMException("quota", "QuotaExceededError"); }
  });
  const throwReadStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: throwingReadRefusingWrite() });
  throwReadStore.createRoom({ name: "Throwing Read Room" });
  assert("a-throwing-read-cannot-claim-stored-data-exists",
    throwReadStore.storageWriteFailure() !== null
      && throwReadStore.storageWriteFailure()?.hasStoredData === false,
    throwReadStore.storageWriteFailure());

  // A SEEDED BOOT STOPS BEING THE WHOLE STORY once a write of ours lands. `seededThisBoot` is a
  // boot-time fact; the first landed write replaces the stored bytes with records this build
  // wrote and can re-read, and those survive a reload. Disqualifying for the whole session told
  // the person their saved data "cannot be read" and that "everything in this session will be
  // gone" — both false, and understating what survived is the worse direction, because it pushes
  // someone to re-enter work already on disk. A reviewer found this against a fully green suite:
  // the 436 assertions covered six copy branches and could not distinguish this seventh state.
  const seededThenLanded = (): StorageLike & { block: () => void } => {
    const m = new Map<string, string>([["nestory-v2", "{ corrupt"]]);
    let refusing = false;
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { if (refusing && k === "nestory-v2") throw new DOMException("quota", "QuotaExceededError"); m.set(k, v); },
      block: () => { refusing = true; }
    } as StorageLike & { block: () => void };
  };
  const stl = seededThenLanded();
  const stlStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: stl });
  assert("seeded-then-landed-probe-really-started-from-a-seeded-boot",
    stlStore.storageRecovery()?.seededThisBoot === true,
    stlStore.storageRecovery());
  stlStore.createRoom({ name: "Landed After Recovery" });     // LANDS: the bytes are now ours
  const stlRaw = stl.getItem("nestory-v2") ?? "";
  const stlReadable = (() => { try { return Boolean(JSON.parse(stlRaw)); } catch { return false; } })();
  stl.block();
  stlStore.createRoom({ name: "Refused After Landing" });      // refused
  assert("a-landed-write-after-a-seeded-boot-counts-as-a-successful-save",
    stlReadable === true && stlRaw.includes("Landed After Recovery")
      && stlStore.storageWriteFailure()?.hasStoredData === true,
    { readable: stlReadable, wf: stlStore.storageWriteFailure() });
  // And the ground truth the copy must not contradict: the landed work really does survive.
  const stlReboot = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW,
    storage: { getItem: (k) => stl.getItem(k), setItem: () => {} } });
  const stlNames = [...stlReboot.state.rooms.values()].map((r) => r.name);
  assert("the-landed-write-really-survives-and-only-the-refused-one-is-lost",
    stlNames.includes("Landed After Recovery") && !stlNames.includes("Refused After Landing"),
    stlNames.slice(-3));
  // The mirror case stays correct: a seeded boot whose FIRST write is refused has landed
  // nothing, so the unreadable-copy branch is still the true one there.
  const stlNone = seededThenLanded();
  const stlNoneStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: stlNone });
  stlNone.block();
  stlNoneStore.createRoom({ name: "Refused First" });
  assert("a-seeded-boot-with-no-landed-write-still-reports-no-stored-data",
    stlNoneStore.storageWriteFailure()?.hasStoredData === false,
    stlNoneStore.storageWriteFailure());

  // A REFUSAL ON THE EARLY-RETURN PATH MUST STILL BE COUNTED. `persist()` has two refusal
  // paths: the storage rejection, and the protect-the-only-copy refusal that returns BEFORE
  // attempting a write. Only the first ever touched `writeFailure`, so a disclosure trigger
  // built on `unsavedChanges` was structurally blind to the second — under a standing block
  // every silent write went unannounced, which a reviewer reproduced across five call sites.
  // `writeRefusalCount()` counts both, which is what makes the trigger answer the question it
  // claims to: was THIS change refused?
  const blockedBoth = (): StorageLike => {
    const m = new Map<string, string>([
      ["nestory-v2-unreadable", "{ older original A"],
      ["nestory-v2-unreadable-2", "{ older original B"],
      ["nestory-v2", "{ this boot corruption"]]);
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
  };
  const earlyReturnStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: blockedBoth() });
  assert("early-return-probe-really-reached-a-standing-block-with-no-write-failure",
    earlyReturnStore.storageRecovery()?.savingBlocked === true && earlyReturnStore.storageWriteFailure() === null,
    { blocked: earlyReturnStore.storageRecovery()?.savingBlocked, wf: earlyReturnStore.storageWriteFailure() });
  const erBefore = earlyReturnStore.writeRefusalCount();
  earlyReturnStore.createRoom({ name: "Refused By Early Return" });
  const erAfter = earlyReturnStore.writeRefusalCount();
  assert("a-refusal-that-returns-before-writing-is-still-counted",
    erAfter > erBefore,
    `the early-return refusal must move the count: ${erBefore} -> ${erAfter}`);
  // And a SECOND one, so the disclosure cannot degrade to first-only.
  const erBefore2 = earlyReturnStore.writeRefusalCount();
  earlyReturnStore.createRoom({ name: "Refused Again" });
  assert("a-later-refusal-on-the-same-path-is-counted-too",
    earlyReturnStore.writeRefusalCount() > erBefore2,
    `a standing block must keep counting: ${erBefore2} -> ${earlyReturnStore.writeRefusalCount()}`);
  // A READ must never move it, or the trigger would announce changes that never happened.
  const erReadBefore = earlyReturnStore.writeRefusalCount();
  earlyReturnStore.locate("passport"); earlyReturnStore.searchBelongings(""); earlyReturnStore.commitsView(5); earlyReturnStore.exportJson();
  assert("reads-never-move-the-refusal-count",
    earlyReturnStore.writeRefusalCount() === erReadBefore,
    `reads moved the count: ${erReadBefore} -> ${earlyReturnStore.writeRefusalCount()}`);
  // The quota path must count too, so the single trigger covers both.
  const quotaOnly = (): StorageLike => {
    const m = new Map<string, string>();
    let n = 0;
    return { getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { n += 1; if (n > 1 && k === "nestory-v2") throw new DOMException("quota", "QuotaExceededError"); m.set(k, v); } };
  };
  const qStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: quotaOnly() });
  qStore.createRoom({ name: "Lands" });
  const qBefore = qStore.writeRefusalCount();
  qStore.createRoom({ name: "Refused By Quota" });
  assert("a-quota-refusal-is-counted-on-the-same-counter",
    qStore.writeRefusalCount() > qBefore && qStore.storageWriteFailure() !== null,
    `${qBefore} -> ${qStore.writeRefusalCount()}`);

  // `loadedFromStorage`'s own rung: a session that really LOADED the person's records and whose
  // FIRST write is refused must not be told "nothing has been saved to this browser yet". Every
  // other hasStoredData=true fixture routes through `ownSaveLanded`, so this rung had no test of
  // its own in either direction — a reviewer deleted the assignment and the suite stayed green.
  const savedThenReboot = (() => {
    const m = new Map<string, string>();
    let refusing = false;
    const st: StorageLike = { getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { if (refusing && k === "nestory-v2") throw new DOMException("quota", "QuotaExceededError"); m.set(k, v); } };
    const first = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: st });
    first.createRoom({ name: "Saved In Session One" });          // lands, so the bytes are a real save
    refusing = true;
    return { st, second: createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: st }) };
  })();
  assert("reboot-probe-loaded-the-earlier-save-without-a-recovery",
    savedThenReboot.second.storageRecovery() === null
      && [...savedThenReboot.second.state.rooms.values()].some((r) => r.name === "Saved In Session One"),
    [...savedThenReboot.second.state.rooms.values()].map((r) => r.name).slice(-3));
  savedThenReboot.second.createRoom({ name: "First Write Of Session Two" });   // refused
  assert("a-loaded-earlier-save-counts-even-before-this-session-writes",
    savedThenReboot.second.storageWriteFailure()?.hasStoredData === true,
    savedThenReboot.second.storageWriteFailure());

  // And the negative rung: bytes that are NOT a save must never earn the reassurance. Byte
  // presence was the old test, and the comment beside it already said presence is not
  // provenance — an empty string, a foreign shape, and an empty records array all passed.
  for (const [label, seed] of [["empty string", ""], ["foreign shape", '{"version":1,"items":[]}'],
                               ["empty records", '{"version":2,"records":[]}']] as [string, string][]) {
    const m = new Map<string, string>([["nestory-v2", seed]]);
    const st: StorageLike = { getItem: (k) => m.get(k) ?? null,
      setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
    const st2 = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: st });
    st2.createRoom({ name: "Refused" });
    assert(`bytes-that-are-not-a-save-earn-no-reassurance-${label.replace(/ /g, "-")}`,
      st2.storageWriteFailure()?.hasStoredData === false,
      { label, wf: st2.storageWriteFailure() });
  }

  // A LEFTOVER quarantine copy from an earlier boot also sets a recovery, but there the live
  // key reads perfectly, the person's own records loaded, and writes can land this session.
  // Disqualifying `hasStoredData` on "a recovery exists" told those people their data cannot
  // be read while the recovery banner above said "Your current records loaded normally" - two
  // banners contradicting each other about the same bytes. `seededThisBoot` discriminates.
  const leftoverQuarantine = (): StorageLike & { allow: (v: boolean) => void } => {
    const m = new Map<string, string>([["nestory-v2-unreadable", "{ an older original"]]);
    let refusing = false;
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { if (refusing && k === "nestory-v2") throw new DOMException("quota", "QuotaExceededError"); m.set(k, v); },
      allow: (v: boolean) => { refusing = !v; }
    } as StorageLike & { allow: (v: boolean) => void };
  };
  const leftover = leftoverQuarantine();
  const leftoverStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: leftover });
  assert("leftover-quarantine-probe-reports-a-non-seeded-recovery",
    leftoverStore.storageRecovery() !== null && leftoverStore.storageRecovery()?.seededThisBoot === false,
    leftoverStore.storageRecovery());
  leftoverStore.createRoom({ name: "Leftover Landed Room" });   // this write LANDS
  const leftoverLanded = (leftover.getItem("nestory-v2") ?? "").includes("Leftover Landed Room");
  leftover.allow(false);
  leftoverStore.createRoom({ name: "Leftover Refused Room" });  // this one is refused
  assert("a-readable-live-key-still-counts-as-a-successful-save",
    leftoverLanded === true
      && leftoverStore.storageWriteFailure() !== null
      && leftoverStore.storageWriteFailure()?.hasStoredData === true,
    { landed: leftoverLanded, wf: leftoverStore.storageWriteFailure() });

  // A store with NO storage at all must not manufacture a failure — there is nothing to
  // fail. `persist()` returns before the try block, and the accessor must stay null.
  const noStorageStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: null });
  noStorageStore.createRoom({ name: "No Storage Room" });
  assert("no-storage-is-not-a-write-failure",
    noStorageStore.storageWriteFailure() === null, noStorageStore.storageWriteFailure());

  // A store that has refused EVERY write from the start has nothing saved, so the notice
  // must not speak of a "last successful save". Found by probing, not by the mutants: the
  // first version of the copy asserted a safety net that did not exist. `hasStoredData`
  // carries the distinction, and both branches are locked — a single-branch lock would let
  // the wrong sentence ship for whichever case it did not cover.
  const neverSaved = (): StorageLike => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
  };
  const neverStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: neverSaved() });
  neverStore.createRoom({ name: "Never Saved Room" });
  assert("a-store-that-never-saved-reports-no-stored-data",
    neverStore.storageWriteFailure()?.hasStoredData === false,
    neverStore.storageWriteFailure());
  // And the positive branch: once something HAS been saved, the flag says so.
  const hadSave = healingStorage();
  const hadSaveStore = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: hadSave });
  hadSaveStore.createRoom({ name: "Stored First" });
  hadSave.allow(false);
  hadSaveStore.createRoom({ name: "Refused After" });
  assert("a-store-with-an-earlier-save-reports-stored-data",
    hadSaveStore.storageWriteFailure()?.hasStoredData === true,
    hadSaveStore.storageWriteFailure());


  // A dangling reference is shape-perfect, so only the semantics pass catches it.
  // This is the case that reproduced the fabricated "in the ." answer publicly.
  const danglingRaw = JSON.stringify({ version: 2, records: [
    ...JSON.parse(savedDump).records,
    { recordType: "commit", id: "commit-dangling-boot", at: new Date(NOW + 60_000).toISOString(),
      summary: "dangling", sourceProposalId: null, sourceObservationIds: [],
      ops: [{ type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "ghost-room" }, relation: "inside", confidence: 0.9, evidenceIds: [] }] },
  ] });
  const danglingStorage = memStorage();
  danglingStorage.setItem("nestory-v2", danglingRaw);
  const danglingShapeOk = (() => { try { validatedLedgerRecords(JSON.parse(danglingRaw), "Probe"); return true; } catch { return false; } })();
  const danglingBoot = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: danglingStorage });
  assert("load-from-storage-catches-shape-perfect-dangling-reference",
    danglingShapeOk && danglingBoot.storageRecovery() !== null
      && !/in the \.|in the$/.test(danglingBoot.locate("passport").sentence),
    danglingShapeOk ? danglingBoot.locate("passport").sentence : "fixture was refused by SHAPE, so it cannot prove the semantics pass");


  // Every reference class the semantics pass resolves. Each is SHAPE-PERFECT — the
  // dumps below pass `validatedLedgerRecords` untouched — so each one also proves that
  // shape is not being used as authority for meaning.
  const danglingCases: Array<[string, unknown, RegExp]> = [
    ["item", commitWith([{ type: "create_placement", itemId: "ghost-item", placeRef: { type: "room", id: "bedroom" }, relation: "inside", confidence: 1 }]),
      /unknown Belonging ghost-item/],
    ["container parent", commitWith([{ type: "create_container", container: { id: "orphan", name: "Orphan", kind: "box", parent: { type: "room", id: "nowhere" }, box: { label: "O", destination: "D", operationId: null } } }]),
      /unknown Place Reference room:nowhere/],
    ["state on a ghost", commitWith([{ type: "set_state", itemId: "ghost-2", state: "at_home" }]),
      /unknown Belonging ghost-2/],
    ["merge of ghosts", commitWith([{ type: "merge_belongings", keepId: "ghost-a", mergeId: "ghost-b" }]),
      /unknown Belonging ghost-a/],
    ["confirm a ghost container", commitWith([{ type: "confirm_container", containerId: "no-such-container" }]),
      /unknown Container no-such-container/],
    ["decide a ghost proposal", commitWith([{ type: "accept_proposal", proposalId: "no-such-proposal" }]),
      /unknown Proposal no-such-proposal/],
    ["box status on a ghost container", commitWith([{ type: "set_box_status", boxId: "no-such-container", status: "packed" }]),
      /unknown Container no-such-container/],
    ["evidence that does not exist", commitWith([{ type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "bedroom" }, relation: "inside", confidence: 1, evidenceIds: ["ev-ghost"] }]),
      /unknown Evidence ev-ghost/],
    ["row on a ghost operation", commitWith([{ type: "set_op_row_status", opId: "no-op", rowId: "no-row", status: "found" }]),
      /unknown Operation row no-op:no-row/],
  ];
  for (const [label, payload, pattern] of danglingCases) {
    const shapeOk = (() => { try { validatedLedgerRecords(payload, "Probe"); return true; } catch { return false; } })();
    const outcome = rejected(payload);
    assert(`import-rejects-dangling-${label.replace(/[^a-z]+/gi, "-").toLowerCase()}`,
      shapeOk && outcome.threw && pattern.test(outcome.message),
      shapeOk ? outcome.message : `fixture was refused by SHAPE, so it cannot prove the semantics pass`);
  }

  // A `reset_to_seed` record must confer NOTHING on later records in the same dump.
  // `derive()` treats it as a no-op when replaying an imported ledger, so crediting the
  // seed's ids would let a dump reference containers the store will never know — which
  // reproduced the exact fabricated answer this validation exists to prevent.
  const resetGrantsNothing = rejected({ version: 2, records: [
    { recordType: "commit", id: "r-reset", at: "2026-01-01T00:00:00.000Z", summary: "reset", ops: [{ type: "reset_to_seed" }] },
    { recordType: "commit", id: "c-after", at: "2026-01-01T00:00:00.000Z", summary: "use a seed-commit container",
      ops: [{ type: "create_placement", itemId: "passport", placeRef: { type: "container", id: "box-essentials" }, relation: "inside", confidence: 1 }] },
  ] });
  assert("import-reset-to-seed-confers-no-references",
    resetGrantsNothing.threw && /unknown Place Reference container:box-essentials/.test(resetGrantsNothing.message),
    resetGrantsNothing.message);

  // ...and the same reference is refused without the reset too, so the lock above is
  // about the reset vehicle rather than about that container being unknown in general.
  const noResetSameRef = rejected(commitWith([
    { type: "create_placement", itemId: "passport", placeRef: { type: "container", id: "box-essentials" }, relation: "inside", confidence: 1 },
  ]));
  assert("import-seed-commit-container-is-unknown-without-a-reset",
    noResetSameRef.threw && /unknown Place Reference container:box-essentials/.test(noResetSameRef.message),
    noResetSameRef.message);

  // No import may leave a placement whose chain cannot be rendered. This asserts the
  // PRODUCT outcome rather than the validator's internals: whatever a dump does, the
  // answer must never name an empty place.
  const noEmptyPlace = fresh();
  for (const attempt of [
    { version: 2, records: [
      { recordType: "commit", id: "r1", at: "2026-01-01T00:00:00.000Z", summary: "reset", ops: [{ type: "reset_to_seed" }] },
      { recordType: "commit", id: "c1", at: "2026-01-01T00:00:00.000Z", summary: "x",
        ops: [{ type: "create_placement", itemId: "passport", placeRef: { type: "container", id: "box-essentials" }, relation: "inside", confidence: 1 }] },
    ] },
    commitWith([{ type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "nowhere" }, relation: "inside", confidence: 1 }]),
  ]) {
    try { noEmptyPlace.importJson(attempt); } catch { /* expected */ }
  }
  const afterAttempts = noEmptyPlace.locate("passport");
  assert("no-import-can-produce-an-answer-naming-an-empty-place",
    afterAttempts.ok === false || afterAttempts.sentence.includes("Bedside drawer"),
    afterAttempts.sentence);

  // The same fabrication originates at the WRITE path, with no import involved: an
  // unresolvable place produced "... is probably in the ." live. Every writer that takes
  // a place must refuse one the Place Graph does not contain, or the gate above merely
  // makes the resulting export unrestorable instead of preventing the bad state.
  const ghost = { type: "room", id: "ghost-room" } as const;
  const writerRefuses = (label: string, drive: (store: Store) => void): void => {
    const st = fresh();
    let threw = "";
    try { drive(st); } catch (err) { threw = err instanceof Error ? err.message : String(err); }
    assert(`write-path-refuses-${label}`, threw !== "", threw || "the writer accepted an unresolvable reference");
  };
  writerRefuses("an-unresolvable-default-home", (st) => { st.createBelonging({ name: "Ghosted", kinds: ["k"], defaultHome: ghost }); });
  writerRefuses("an-unresolvable-placement", (st) => { st.correctPlacement("passport", ghost); });
  writerRefuses("an-unresolvable-review-target", (st) => {
    const out = st.markNotThere("passport");
    st.acceptProposal(out.proposalId, { placeRef: { type: "container", id: "invented" } });
  });
  writerRefuses("a-row-status-on-an-unknown-row", (st) => {
    const t = catalog.operationTemplates[0];
    if (!t) throw new Error("no template");
    st.setRowStatus(st.startOperation(t.id), "row-hallucinated", "found");
  });
  writerRefuses("a-status-on-an-unknown-operation", (st) => { st.setOperationStatus("ghost-op", "done"); });
  // `setItemState` took a caller-supplied item id unvalidated while its two siblings above
  // were guarded, so it wrote a commit the reader then refused — the store's own export
  // became unreadable, including on self-restore.
  writerRefuses("a-state-change-on-an-unknown-item", (st) => { st.setItemState("hallucinated-item-id", "with_me"); });
  // Domain as well as existence. `setRowStatus` and `setBoxStatus` check both; this one
  // checked only existence, so it wrote a status the reader refuses — the same
  // writer/reader disagreement, one enum short instead of one reference short.
  // A proposal is a suggestion, never authority: a CONCRETE placeRef stored in
  // `suggestedOps` is re-checked at accept time, not only the one supplied at Review.
  // Guarding only the Review branch let an accept MINT a fresh fabricating commit
  // ("... is probably in the .") through this writer, reachable via the pinned
  // `loadRecords` gap.
  writerRefuses("accepting-a-proposal-whose-stored-place-no-longer-resolves", () => {
    const other = fresh();
    other.importJson({ version: 2, records: [
      { recordType: "observation", id: "o-sp", type: "manual_note", at: "2026-02-01T00:00:00.000Z" },
      { recordType: "commit", id: "c-sp", at: "2026-02-01T00:00:00.000Z", summary: "a room that will be referenced",
        sourceObservationIds: [], ops: [{ type: "create_room", room: { id: "vanishing", name: "Vanishing", plan: { x: 0, y: 0, w: 1, h: 1 } } }] },
      { recordType: "proposal", id: "p-sp", type: "placement_correction", at: "2026-02-02T00:00:00.000Z",
        sourceObservationIds: ["o-sp"], summary: "put it there",
        suggestedOps: [{ type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "vanishing" }, relation: "inside", confidence: 0.9 }] },
    ] });
    // The room DOES exist here, so this accept must succeed — the refusal case is driven
    // through storage below, where the reference never resolved at all.
    other.acceptProposal("p-sp");
    // Now the real refusal: a store booted from unvalidated storage holding a proposal
    // whose concrete place never existed.
    const tampered = memStorage();
    tampered.setItem("nestory-v2", JSON.stringify({ version: 2, records: [
      ...(JSON.parse(JSON.stringify(fresh().exportJson())) as ReturnType<Store["exportJson"]>).records,
      { recordType: "observation", id: "o-gh", type: "manual_note", at: "2026-02-01T00:00:00.000Z" },
      { recordType: "proposal", id: "p-gh", type: "placement_correction", at: "2026-02-01T00:00:00.000Z",
        sourceObservationIds: ["o-gh"], summary: "ghost place",
        suggestedOps: [{ type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "ghost-room" }, relation: "inside", confidence: 0.9 }] },
    ] }));
    const booted = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: tampered });
    booted.acceptProposal("p-gh");
  });

  writerRefuses("an-out-of-domain-operation-status", (st) => {
    const t = catalog.operationTemplates.find((x) => x.type === "kit");
    if (!t) throw new Error("no kit template");
    st.setOperationStatus(st.startOperation(t.id), "paused" as never);
  });
  // Accepting a proposal re-runs ops that were coherent when the proposal was MADE. A
  // suggested `create_*` whose id has since been taken replaced the real record in place:
  // the answer a person reads silently changed (REAL SHELF -> SUGGESTED) and the export
  // could not be restored. Reachable from the Accept button once such a proposal exists.
  // All FOUR id-taking op types, not just the three found by review. `create_operation`
  // was the fourth: a stale suggestion replaced a real kit in place (REAL KIT ->
  // SUGGESTED KIT) and left an unrestorable export. Enumerating the op union beat waiting
  // for the next round to find it.
  // All FOUR id-taking op types, not just the three found by review. `create_operation`
  // was the fourth: a stale suggestion replaced a real kit in place (REAL KIT ->
  // SUGGESTED KIT) and left an unrestorable export. Enumerating the op union beat waiting
  // for the next round to find it.
  //
  // Each fixture must make the id free AT IMPORT and taken BY ACCEPT — one dump where a
  // LATER commit claims the same id. A fixture pointing at a catalog id instead is refused
  // by the IMPORT, so the accept guard is never exercised and the lock passes vacuously;
  // two of these were written that way first and proved unlocked under mutation.
  const staleCreateCases: Array<[string, unknown, unknown]> = [
    ["room",
      { type: "create_room", room: { id: "clash-room", name: "SUGGESTED", plan: { x: 0, y: 0, w: 1, h: 1 } } },
      { type: "create_room", room: { id: "clash-room", name: "REAL ROOM", plan: { x: 0, y: 0, w: 2, h: 2 } } }],
    ["belonging",
      { type: "create_belonging", belonging: { id: "clash-item", name: "SUGGESTED", kinds: ["k"], importance: "normal", defaultHome: { type: "room", id: "bedroom" } } },
      { type: "create_belonging", belonging: { id: "clash-item", name: "REAL ITEM", kinds: ["k"], importance: "normal", defaultHome: { type: "room", id: "bedroom" } } }],
    ["container",
      { type: "create_container", container: { id: "clash-box", name: "SUGGESTED", kind: "shelf", parent: { type: "room", id: "bedroom" } } },
      { type: "create_container", container: { id: "clash-box", name: "REAL SHELF", kind: "shelf", parent: { type: "room", id: "bedroom" } } }],
    ["operation",
      { type: "create_operation", operation: { id: "clash-op", type: "kit", name: "SUGGESTED KIT", startedAt: "2026-02-01T00:00:00.000Z", status: "active", rows: [] } },
      { type: "create_operation", operation: { id: "clash-op", type: "kit", name: "REAL KIT", startedAt: "2026-02-02T00:00:00.000Z", status: "active", rows: [] } }],
  ];
  for (const [label, suggested, real] of staleCreateCases) {
    writerRefuses(`accepting-a-proposal-that-would-replace-an-existing-${label}`, () => {
      const other = fresh();
      other.importJson({ version: 2, records: [
        { recordType: "observation", id: `o-${label}`, type: "manual_note", at: "2026-02-01T00:00:00.000Z" },
        { recordType: "proposal", id: `p-${label}`, type: "contents_update", at: "2026-02-01T00:00:00.000Z",
          sourceObservationIds: [`o-${label}`], summary: "stale suggestion", suggestedOps: [suggested] },
        { recordType: "commit", id: `c-${label}`, at: "2026-02-02T00:00:00.000Z", summary: "the real record",
          sourceObservationIds: [], ops: [real] },
      ] });
      other.acceptProposal(`p-${label}`);
    });
  }


  writerRefuses("accepting-a-proposal-that-would-replace-a-real-record", (st) => {
    const realId = st.createContainer({ name: "Real shelf", kind: "shelf", roomId: "bedroom" });
    const staleProposal = { version: 2, records: [
      { recordType: "observation", id: "obs-stale", type: "manual_note", at: "2026-02-01T00:00:00.000Z" },
      { recordType: "proposal", id: "p-stale", type: "container_refresh", at: "2026-02-01T00:00:00.000Z",
        sourceObservationIds: ["obs-stale"], summary: "suggest a container",
        suggestedOps: [{ type: "create_container", container: { id: realId, name: "SUGGESTED", kind: "shelf", parent: { type: "room", id: "bedroom" } } }] },
    ] };
    // The proposal cannot be imported once the id is taken, so build the state the other
    // way round: import first (id free in replay order), then create, then accept.
    const other = fresh();
    other.importJson(staleProposal);
    other.createContainer({ name: "Real shelf", kind: "shelf", roomId: "bedroom" });
    other.acceptProposal("p-stale");
  });
  // `unpackItem` takes a caller-supplied target and writes it straight into a placement.
  // It was the one place-taking writer that never called the guard, and it reproduced the
  // fabricated sentence at confidence 0.92 with no import involved. The write-path sweep
  // could not catch it because that sweep only ever passes VALID places.
  writerRefuses("an-unresolvable-unpack-target", (st) => { st.unpackItem("passport", ghost); });
  // A `state` ref resolves through `placeNode` unconditionally — it synthesises a node from
  // the id itself — so existence alone cannot judge it, and the guard let any string
  // through while the import pass checks LIFECYCLE_STATES. The two passes must agree.
  const bogusState = { type: "state", id: "not_a_state" } as const;
  writerRefuses("a-bogus-lifecycle-state-as-a-placement", (st) => { st.correctPlacement("passport", bogusState); });
  writerRefuses("a-bogus-lifecycle-state-as-a-default-home", (st) => { st.createBelonging({ name: "Ghosted", kinds: ["k"], defaultHome: bogusState }); });
  writerRefuses("a-bogus-lifecycle-state-as-an-unpack-target", (st) => { st.unpackItem("passport", bogusState); });
  writerRefuses("a-bogus-lifecycle-state-as-a-review-target", (st) => {
    const out = st.markNotThere("passport");
    st.acceptProposal(out.proposalId, { placeRef: bogusState });
  });
  // ...and a REAL lifecycle state must still be usable as a place, or the guard is too blunt.
  const validState = fresh();
  let validStateThrew = "";
  try { validState.correctPlacement("passport", { type: "state", id: "with_me" }); }
  catch (err) { validStateThrew = err instanceof Error ? err.message : String(err); }
  const validStateDump = JSON.parse(JSON.stringify(validState.exportJson())) as ReturnType<Store["exportJson"]>;
  let validStateImport = "";
  try { fresh().importJson(validStateDump); } catch (err) { validStateImport = err instanceof Error ? err.message : String(err); }
  assert("write-path-accepts-a-real-lifecycle-state-as-a-place",
    validStateThrew === "" && validStateImport === "",
    validStateThrew || validStateImport || "state:with_me writes and re-imports");

  // ...and the live answer stays honest after those refusals: no fabricated place.
  const afterWriterRefusals = fresh();
  for (const attempt of [
    () => afterWriterRefusals.correctPlacement("passport", ghost),
    () => afterWriterRefusals.createBelonging({ name: "Ghosted", kinds: ["k"], defaultHome: ghost }),
  ]) { try { attempt(); } catch { /* expected */ } }
  const honest = afterWriterRefusals.locate("passport");
  assert("write-path-refusals-leave-the-answer-honest",
    honest.ok && honest.sentence.includes("Bedside drawer"), honest.sentence);

  // Cross-catalog import is refused, and this is a DELIBERATE behaviour change worth
  // pinning: a demo-home dump imported into an own-home store references catalog items
  // that store has no catalog for. The base accepted it and answered honestly ("no
  // memory of ..."), so this is a stricter stance rather than a bug fix — the dump is
  // refused up front instead of installing records whose subjects do not exist. Pinned
  // so the trade-off is visible and any future change to it is deliberate.
  const ownHome = createStore({ catalog: emptyCatalog, seedFactory: () => [], now: () => NOW, storage: null });
  const demoDump = JSON.parse(JSON.stringify(fresh().exportJson())) as ReturnType<Store["exportJson"]>;
  let crossThrew = "";
  try { ownHome.importJson(demoDump); } catch (err) { crossThrew = err instanceof Error ? err.message : String(err); }
  assert("import-refuses-a-dump-whose-catalog-subjects-are-absent",
    crossThrew !== "" && /references unknown Belonging/.test(crossThrew),
    crossThrew || "a demo dump is refused by an own-home store");
  assert("import-refusal-leaves-the-own-home-store-empty-not-half-filled",
    ownHome.exportJson().records.length === 0, `${ownHome.exportJson().records.length} records`);

  // An id collision must NOT be treated as a merge. On the base, importing an own-home
  // dump whose room id is `bedroom` silently REPLACED the demo room of that id in place
  // — the user's room name overwrote a real one. That is the harm; refusing is correct.
  // The message tells the person what to do (import into a fresh home).
  const ownSource = createStore({ catalog: emptyCatalog, seedFactory: () => [], now: () => NOW, storage: null });
  const ownRoom = ownSource.createRoom({ name: "Bedroom" });
  ownSource.createBelonging({ name: "Lamp", kinds: ["light"], defaultHome: { type: "room", id: ownRoom } });
  const ownDump = JSON.parse(JSON.stringify(ownSource.exportJson())) as ReturnType<Store["exportJson"]>;
  const collision = rejected(ownDump);
  assert("import-refuses-to-replace-an-existing-place-in-situ",
    collision.threw && /would replace the existing Room bedroom/.test(collision.message)
      && /fresh home/.test(collision.message),
    collision.message);
  // ...and a create whose id is genuinely free still works, so this is not blanket
  // hostility to imported creates.
  const freshCreate = rejected({ version: 2, records: [
    { recordType: "commit", id: "c-new", at: "2026-01-01T00:00:00.000Z", summary: "new room",
      ops: [{ type: "create_room", room: { id: "attic", name: "Attic", plan: { x: 0, y: 0, w: 2, h: 2 } } }] },
  ] });
  assert("import-accepts-a-create-whose-id-is-free", freshCreate.threw === false, freshCreate.message);

  // Replacing an existing belonging or merging one into itself is refused for the same
  // reason: both mutate a real record in place rather than resolving to one.
  const replaceItem = rejected(commitWith([{ type: "create_belonging", belonging: { id: "passport", name: "Fake passport", kinds: ["k"], importance: "normal", defaultHome: { type: "room", id: "bedroom" } } }]));
  assert("import-refuses-to-replace-an-existing-belonging",
    replaceItem.threw && /would replace the existing Belonging passport/.test(replaceItem.message), replaceItem.message);
  const selfMerge = rejected(commitWith([{ type: "merge_belongings", keepId: "passport", mergeId: "passport" }]));
  assert("import-refuses-merging-a-belonging-into-itself",
    selfMerge.threw && /cannot merge a Belonging into itself/.test(selfMerge.message), selfMerge.message);

  // A commit may decide more than one proposal. Whether it must LINK each is a separate
  // Review-integrity rule; enforcing it here refused a legitimate export.
  const twoDecisions = fresh();
  const pendingPair = twoDecisions.proposals().filter((pr) => pr.status === "pending");
  const pairFirst = pendingPair[0];
  const pairSecond = pendingPair[1];
  if (pairFirst && pairSecond) {
    const paired = { version: 2, records: [
      ...(JSON.parse(JSON.stringify(twoDecisions.exportJson())) as ReturnType<Store["exportJson"]>).records,
      { recordType: "commit", id: "c-two", at: "2026-02-01T00:00:00.000Z", summary: "decide two",
        sourceProposalId: pairFirst.id, sourceObservationIds: [],
        ops: [{ type: "accept_proposal", proposalId: pairFirst.id }, { type: "accept_proposal", proposalId: pairSecond.id }] },
    ] };
    let pairThrew = "";
    try { fresh().importJson(paired); } catch (err) { pairThrew = err instanceof Error ? err.message : String(err); }
    assert("import-accepts-one-commit-deciding-two-proposals", pairThrew === "", pairThrew);
  }
  // An already-decided proposal cannot be decided again — that IS resolution.
  const doubleDecide = fresh();
  const onePending = doubleDecide.proposals().find((pr) => pr.status === "pending");
  if (onePending) {
    const twice = { version: 2, records: [
      ...(JSON.parse(JSON.stringify(doubleDecide.exportJson())) as ReturnType<Store["exportJson"]>).records,
      { recordType: "commit", id: "d1", at: "2026-02-01T00:00:00.000Z", summary: "accept", sourceProposalId: onePending.id, sourceObservationIds: [], ops: [{ type: "accept_proposal", proposalId: onePending.id }] },
      { recordType: "commit", id: "d2", at: "2026-02-02T00:00:00.000Z", summary: "accept again", sourceProposalId: onePending.id, sourceObservationIds: [], ops: [{ type: "accept_proposal", proposalId: onePending.id }] },
    ] };
    const twiceOut = rejected(twice);
    assert("import-rejects-deciding-an-already-decided-proposal",
      twiceOut.threw && /already-decided Proposal/.test(twiceOut.message), twiceOut.message);
  }
  // Box status follows the writer: any container, not only kind "box".
  const suitcase = fresh();
  const caseId = suitcase.createContainer({ name: "Trip suitcase", kind: "suitcase", roomId: "bedroom" });
  suitcase.setBoxStatus(caseId, "packed");
  const caseDump = JSON.parse(JSON.stringify(suitcase.exportJson())) as ReturnType<Store["exportJson"]>;
  let caseThrew = "";
  try { fresh().importJson(caseDump); } catch (err) { caseThrew = err instanceof Error ? err.message : String(err); }
  assert("import-accepts-box-status-on-any-container-the-writer-allows", caseThrew === "", caseThrew);

  // Reference classes this pass does NOT resolve, pinned so "every reference resolves"
  // cannot be read as complete. None can produce a confident wrong PLACE answer — a
  // ghost operation simply renders nothing — so they are lower severity than the
  // placement classes, but they are real and belong in a later slice.
  const unresolvedClasses: Array<[string, unknown]> = [
    ["box operationId", commitWith([{ type: "create_container", container: { id: "b-op", name: "Box", kind: "box", parent: { type: "room", id: "bedroom" }, box: { label: "L", destination: "D", operationId: "ghost-op" } } }])],
    ["operation kitId", commitWith([{ type: "create_operation", operation: { id: "op-k", type: "kit", kitId: "ghost-kit", name: "Kit run", startedAt: "2026-01-01T00:00:00.000Z", status: "active", rows: [] } }])],
    ["row reqId", commitWith([{ type: "create_operation", operation: { id: "op-r", type: "kit", name: "Kit run", startedAt: "2026-01-01T00:00:00.000Z", status: "active", rows: [{ id: "r1", reqId: "ghost-req", reqLabels: ["x"], level: "required", itemId: null, status: "to_get", note: null, mergedRequirement: false }] } }])],
  ];
  const stillAccepted = unresolvedClasses.filter(([, payload]) => rejected(payload).threw === false).map(([label]) => label);
  assert("import-does-not-yet-resolve-non-placement-reference-classes",
    stillAccepted.length === unresolvedClasses.length,
    `documented gap: ${stillAccepted.join(", ")} still accepted; a later slice, and none yields a wrong place answer`);

  // Order matters, not just membership: a dump may legitimately create a room and then
  // place something in it. Refusing forward references would break real exports, so the
  // ledger is replayed rather than checked against a static set.
  const createsThenUses = rejected({ version: 2, records: [
    { recordType: "commit", id: "c-make", at: "2026-01-01T00:00:00.000Z", summary: "Add a room and use it",
      ops: [
        { type: "create_room", room: { id: "study", name: "Study", plan: { x: 0, y: 0, w: 3, h: 3 } } },
        { type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "study" }, relation: "inside", confidence: 1 },
      ] },
  ] });
  assert("import-accepts-a-reference-created-earlier-in-the-same-dump",
    createsThenUses.threw === false, createsThenUses.message || "create-then-use is accepted");

  const usesThenCreates = rejected({ version: 2, records: [
    { recordType: "commit", id: "c-early", at: "2026-01-01T00:00:00.000Z", summary: "Use before create",
      ops: [{ type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "study" }, relation: "inside", confidence: 1 }] },
    { recordType: "commit", id: "c-late", at: "2026-01-02T00:00:00.000Z", summary: "Create after use",
      ops: [{ type: "create_room", room: { id: "study", name: "Study", plan: { x: 0, y: 0, w: 3, h: 3 } } }] },
  ] });
  assert("import-rejects-a-reference-used-before-it-is-created",
    usesThenCreates.threw && /unknown Place Reference room:study/.test(usesThenCreates.message),
    usesThenCreates.message);

  // A proposal only SUGGESTS. Its ops must be coherent, but must not enter the accepted
  // set — otherwise an imported proposal could authorise a later commit without Review.
  const proposalDoesNotGrant = rejected({ version: 2, records: [
    { recordType: "observation", id: "obs-1", type: "manual_note", at: "2026-01-01T00:00:00.000Z" },
    { recordType: "proposal", id: "p-1", type: "placement_correction", at: "2026-01-01T00:00:00.000Z",
      sourceObservationIds: ["obs-1"], summary: "Suggest a new room",
      suggestedOps: [{ type: "create_room", room: { id: "ghost-room", name: "Ghost", plan: { x: 0, y: 0, w: 1, h: 1 } } }] },
    { recordType: "commit", id: "c-uses", at: "2026-01-02T00:00:00.000Z", summary: "Use the suggested room",
      ops: [{ type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "ghost-room" }, relation: "inside", confidence: 1 }] },
  ] });
  assert("import-does-not-let-a-proposal-grant-what-review-has-not-committed",
    proposalDoesNotGrant.threw && /unknown Place Reference room:ghost-room/.test(proposalDoesNotGrant.message),
    proposalDoesNotGrant.message);

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

  // A3 for the SEMANTIC path specifically. The previous slice measured this for shape
  // refusals; a semantic refusal happens later in the same function, so it needs its own
  // measurement rather than an assumption that the ordering still holds.
  const semStorage = memStorage();
  const semGuarded = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: semStorage });
  semGuarded.createBelonging({ name: "Semantic primer", kinds: ["primer"], defaultHome: { type: "room", id: "bedroom" } });
  const semBeforeCount = semGuarded.exportJson().records.length;
  const semBeforeIds = semGuarded.exportJson().records.map((r) => r.id).join(",");
  const semPersistedBefore = semStorage.getItem("nestory-v2");
  assert("semantic-refusal-fixture-has-real-persisted-state",
    typeof semPersistedBefore === "string" && semPersistedBefore.length > 0,
    "storage must hold real content before the refusal or the storage assertion proves nothing");
  let semRefused = "";
  try {
    semGuarded.importJson(commitWith([
      { type: "create_placement", itemId: "passport", placeRef: { type: "room", id: "room-does-not-exist" }, relation: "inside", confidence: 1 },
    ]));
  } catch (err) { semRefused = err instanceof Error ? err.message : String(err); }
  const semAfter = semGuarded.exportJson().records;
  assert("semantic-refusal-leaves-records-unchanged",
    semRefused !== "" && semAfter.length === semBeforeCount && semAfter.map((r) => r.id).join(",") === semBeforeIds,
    `${semBeforeCount} -> ${semAfter.length}`);
  assert("semantic-refusal-writes-nothing-to-storage",
    semStorage.getItem("nestory-v2") === semPersistedBefore,
    `persisted changed: ${semStorage.getItem("nestory-v2") !== semPersistedBefore}`);
  const semSeqOf = (mintedId: string): string => mintedId.split("-")[1] ?? "";
  const semControl = createStore({ catalog, seedFactory: () => buildSeedRecords(NOW), now: () => NOW, storage: memStorage() });
  semControl.createBelonging({ name: "Semantic primer", kinds: ["primer"], defaultHome: { type: "room", id: "bedroom" } });
  const semControlSeq = semSeqOf(semControl.createBelonging({ name: "Seq probe", kinds: ["probe"], defaultHome: { type: "room", id: "bedroom" } }));
  const semGuardedSeq = semSeqOf(semGuarded.createBelonging({ name: "Seq probe", kinds: ["probe"], defaultHome: { type: "room", id: "bedroom" } }));
  assert("semantic-refusal-leaves-seq-unchanged",
    semGuardedSeq !== "" && semGuardedSeq === semControlSeq,
    `minted seq after semantic refusal ${semGuardedSeq} vs untouched control ${semControlSeq}`);

  // THE INVARIANT, extended to semantics: whatever the store's own write path produces
  // must re-import. The previous slice locked this for field boundaries; a hand-picked
  // sequence is not enough, because a single unexercised method is exactly how the last
  // instance hid (`unpackItem` emitting a box status against a room). This drives EVERY
  // public write method and re-imports each resulting export.
  const semanticSelfInflicted: string[] = [];
  const skippedWrites: string[] = [];
  const writeRoundTrips = (label: string, drive: (store: Store) => void): void => {
    const w = fresh();
    // A silent skip would hide a FALSE REJECTION: if a guard wrongly refuses valid input,
    // the scenario never reaches the import check and the sweep still reads green. Record
    // every skip and assert the count is zero, so a refusal cannot masquerade as a pass.
    try { drive(w); }
    catch (err) { skippedWrites.push(`${label}: ${err instanceof Error ? err.message : String(err)}`); return; }
    const dump = JSON.parse(JSON.stringify(w.exportJson())) as ReturnType<Store["exportJson"]>;
    try { fresh().importJson(dump); }
    catch (err) { semanticSelfInflicted.push(`${label}: ${err instanceof Error ? err.message : String(err)}`); }
  };
  const inBedroom = { type: "room", id: "bedroom" } as const;
  writeRoundTrips("createRoom", (st) => { st.createRoom({ name: "Study" }); });
  writeRoundTrips("createContainer", (st) => { st.createContainer({ name: "Tray", kind: "tray", roomId: "bedroom" }); });
  writeRoundTrips("createBox", (st) => { st.createBox({ label: "Kitchen", destination: "New home" }); });
  writeRoundTrips("createBelonging", (st) => { st.createBelonging({ name: "Lamp", kinds: ["light"], defaultHome: inBedroom }); });
  writeRoundTrips("createBelonging into a new container", (st) => {
    const c = st.createContainer({ name: "Shelf", kind: "shelf", roomId: "bedroom" });
    st.createBelonging({ name: "Book", kinds: ["book"], defaultHome: { type: "container", id: c } });
  });
  writeRoundTrips("correctPlacement", (st) => { st.correctPlacement("passport", inBedroom, { note: "moved it" }); });
  writeRoundTrips("setItemState", (st) => { st.setItemState("passport", "with_me"); });
  writeRoundTrips("snapshotContainer", (st) => { st.snapshotContainer("entry-tray", "usb-c charger, coins"); });
  writeRoundTrips("acceptProposal", (st) => { const pr = st.proposals().find((x) => x.status === "pending"); if (pr) st.acceptProposal(pr.id); });
  writeRoundTrips("acceptProposal (all pending)", (st) => { for (const pr of st.proposals().filter((x) => x.status === "pending")) st.acceptProposal(pr.id); });
  writeRoundTrips("rejectProposal", (st) => { const pr = st.proposals().find((x) => x.status === "pending"); if (pr) st.rejectProposal(pr.id, "not right"); });
  writeRoundTrips("rejectProposal blank reason", (st) => { const pr = st.proposals().find((x) => x.status === "pending"); if (pr) st.rejectProposal(pr.id, ""); });
  writeRoundTrips("setBoxStatus on a box", (st) => { st.setBoxStatus("box-essentials", "packed"); });
  writeRoundTrips("setBoxStatus on a non-box", (st) => { const c = st.createContainer({ name: "Trip suitcase", kind: "suitcase", roomId: "bedroom" }); st.setBoxStatus(c, "packed"); });
  writeRoundTrips("assignToBox", (st) => { st.assignToBox("passport", "box-essentials"); });
  writeRoundTrips("assignToBox then unpack", (st) => { st.assignToBox("passport", "box-essentials"); st.unpackItem("passport"); });
  writeRoundTrips("assignToBox two items then unpack one", (st) => {
    st.assignToBox("passport", "box-essentials");
    st.assignToBox("earphones", "box-essentials");
    st.unpackItem("passport");
  });
  writeRoundTrips("unpackItem from its default home", (st) => { st.unpackItem("passport"); });
  writeRoundTrips("unpackItem after a room placement", (st) => { st.correctPlacement("passport", inBedroom); st.unpackItem("passport"); });
  writeRoundTrips("unpackItem out of a box", (st) => { st.correctPlacement("passport", { type: "container", id: "box-essentials" }); st.unpackItem("passport"); });
  writeRoundTrips("unpackItem to an explicit place", (st) => { st.unpackItem("passport", inBedroom); });
  writeRoundTrips("markNotThere", (st) => { st.markNotThere("passport"); });
  writeRoundTrips("markNotThere then accept the proposal", (st) => {
    const out = st.markNotThere("passport");
    st.acceptProposal(out.proposalId, { placeRef: inBedroom });
  });
  writeRoundTrips("confirmContainer", (st) => { st.confirmContainer("bedside-drawer"); });
  // EVERY template, selected by id rather than by index. An earlier version used
  // `operationTemplates[0]`, which is the `move` template — it has no rows, so the
  // `view.type === "kit"` branch was never taken and `setRowStatus` was NEVER CALLED
  // inside this sweep. The scenario read green while testing nothing, which is how a
  // whole writer stayed unswept. Assertions below prove each row scenario really ran.
  let rowScenariosRun = 0;
  for (const t of catalog.operationTemplates) {
    writeRoundTrips(`startOperation ${t.id}`, (st) => { st.startOperation(t.id); });
    writeRoundTrips(`setOperationStatus after ${t.id}`, (st) => { st.setOperationStatus(st.startOperation(t.id), "done"); });
    for (const status of ROW_STATUSES) {
      writeRoundTrips(`setRowStatus ${status} on ${t.id}`, (st) => {
        const opId = st.startOperation(t.id);
        const view = st.operationView(opId);
        const row = view && view.type === "kit" ? view.rows[0] : undefined;
        if (!row) return; // `move` operations legitimately have no rows
        st.setRowStatus(opId, row.id, status);
        rowScenariosRun += 1;
      });
    }
  }
  assert("write-path-sweep-actually-exercised-row-status", rowScenariosRun >= ROW_STATUSES.length,
    `${rowScenariosRun} setRowStatus scenarios ran; a kit template must be driven, not just \`move\``);
  writeRoundTrips("reset", (st) => { st.reset(); });
  writeRoundTrips("reset then write", (st) => { st.reset(); st.createRoom({ name: "After" }); st.createBelonging({ name: "Post", kinds: ["p"], defaultHome: inBedroom }); });
  writeRoundTrips("write, reset, write", (st) => { st.createRoom({ name: "Before" }); st.reset(); st.createRoom({ name: "After" }); });
  writeRoundTrips("long lived-in session", (st) => {
    const r = st.createRoom({ name: "Study" });
    const c = st.createContainer({ name: "Shelf", kind: "shelf", roomId: r });
    st.createBelonging({ name: "Book", kinds: ["book"], defaultHome: { type: "container", id: c } });
    st.createBox({ label: "Move", destination: "New place" });
    st.correctPlacement("passport", { type: "container", id: c }, { note: "" });
    st.setItemState("passport", "packed");
    const pr = st.proposals().find((x) => x.status === "pending"); if (pr) st.acceptProposal(pr.id);
    st.snapshotContainer("entry-tray", "coins");
    st.unpackItem("passport");
  });
  assert("import-accepts-everything-the-write-path-writes-semantically",
    semanticSelfInflicted.length === 0,
    semanticSelfInflicted.length ? semanticSelfInflicted.slice(0, 4).join(" | ") : "every driven write path re-imports");
  assert("write-path-sweep-skipped-nothing",
    skippedWrites.length === 0,
    skippedWrites.length ? skippedWrites.slice(0, 4).join(" | ") : "no valid scenario was refused by a writer");

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

    // The saved-state recovery notice must be reachable from EVERY view, not just Home.
    // This regressed once and was caught by review: in "own" mode an unreadable ledger
    // derives an empty home, so the app opens on `setup` — and a Home-only banner left
    // the person being invited to build a home from scratch while their real record sat
    // unread in storage. The notice is rendered by the shell for that reason. The probe
    // drives the REAL boot: write an unreadable ledger, reload, and look at the DOM.
    const recoveryViews = await evalPage<{ landed: string; onLanding: boolean; everyView: string[]; missing: string[] }>(`(async () => {
      // The recordType carries an injection payload on purpose: the validator quotes the
      // offending value verbatim into its message, which the notice then renders. A plain
      // malformed string produces a reason with no "<" in it and could never exercise the
      // escaping path this fixture also has to cover.
      localStorage.setItem("nestory-v2-own", JSON.stringify({ version: 2, records: [
        { recordType: '<img src=x onerror="alert(1)">', id: "x" },
      ] }));
      localStorage.removeItem("nestory-v2-own-unreadable");
      location.reload();
      return null;
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const recoveryDom = await evalPage<{ recovered: boolean; landed: string; onLanding: boolean; missing: string[]; text: string; heading: string; preservedAt: string | null; originalKey: string; visible: boolean; originalBytes: number | null; role: string | null; reasonEscaped: boolean; liveElementInBanner: boolean }>(`(() => {
      const seen = (window.nestory.store.storageRecovery() !== null);
      const landed = window.nestory.ui.view;
      const onLanding = Boolean(document.querySelector('[data-testid="storage-recovery-banner"]'));
      const missing = [];
      for (const v of ["home", "ask", "capture", "setup", "spaces", "belongings", "operations", "review", "plan", "ledger"]) {
        window.nestory.setView(v);
        if (!document.querySelector('[data-testid="storage-recovery-banner"]')) missing.push(v);
      }
      const b = document.querySelector('[data-testid="storage-recovery-banner"]');
      const h = b ? b.querySelector("h3") : null;
      const rec = window.nestory.store.storageRecovery();
      return { recovered: seen, landed, onLanding, missing,
               preservedAt: rec ? rec.preservedAt : null,
               originalKey: rec ? rec.originalKey : "",
               visible: Boolean(b && b.offsetParent !== null && b.getClientRects().length > 0),
               originalBytes: rec ? rec.originalBytes : null,
               role: b ? b.getAttribute("role") : null,
               reasonEscaped: Boolean(b && b.innerHTML.includes("&lt;img")),
               liveElementInBanner: Boolean(b && b.querySelector("img")),
               text: b ? b.textContent.replace(/\\s+/g, " ").trim() : "",
               heading: h ? h.textContent.replace(/\\s+/g, " ").trim() : "" };
    })()`);
    assert("own-mode-unreadable-ledger-still-boots", recoveryDom.recovered === true,
      "the probe must actually produce a recovered boot or the locks below prove nothing");
    assert("recovery-notice-shown-on-the-landing-view", recoveryDom.onLanding === true,
      `landed on ${recoveryDom.landed} with no recovery notice`);
    assert("recovery-notice-shown-on-every-view", recoveryDom.missing.length === 0,
      `views missing the recovery notice: ${recoveryDom.missing.join(", ")}`);
    // Present in the DOM is not the same claim as seen by the person, and this slice is
    // about being TOLD. Every lock here uses querySelector, which finds hidden elements
    // happily — a banner with display:none passes all of them and the interface walk too.
    assert("recovery-notice-is-actually-visible",
      recoveryDom.visible === true,
      "the notice is in the DOM but not rendered: querySelector cannot tell the difference");
    // THE OWN-MODE ARM of the same mode ternary. The demo arm is pinned elsewhere; break
    // only this one and the suite passed clean, telling an own-mode person with an empty
    // home that they are looking at "the demo home". This fixture already renders it —
    // `seededThisBoot=true`, `mode==="own"`, 0 rooms — the probe just never read the text.
    assert("own-mode-seeded-boot-names-an-empty-home",
      /an empty home/i.test(recoveryDom.text) && !/the demo home/i.test(recoveryDom.text),
      `own-mode notice must describe an empty home: ${recoveryDom.text.slice(0, 200)}`);
    // THE HEADING — the one sentence every recovery render shows, unasserted until now.
    // "Everything is fine" in its place passed 345/345.
    // Read the <h3> ITSELF: the reason sentence in the body also contains "could not be
    // read", so a whole-banner textContent match cannot distinguish the two — a first
    // attempt at this lock passed while the heading said "Everything is fine".
    assert("recovery-notice-heading-states-the-problem",
      /could not be read/i.test(recoveryDom.heading) && !/everything is fine/i.test(recoveryDom.heading),
      `the heading must name the failure, got: ${recoveryDom.heading}`);
    // THE INTERPOLATED VALUES, not the prose around them. Every sentence is now pinned,
    // but the `<code>` keys inside them were not — and they are the only instruction the
    // person has for finding their data, since the notice says it can be "repaired later
    // or by hand". Hardcoding a wrong key passed clean. They are genuinely variable
    // (`nestory-v2` vs `nestory-v2-own`, slot 1 vs slot 2), so a fixed string is wrong in
    // most states. This fixture is own mode, which also distinguishes it from demo.
    // `role="status"` is what makes the notice reach a screen-reader user at all. Changing
    // it to "presentation" passes every text assertion while silently un-announcing the
    // banner — the person who most depends on being told is the one who stops being told.
    // The "cannot repair it for you yet" paragraph. Its whole purpose is to AVOID promising
    // a route the product does not have — its own source comment says so — and replacing it
    // with "You can restore this file at any time from Import" passed the suite clean. That
    // is the exact false promise the paragraph exists to prevent, and Import provably
    // refuses these bytes because Import is what quarantined them.
    assert("recovery-notice-does-not-promise-in-app-restore",
      /not restorable from inside the app today/i.test(recoveryDom.text)
        && !/restore this file at any time/i.test(recoveryDom.text),
      `the notice must not promise a route that does not exist: ${recoveryDom.text.slice(0, 200)}`);
    assert("recovery-notice-is-announced-to-assistive-tech",
      recoveryDom.role === "status",
      `the notice must keep role=status, got: ${recoveryDom.role}`);
    // Compared against the STORE's value, not a typed-out literal. Grepping for
    // "nestory-v2-own" passes a hardcoded string too, because this fixture is own mode —
    // so the lock caught a WRONG key but not a right-for-this-fixture one, which is wrong
    // for every demo-mode user. Its sibling `...-preserved-slot` was already immune
    // because it compares against `recoveryDom.preservedAt`; this now matches.
    // Anchored in POSITION, not by substring. `text.includes(originalKey)` is satisfied by
    // a neighbouring value: "nestory-v2-own-unreadable" contains "nestory-v2-own", so a key
    // hardcoded to the demo value still passed the own-mode half. The key must appear where
    // the sentence actually names it.
    assert("recovery-notice-names-the-real-storage-key",
      recoveryDom.originalKey.length > 0
        && recoveryDom.text.includes(`kept under ${recoveryDom.originalKey} and`)
        && !/WRONG/i.test(recoveryDom.text),
      `the notice must name the key the data is actually under (${recoveryDom.originalKey}): ${recoveryDom.text.slice(0, 200)}`);
    // Written first as `preservedAt === null || text.includes(...)`, this asserted NOTHING
    // whenever the fixture drifted to a both-slots-full state — a reachable state tested
    // elsewhere — and went green while measuring nothing. Every other lock in this family
    // has an honesty guard; this one needed the same.
    assert("preserved-slot-probe-actually-has-a-slot-to-name",
      recoveryDom.preservedAt !== null,
      "the fixture must produce a preserved copy or the lock below proves nothing");
    assert("recovery-notice-names-the-real-preserved-slot",
      recoveryDom.preservedAt !== null && recoveryDom.text.includes(recoveryDom.preservedAt),
      `the notice must name the slot the copy is actually in: preservedAt=${recoveryDom.preservedAt}`);
    // And the reason: the validator's own explanation, not a benign substitute. Same class
    // as the heading — replacing it with "Nothing to report." passed clean.
    // The byte count too. Lower stakes than the key — it sits beside a correct one — but
    // it is how a person confirms they found the right thing, and a fixed 999999 passed
    // clean. Cheap to pin against the real stored length.
    assert("recovery-notice-reports-the-real-byte-count",
      recoveryDom.originalBytes !== null
        && recoveryDom.text.includes(`(${recoveryDom.originalBytes} bytes)`),
      `the notice must report the real size, expected ${recoveryDom.originalBytes}: ${recoveryDom.text.slice(0, 200)}`);
    // ESCAPING. The validator echoes stored bytes verbatim into `reason`, and stored bytes
    // are untrusted by this store's own header comment — so the notice is an injection
    // sink, and `esc()` is the only thing standing in front of it. Dropping it passed the
    // whole suite. Asserted on innerHTML, not textContent: textContent shows the same
    // string either way, which is exactly why the gap survived so long.
    // THE LENGTH BOUND. The reason is attacker- or corruption-controlled in length: a
    // 4000-char stored value yields a 4044-char validator message. Unbounded, it pushes
    // the sentences this slice exists to deliver — where the data is kept, and that
    // changes are not being saved — off the screen. A denial of disclosure, not a
    // cosmetic issue, and removing the bound passed the whole suite.
    //
    // The slice-then-escape ORDER also matters and is asserted by consequence: escaping
    // first would let the cut land mid-entity ("…&l…"). The escaped text must stay
    // well-formed, so no bare "&" fragment may survive at the boundary.
    const longReasonState = await evalPage<{ reasonLength: number; rendered: number; ellipsis: boolean; wellFormed: boolean }>(`(() => {
      // 190 "A"s then "<b>" is not arbitrary: it places the "<" so that escaping FIRST
      // and slicing second lands the 240-char cut inside "&lt;", leaving a dangling "&l"
      // on screen. A payload with no entities (plain repeated characters) can never
      // distinguish the two orders, so the mid-entity lock would be inert against the
      // refactor it exists to stop. Padded to a hostile length as well.
      const big = "A".repeat(190) + "<b>" + "y".repeat(3800);
      localStorage.setItem("nestory-v2-own", JSON.stringify({ version: 2, records: [
        { recordType: big, id: "x" },
      ] }));
      localStorage.removeItem("nestory-v2-own-unreadable");
      localStorage.removeItem("nestory-v2-own-unreadable-2");
      return { reasonLength: 0, rendered: 0, ellipsis: false, wellFormed: false };
    })()`);
    void longReasonState;
    await evalPage(`location.reload()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const bounded = await evalPage<{ rawLength: number; rawReason: string; renderedLength: number; hasEllipsis: boolean; noticeStillComplete: boolean; renderedIsPrefixOfReason: boolean; htmlTail: string; textTail: string }>(`(() => {
      const rec = window.nestory.store.storageRecovery();
      const b = document.querySelector('[data-testid="storage-recovery-banner"]');
      const ps = b ? [...b.querySelectorAll("p")] : [];
      const reasonP = ps.length ? ps[0].textContent : "";
      const reasonHtml = ps.length ? ps[0].innerHTML : "";
      const whole = b ? b.textContent : "";
      return {
        rawLength: rec ? rec.reason.length : 0,
        rawReason: rec ? rec.reason : "",
        renderedLength: reasonP.length,
        hasEllipsis: /…/.test(reasonP),
        // The sentences that matter must still be present after the long reason.
        noticeStillComplete: /Nothing was deleted/.test(whole) && /not your own record/.test(whole),
        // Two things had to be right here, and the first version got neither.
        //
        // ANCHOR: the ellipsis is appended AFTER the cut, so an end-of-string anchor
        // alone never sees the dangling fragment — the original pattern read clean while
        // showing the person a broken entity. The optional trailing ellipsis fixes that.
        //
        // SOURCE: this must read innerHTML, not textContent. textContent DECODES, so a
        // well-formed "&amp;" and a truncated "&a" can look identical after decoding —
        // on an "&"-heavy reason the decoded text flags the CORRECT implementation as
        // broken, a false alarm on working code. Only the raw markup distinguishes a
        // complete entity from a cut one.
        // The property that actually distinguishes the two orders is not a regex over the
        // tail — no single pattern survived all payloads; an "&"-heavy reason flags the
        // CORRECT code and a "<"-heavy one hides the mutant. It is that the visible text
        // must be a genuine PREFIX of the validator's real reason. Slice-then-escape
        // guarantees that. Escape-then-slice cuts inside an entity, so the decoded text
        // contains a fragment ("&l") that never appeared in the source and the prefix
        // relation breaks. Compared against the store's own reason, not a hand-copy.
        renderedIsPrefixOfReason: rec ? rec.reason.startsWith(reasonP.replace(/\u2026$/, "")) : false,
        htmlTail: reasonHtml.slice(-24),
        textTail: reasonP.slice(-24),
      };
    })()`);
    assert("long-reason-probe-really-produced-a-long-reason", bounded.rawLength > 1000, bounded.rawLength);
    // The payload must contain an escapable character, or the prefix lock below cannot
    // distinguish escape-then-slice from slice-then-escape at all — with a plain payload
    // both orders produce identical output and the lock goes silently inert. The comment
    // on the fixture says so; a comment is not executable, and every other thing in this
    // slice that was guarded by reasoning rather than assertion eventually drifted.
    // Testing merely that the reason CONTAINS an escapable character is not enough — the
    // validator's own quote marks around the value satisfy that even for a plain payload.
    // What makes the two orders diverge is an escapable character near the 240-char cut,
    // where escaping first shifts the boundary into an entity.
    assert("long-reason-payload-can-distinguish-escape-order",
      /[&<>"']/.test(bounded.rawReason.slice(150, 260)),
      "the fixture needs an escapable character near the cut, or the order lock is inert");
    assert("recovery-notice-bounds-a-hostile-reason-length",
      bounded.renderedLength < 400 && bounded.hasEllipsis === true,
      `a ${bounded.rawLength}-char reason rendered ${bounded.renderedLength} chars, ellipsis=${bounded.hasEllipsis}`);
    assert("bounded-reason-does-not-suppress-the-rest-of-the-notice",
      bounded.noticeStillComplete === true,
      "the sentences this notice exists to deliver must survive a hostile reason");
    assert("bounded-reason-is-not-cut-mid-entity",
      bounded.renderedIsPrefixOfReason === true,
      `the shown text must be a real prefix of the reason; escape-then-slice breaks it. text=${JSON.stringify(bounded.textTail)}`);

    assert("recovery-notice-escapes-the-validators-reason",
      recoveryDom.reasonEscaped === true && recoveryDom.liveElementInBanner === false,
      `reason must render escaped with no live element: escaped=${recoveryDom.reasonEscaped} live=${recoveryDom.liveElementInBanner}`);
    // The fixture now feeds a shape-valid dump with a bad recordType, so the validator's
    // message is the "unsupported value" one rather than a JSON-parse failure.
    assert("recovery-notice-carries-the-validators-reason",
      /unsupported value/i.test(recoveryDom.text) && !/nothing to report/i.test(recoveryDom.text),
      `the notice must carry the real reason: ${recoveryDom.text.slice(0, 200)}`);
    // THE BLOCKED SENTENCE MUST GIVE THE TRUE REASON. There are two ways a write gets
    // refused and they are not interchangeable. When no copy could be made, writing
    // really would overwrite the only copy. When a copy DOES exist, nothing is at risk
    // and storage simply rejected the write — saying "the only copy" there is both a
    // false cause and a self-contradiction, since the sentence above has just named the
    // second copy. Review found exactly that; these read the rendered text, not the flag.
    await evalPage(`(() => {
      localStorage.clear();
      localStorage.setItem("nestory-v2-mode", "demo");
      localStorage.setItem("nestory-v2", "{ not json at all");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const quotaCopyState = await evalPage<{ preservedAt: string | null; clicked: boolean; blocked: boolean; text: string; originalKey: string }>(`(() => {
      const st = window.nestory.store;
      const preservedAt = st.storageRecovery() ? st.storageRecovery().preservedAt : null;
      // Make every further write fail, then perform a real one through the app.
      const realSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new Error("quota exceeded"); };
      let clicked = false;
      try {
        window.nestory.setView("home");
        const btn = document.querySelector('[data-action="confirm-container"]');
        if (btn) { btn.click(); clicked = true; }
      } finally { Storage.prototype.setItem = realSet; }
      const b = document.querySelector('[data-testid="storage-recovery-banner"]');
      return { preservedAt, clicked,
               originalKey: st.storageRecovery() ? st.storageRecovery().originalKey : "",
               blocked: st.storageRecovery() ? st.storageRecovery().savingBlocked : false,
               text: b ? b.textContent.replace(/\\s+/g, " ").trim() : "" };
    })()`);
    assert("quota-copy-probe-reached-a-blocked-state-with-a-copy",
      quotaCopyState.preservedAt !== null && quotaCopyState.clicked === true && quotaCopyState.blocked === true,
      `probe must produce blocked-with-a-copy: ${JSON.stringify(quotaCopyState).slice(0, 160)}`);
    assert("blocked-notice-does-not-claim-only-copy-when-a-copy-exists",
      !/only copy of your original data/.test(quotaCopyState.text),
      "the notice gave a false cause: a second copy exists, so nothing would be overwritten");
    // The SECOND mode. A key lock that only ever runs against one mode cannot tell a
    // computed value from a literal that happens to match that mode — comparing against
    // the store is not enough on its own. This probe is demo mode, so a hardcoded
    // "nestory-v2-own" is visibly wrong here, and the pair pins the value as genuinely
    // derived rather than coincidentally right.
    assert("demo-mode-notice-names-the-demo-storage-key",
      quotaCopyState.originalKey === "nestory-v2"
        && quotaCopyState.text.includes("nestory-v2")
        && !/nestory-v2-own/.test(quotaCopyState.text),
      `demo mode must name nestory-v2, not an own-mode key: ${quotaCopyState.text.slice(0, 200)}`);
    assert("blocked-notice-still-says-changes-are-not-being-saved",
      /not being saved/.test(quotaCopyState.text),
      `text was: ${quotaCopyState.text.slice(0, 400)}`);
    // ...and the mirror of the pair above: when a copy DOES exist, say so, and never
    // claim none could be made.
    assert("copy-exists-notice-names-the-second-copy",
      /second copy under/i.test(quotaCopyState.text),
      "the person must be told where the second copy is kept");
    assert("copy-exists-notice-does-not-claim-no-copy-was-made",
      !/no second copy could be made/i.test(quotaCopyState.text),
      "denying a copy that exists sends the person looking for data they already have");

    // THE OTHER BRANCH, and the more dangerous one. When `preservedAt` is null the live
    // key really does hold the only copy, so the notice must say exactly that. Review
    // broke this sentence alone — swapping in "nothing already saved is at risk" — and
    // the suite passed clean, which meant the branch that matters most was unlocked. It
    // is reachable on ordinary non-throwing storage with both slots full: 39 states.
    await evalPage(`(() => {
      localStorage.clear();
      localStorage.setItem("nestory-v2-mode", "demo");
      localStorage.setItem("nestory-v2-unreadable", "{ older original A");
      localStorage.setItem("nestory-v2-unreadable-2", "{ older original B");
      localStorage.setItem("nestory-v2", "{ this boot's corruption");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const noCopyState = await evalPage<{ preservedAt: string | null; clicked: boolean; blocked: boolean; text: string }>(`(() => {
      const st = window.nestory.store;
      window.nestory.setView("home");
      const btn = document.querySelector('[data-action="confirm-container"]');
      let clicked = false;
      if (btn) { btn.click(); clicked = true; }
      const b = document.querySelector('[data-testid="storage-recovery-banner"]');
      const rec = st.storageRecovery();
      return { preservedAt: rec ? rec.preservedAt : null, clicked,
               blocked: rec ? rec.savingBlocked : false,
               text: b ? b.textContent.replace(/\\s+/g, " ").trim() : "" };
    })()`);
    assert("no-copy-probe-reached-a-blocked-state-without-a-copy",
      noCopyState.preservedAt === null && noCopyState.clicked === true && noCopyState.blocked === true,
      `probe must produce blocked-with-NO-copy: ${JSON.stringify(noCopyState).slice(0, 160)}`);
    assert("no-copy-notice-says-the-live-key-is-the-only-copy",
      /only copy of your original data/.test(noCopyState.text),
      "the person holding their only copy must be told exactly that");
    assert("no-copy-notice-does-not-claim-nothing-is-at-risk",
      !/nothing already saved is at risk/i.test(noCopyState.text),
      "the reassurance from the copy-exists branch must never leak into the no-copy branch");
    // The SAME two-branch shape one paragraph up ("Nothing was deleted… ") was unlocked:
    // a mutant claiming "a second copy was safely made" passed clean, telling someone
    // holding their only copy that they have two. Same class of false reassurance, so it
    // gets the same pairing — a positive assertion and a negative one, because a `!/re/`
    // test alone passes trivially on empty text.
    assert("no-copy-notice-says-no-second-copy-could-be-made",
      /no second copy could be made/i.test(noCopyState.text),
      "the person must be told plainly that no second copy exists");
    assert("no-copy-notice-does-not-claim-a-second-copy-exists",
      !/second copy under/i.test(noCopyState.text) && !/two independent copies/i.test(noCopyState.text),
      "claiming a second copy that does not exist is the same lie, one paragraph up");
    // THE LAST CONDITIONAL. `seededThisBoot` was asserted at the flag but its rendered
    // text never read — the third instance of the same gap shape. This boot fell back to
    // the seed, so the person is looking at demo furniture; saying "your current records
    // loaded normally" here would be the fabricated home this whole path exists to
    // prevent, and it passed clean until now.
    assert("seeded-boot-says-what-you-see-is-not-your-own-record",
      /not your own record/i.test(noCopyState.text),
      "a seeded session must say so, or the person mistakes the demo home for theirs");
    assert("seeded-boot-does-not-claim-records-loaded-normally",
      !/loaded normally/i.test(noCopyState.text),
      "the earlier-copy wording must never appear on a boot that actually fell back to the seed");
    // ...and the mode sub-branch inside that same sentence. This fixture is demo mode, so
    // it must name the demo home; saying "an empty home" here describes own mode and would
    // misdescribe what is on screen.
    assert("seeded-boot-in-demo-mode-names-the-demo-home",
      /the demo home/i.test(noCopyState.text) && !/an empty home/i.test(noCopyState.text),
      "the seeded-session sentence must describe the mode the person is actually in");

    // THE MIRROR BRANCH: the person's OWN records loaded fine and the notice concerns an
    // unreadable copy kept aside by an EARLIER boot. Saying "what you see here is not your
    // own record" would be false in the opposite direction — it invites someone looking at
    // their real home to discard it. Needs its own page state: a valid ledger plus a
    // leftover quarantine copy.
    await evalPage(`(() => {
      const dump = JSON.stringify({ version: 2, records: window.nestory.store.exportJson().records });
      localStorage.clear();
      localStorage.setItem("nestory-v2-mode", "demo");
      localStorage.setItem("nestory-v2", dump);
      localStorage.setItem("nestory-v2-unreadable", "{ an older unreadable original");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const earlierCopyState = await evalPage<{ seeded: boolean | null; recovered: boolean; text: string }>(`(() => {
      const rec = window.nestory.store.storageRecovery();
      const b = document.querySelector('[data-testid="storage-recovery-banner"]');
      return { seeded: rec ? rec.seededThisBoot : null, recovered: rec !== null,
               text: b ? b.textContent.replace(/\\s+/g, " ").trim() : "" };
    })()`);
    assert("earlier-copy-probe-reached-a-non-seeded-recovery",
      earlierCopyState.recovered === true && earlierCopyState.seeded === false,
      `probe must load real records WITH a leftover copy: ${JSON.stringify(earlierCopyState).slice(0, 160)}`);
    assert("non-seeded-boot-says-current-records-loaded-normally",
      /loaded normally/i.test(earlierCopyState.text),
      "the person's own records did load; the notice must say so");
    assert("non-seeded-boot-does-not-claim-this-is-not-your-record",
      !/not your own record/i.test(earlierCopyState.text),
      "telling someone looking at their real home that it is not theirs invites them to discard it");

    // A HEALTHY boot must render NO banner at all. Making it render unconditionally passed
    // clean — every text lock still matched, because they only ever ran when it was there.
    await evalPage(`(() => {
      localStorage.clear();
      localStorage.setItem("nestory-v2-mode", "demo");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const healthyDom = await evalPage<{ recovery: unknown; bannerPresent: boolean; records: number }>(`({
      recovery: window.nestory.store.storageRecovery(),
      bannerPresent: Boolean(document.querySelector('[data-testid="storage-recovery-banner"]')),
      records: window.nestory.store.exportJson().records.length,
    })`);
    assert("healthy-boot-probe-really-is-healthy",
      healthyDom.recovery === null && healthyDom.records > 10,
      `fixture must be a healthy boot: ${JSON.stringify(healthyDom).slice(0, 140)}`);
    assert("healthy-boot-renders-no-recovery-notice", healthyDom.bannerPresent === false,
      "a healthy session must not be shown a recovery notice it has no reason to see");

    // The WELCOME chooser is reachable with an unreadable ledger in storage (records key
    // survives, mode key does not). The ten-view sweep above cannot catch it because it
    // never exercises `mode === null` — review found this one, not the locks.
    await evalPage(`(() => {
      localStorage.setItem("nestory-v2", "{ not json at all");
      localStorage.removeItem("nestory-v2-unreadable");
      localStorage.removeItem("nestory-v2-mode");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const welcomeState = await evalPage<{ mode: string | null; recovered: boolean; shown: boolean }>(`({
      mode: window.nestory.mode,
      recovered: window.nestory.store.storageRecovery() !== null,
      shown: Boolean(document.querySelector('[data-testid="storage-recovery-banner"]')),
    })`);
    assert("welcome-screen-probe-actually-reaches-mode-null",
      welcomeState.mode === null && welcomeState.recovered === true,
      `probe did not reach the welcome screen with a recovery: ${JSON.stringify(welcomeState)}`);
    assert("recovery-notice-shown-on-the-welcome-chooser", welcomeState.shown === true,
      "the person is invited to pick a fresh home with no word that their record is unread");
    await evalPage(`(() => {
      localStorage.removeItem("nestory-v2");
      localStorage.removeItem("nestory-v2-unreadable");
      localStorage.setItem("nestory-v2-mode", "own");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();

    // Leave own mode as the later assertions expect it: a clean, readable empty store.
    await evalPage(`(() => { localStorage.removeItem("nestory-v2-own"); localStorage.removeItem("nestory-v2-own-unreadable"); location.reload(); })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    assert("recovery-probe-left-a-clean-own-store",
      await evalPage<boolean>(`window.nestory.store.storageRecovery() === null && window.nestory.mode === "own"`),
      "the probe must not leave a recovered store behind for later assertions");

    // ------------------------------------------------ P5 in the DOM: a refused write must
    // be DISCLOSED, not merely recorded. The store-level locks above prove the state is
    // computed; they say nothing about whether the person is told. Five mutants survived
    // the whole suite on state locks alone — the notice removed from the shell, the toast
    // ignoring the failure, the heading replaced with the corruption heading, the
    // "nothing earlier was lost" sentence replaced, and the count forced to singular.
    // These run in the real browser against the real render path.
    //
    // Quota is filled for real, in the page, at progressively finer grains: a key
    // REPLACEMENT only needs room for the size delta, so leaving even 500 bytes free lets
    // the app's own write succeed and the probe would measure nothing.
    const wfDom = await evalPage<{
      quotaRefusesTinyWrite: boolean; failureRecorded: boolean; bannerPresent: boolean;
      bannerText: string; toastWarned: boolean; toastDriverFound: boolean; storageUnchanged: boolean; hasStoredData: boolean;
      role: string | null; sinceExpected: string | null;
      recoveryBannerAbsent: boolean; itemInMemory: boolean; itemInStorage: boolean;
    }>(`(() => {
      const s = window.nestory.store;
      // A healthy, readable store first, and one write that LANDS.
      s.createRoom({ name: "P5 Dom Base" });
      const lastGood = localStorage.getItem("nestory-v2-own") || "";
      const grains = [1024*512, 1024*16, 1024, 64, 8];
      for (let g = 0; g < grains.length; g++) {
        try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-dom-" + g + "-" + n, "x".repeat(grains[g])); } catch (e) {}
      }
      let tiny = false;
      try { localStorage.setItem("quota-fill-dom-tiny", "12345678"); } catch (e) { tiny = true; }
      try { localStorage.removeItem("quota-fill-dom-tiny"); } catch (e) {}
      // Now a change that cannot be saved, made through the store the app renders from.
      // The store notifies its subscriber, so THIS is the render that first discloses the
      // failure - capture the live-region role here, before any further render. Reading it
      // after another setView() would only ever see the downgraded value.
      window.nestory.setView("home");
      s.createRoom({ name: "P5 Dom Refused" });
      const bFirst = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const roleAtFirstDisclosure = bFirst ? bFirst.getAttribute("role") : null;
      const b = bFirst;
      const raw = localStorage.getItem("nestory-v2-own") || "";
      const out = {
        quotaRefusesTinyWrite: tiny,
        failureRecorded: s.storageWriteFailure() !== null,
        bannerPresent: Boolean(b && b.offsetParent !== null),
        bannerText: b ? b.textContent.replace(/\\s+/g, " ").trim() : "",
        role: roleAtFirstDisclosure,
        sinceExpected: (() => {
          const wf = s.storageWriteFailure();
          if (!wf) return null;
          const t = new Date(wf.since);
          return Number.isNaN(t.getTime()) ? null : t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        })(),
        toastWarned: false,
        toastDriverFound: false,
        hasStoredData: s.storageWriteFailure() ? s.storageWriteFailure().hasStoredData : false,
        storageUnchanged: raw === lastGood,
        recoveryBannerAbsent: !document.querySelector('[data-testid="storage-recovery-banner"]'),
        itemInMemory: [...s.state.rooms.values()].some((r) => r.name === "P5 Dom Refused"),
        itemInStorage: raw.indexOf("P5 Dom Refused") !== -1,
      };
      // A pure re-render with NOTHING changed must NOT re-announce - but only AFTER a frame
      // has been painted. Within the same task the region deliberately stays assertive, so
      // that a handler which renders twice (act() then close-the-modal) does not destroy the
      // announcement before an AT can see it. Measured in the settled probe below.
      // The toast is produced by act(), which only the apps own handlers call. Drive one.
      // add-belonging is NOT usable here: verifys own-mode store has no container, so the
      // handler bails at its "Add a container first." guard before act() is reached, and
      // the probe would assert on a toast the app never had cause to produce. Confirming a
      // container is a real write with no such precondition, so drive that instead.
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const roomId2 = s.createRoom({ name: "P5 Toast Room" });
      const contId = s.createContainer({ name: "P5 Toast Shelf", kind: "shelf", roomId: roomId2 });
      window.nestory.setView("spaces");
      window.nestory.openContainer(contId);
      const confirmBtn = document.querySelector('[data-action="confirm-container"]');
      out.toastDriverFound = Boolean(confirmBtn);
      if (confirmBtn) confirmBtn.click();
      // The toast is deferred to a microtask so its wording can be decided from the settled
      // DOM; read it in the follow-up probe below, not here.
      return out;
    })()`);
    await sleep(300);
    const wfToast = await evalPage<{ toastWarned: boolean; toasts: string[] }>(`(() => ({
      toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim()),
      toastWarned: [...document.querySelectorAll(".toast")].some((t) => /NOT saved/i.test(t.textContent)),
    }))()`);
    // Now let a frame pass, then re-render with nothing changed: the region must downgrade.
    await sleep(250);
    const settledRole = await evalPage<{ afterFrame: string | null; afterPureRerender: string | null }>(`(() => {
      const before = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const afterFrame = before ? before.getAttribute("role") : null;
      window.nestory.setView("home");
      const b = document.querySelector('[data-testid="storage-write-failure-banner"]');
      return { afterFrame, afterPureRerender: b ? b.getAttribute("role") : null };
    })()`);

    // Honesty guard first: if the fill did not actually exhaust quota, everything below
    // would go green while measuring nothing.
    assert("dom-probe-really-reached-a-refused-write",
      wfDom.quotaRefusesTinyWrite === true && wfDom.failureRecorded === true
        && wfDom.itemInMemory === true && wfDom.itemInStorage === false && wfDom.storageUnchanged === true,
      `the probe must reach a genuine refusal or the DOM locks prove nothing: ${JSON.stringify(wfDom).slice(0, 300)}`);
    assert("write-failure-notice-is-rendered-in-the-shell", wfDom.bannerPresent === true,
      "a refused write is recorded but never shown: the person is told nothing");
    // Assertive on FIRST disclosure — that is news a screen-reader user must hear. But the
    // banner is rebuilt by innerHTML on every render, so an unchanged state must NOT keep
    // re-announcing: a reviewer showed it interrupting on every nav click and keystroke.
    assert("write-failure-notice-is-announced-as-an-alert-when-it-is-news",
      wfDom.role === "alert", wfDom.role);
    assert("write-failure-notice-does-not-re-announce-an-unchanged-state",
      settledRole.afterPureRerender === "status",
      `after a painted frame, a pure re-render must downgrade the live region, got ${settledRole.afterPureRerender}`);
    // And the announcement must SURVIVE the task it was made in. A handler that renders
    // twice (act(), then again after closing the modal) used to consume the "is this news"
    // mark on the first render, so the second rebuilt the banner as `status` and a genuinely
    // new refusal was announced to nobody on the path most writes take.
    //
    // This MUST be measured through a DOUBLE-RENDERING handler. The earlier version read the
    // role off a node whose last render was a single-render click — already news, already
    // `alert`, with no intervening render — so synchronous marking passed it identically: a
    // vacuous lock for the exact defect it named. `snapshot-submit` calls act() and then closes
    // its modal and re-renders, which is the shape that broke.
    const doubleRender = await evalPage<{ droveDoubleRender: boolean; countBefore: number | null; countAfter: number | null; roleAtEndOfTask: string | null }>(`(() => {
      const s = window.nestory.store;
      const c = s.containersView().find((x) => x.kind !== "box");
      if (!c) return { droveDoubleRender: false, countBefore: null, countAfter: null, roleAtEndOfTask: null };
      window.nestory.openContainer(c.id);
      const wfBefore = s.storageWriteFailure();
      const ta = document.getElementById("snapshot-text");
      if (ta) ta.value = "double render probe";
      const btn = document.querySelector('[data-action="snapshot-submit"]');
      if (!btn) return { droveDoubleRender: false, countBefore: wfBefore ? wfBefore.unsavedChanges : null, countAfter: null, roleAtEndOfTask: null };
      btn.click();   // act() renders, then the handler nulls ui.modal and renders AGAIN
      const b = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const wfAfter = s.storageWriteFailure();
      return {
        droveDoubleRender: true,
        countBefore: wfBefore ? wfBefore.unsavedChanges : null,
        countAfter: wfAfter ? wfAfter.unsavedChanges : null,
        roleAtEndOfTask: b ? b.getAttribute("role") : null,
      };
    })()`);
    assert("double-render-probe-really-advanced-the-count-through-a-two-render-handler",
      doubleRender.droveDoubleRender === true
        && doubleRender.countBefore !== null && doubleRender.countAfter !== null
        && (doubleRender.countAfter as number) > (doubleRender.countBefore as number),
      `the probe must make a NEW refusal via a handler that renders twice: ${JSON.stringify(doubleRender)}`);
    assert("a-new-refusal-stays-assertive-for-the-whole-task-it-was-disclosed-in",
      doubleRender.roleAtEndOfTask === "alert" && settledRole.afterFrame === "alert",
      `the live region must still be assertive after a double-rendering handler, got ${doubleRender.roleAtEndOfTask}`);
    assert("write-failure-notice-says-changes-are-not-being-saved",
      /not being saved/i.test(wfDom.bannerText), wfDom.bannerText.slice(0, 160));
    // The CAUSE must be named without implying the person did something. "saving is
    // restricted in this window" is accurate but can be heard as an accusation - a reviewer
    // flagged it - so private browsing is named plainly instead. Both halves locked: the
    // browser is the subject, and the accusatory phrasing is gone.
    assert("write-failure-notice-names-the-cause-without-blaming-the-person",
      /Your browser refused to store them/i.test(wfDom.bannerText)
        && /storage for this site is full/i.test(wfDom.bannerText)
        && !/restricted in this window/i.test(wfDom.bannerText)
        // Private browsing is NOT named: if setItem throws outright, chooseMode swallows it and
        // reloads, so those people loop on the welcome screen and never see this banner. Naming
        // a cause only the unreachable half of the audience has is a false explanation.
        && !/private browsing/i.test(wfDom.bannerText),
      wfDom.bannerText.slice(0, 300));
    // `since` must be SHOWN, not merely computed. It was locked three times at store level
    // while rendering nowhere — the computed-but-invisible failure this slice exists to cure,
    // reproduced inside the slice itself. Asserted as a real clock time drawn from the state.
    // Bound to the STATE's own value, not to a clock-shaped pattern: a hardcoded "09:99"
    // satisfied the shape and passed the whole suite, which is the vacuous-lock failure this
    // project keeps hitting. The expected string is derived in-page from `since` itself.
    assert("write-failure-notice-shows-when-saving-stopped-working",
      wfDom.sinceExpected !== null && (wfDom.sinceExpected as string).length > 0
        && wfDom.bannerText.includes(`Saving stopped working at ${wfDom.sinceExpected}`)
        && /anything you changed after that is affected/i.test(wfDom.bannerText),
      `expected the notice to name ${wfDom.sinceExpected}: ${wfDom.bannerText.slice(0, 300)}`);
    // The sentence that separates this from data loss. Replacing it passed the suite.
    // Only correct because the probe above made a write that LANDED first, so there really
    // is a last successful save to point at; asserted rather than assumed, because the
    // other branch of this copy must not be tested by accident.
    assert("dom-probe-has-an-earlier-successful-save-to-speak-of",
      wfDom.hasStoredData === true,
      "without a prior successful save the notice takes its other branch and this lock would test the wrong sentence");
    assert("write-failure-notice-says-earlier-saved-data-is-intact",
      /Nothing you saved earlier was lost or overwritten/i.test(wfDom.bannerText),
      wfDom.bannerText.slice(0, 240));
    assert("write-failure-notice-says-the-changes-go-on-reload",
      /gone if you reload/i.test(wfDom.bannerText), wfDom.bannerText.slice(0, 240));
    // A remedy that actually works without storage. Export needs no write.
    assert("write-failure-notice-offers-a-remedy-that-needs-no-storage",
      /Export JSON/i.test(wfDom.bannerText), wfDom.bannerText.slice(0, 240));
    // And it must not PROMISE that the next write will succeed. `savingIsPossible()` already
    // documents that a read-only probe cannot predict a throwing setItem, so "will save
    // again" states as certain what the code concedes is unknowable — and the notice cannot
    // re-check on its own, since persist() only runs on a mutation. Both halves asserted:
    // conditional wording, and an honest admission that the notice stays up until then.
    assert("write-failure-notice-does-not-promise-the-next-write-will-succeed",
      !/will save again/i.test(wfDom.bannerText)
        && /should save again/i.test(wfDom.bannerText)
        && /cannot check on its own/i.test(wfDom.bannerText),
      wfDom.bannerText.slice(0, 300));
    // It must NOT borrow the other notice's heading: the saved data is readable here, and
    // saying otherwise states a false cause — the exact defect P4 had to repair.
    assert("write-failure-notice-does-not-claim-the-saved-data-is-unreadable",
      !/could not be read/i.test(wfDom.bannerText) && wfDom.recoveryBannerAbsent === true,
      wfDom.bannerText.slice(0, 240));
    // The count is in the copy, and one refusal reads singular.
    assert("write-failure-notice-counts-one-refusal-in-the-singular",
      /The last change you made was not saved/i.test(wfDom.bannerText), wfDom.bannerText.slice(0, 160));
    // And the immediate feedback at the moment of the action, not only the standing notice.
    // Guarded: if the driving control was not found, the assertion below would pass or fail
    // for the wrong reason, so the control's presence is asserted first.
    assert("toast-probe-found-a-real-control-to-drive", wfDom.toastDriverFound === true,
      "no confirm-container control was reachable, so the toast lock would prove nothing");
    assert("a-refused-action-is-not-toasted-as-plain-success", wfToast.toastWarned === true,
      `the toast confirmed the change while nothing was saved: ${JSON.stringify(wfToast.toasts)}`);

    // Two refusals must read in the plural with the real number.
    const wfPlural = await evalPage<{ count: number; text: string }>(`(() => {
      window.nestory.store.createRoom({ name: "P5 Dom Refused 2" });
      window.nestory.setView("home");
      const b = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const wf = window.nestory.store.storageWriteFailure();
      return { count: wf ? wf.unsavedChanges : 0, text: b ? b.textContent.replace(/\\s+/g, " ").trim() : "" };
    })()`);
    assert("write-failure-notice-reports-the-real-number-of-unsaved-changes",
      wfPlural.count >= 2 && new RegExp(`The last ${wfPlural.count} changes you made were not saved`, "i").test(wfPlural.text),
      `count=${wfPlural.count}: ${wfPlural.text.slice(0, 200)}`);

    // Freeing space and writing again must clear BOTH the state and the notice.
    const wfCleared = await evalPage<{ failure: boolean; banner: boolean; backlogSaved: boolean }>(`(() => {
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill-dom-") === 0).forEach((k) => localStorage.removeItem(k));
      window.nestory.store.createRoom({ name: "P5 Dom Retry" });
      window.nestory.setView("home");
      const raw = localStorage.getItem("nestory-v2-own") || "";
      return {
        failure: window.nestory.store.storageWriteFailure() !== null,
        banner: Boolean(document.querySelector('[data-testid="storage-write-failure-banner"]')),
        backlogSaved: raw.indexOf("P5 Dom Refused") !== -1 && raw.indexOf("P5 Dom Retry") !== -1,
      };
    })()`);
    assert("write-failure-notice-clears-when-saving-works-again",
      wfCleared.failure === false && wfCleared.banner === false && wfCleared.backlogSaved === true,
      JSON.stringify(wfCleared));
    // A healthy store must show no such notice at all: a false alarm is its own defect.
    const wfHealthy = await evalPage<{ banner: boolean; failure: boolean }>(`(() => ({
      banner: Boolean(document.querySelector('[data-testid="storage-write-failure-banner"]')),
      failure: window.nestory.store.storageWriteFailure() !== null,
    }))()`);
    assert("healthy-store-shows-no-write-failure-notice",
      wfHealthy.banner === false && wfHealthy.failure === false, JSON.stringify(wfHealthy));
    // And no TOAST either. The lock above checks the banner and the store flag but never the
    // toast, so a mutant that toasts "not saved" unconditionally passed it. A false alarm is
    // its own defect: it teaches people to distrust a warning that is usually wrong.
    const healthyToast = await evalPage<{ droveWrite: boolean; toasts: string[]; falseAlarm: boolean; landed: boolean }>(`(() => {
      const s = window.nestory.store;
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const before = (localStorage.getItem("nestory-v2-own") || "").length;
      window.nestory.setView("setup");
      const btn = document.querySelector('[data-action="setup-add-room"]');
      if (!btn) return { droveWrite: false, toasts: [], falseAlarm: false, landed: false };
      btn.click();
      const after = (localStorage.getItem("nestory-v2-own") || "").length;
      const toasts = [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim());
      return {
        droveWrite: true,
        toasts,
        falseAlarm: toasts.some((t) => /not saved|That change/i.test(t)),
        landed: after !== before && s.storageWriteFailure() === null,
      };
    })()`);
    await sleep(300);
    const healthyToastSettled = await evalPage<{ toasts: string[]; falseAlarm: boolean }>(`(() => {
      const toasts = [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim());
      return { toasts, falseAlarm: toasts.some((t) => /not saved|That change/i.test(t)) };
    })()`);
    assert("healthy-toast-probe-really-landed-a-write",
      healthyToast.droveWrite === true && healthyToast.landed === true,
      `the probe must land a real write on a healthy store: ${JSON.stringify(healthyToast).slice(0, 240)}`);
    assert("a-healthy-store-never-toasts-a-false-not-saved-alarm",
      healthyToast.falseAlarm === false && healthyToastSettled.falseAlarm === false,
      `a write that landed must not be reported as unsaved: ${JSON.stringify(healthyToastSettled.toasts)}`);

    // THE OTHER COPY BRANCH, in the DOM. A store that never managed a save must not be
    // told "what is already stored is exactly as it was at the last successful save" —
    // there is no such save. Locking only the store flag left this vacuous: a mutant that
    // made the notice ignore the flag passed the whole suite.
    await evalPage(`(() => {
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill-dom-") === 0).forEach((k) => localStorage.removeItem(k));
      localStorage.removeItem("nestory-v2-own");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const neverDom = await evalPage<{ hasStoredData: boolean | null; text: string; storedBytes: number; failure: boolean }>(`(() => {
      const grains = [1024*512, 1024*16, 1024, 64, 8];
      for (let g = 0; g < grains.length; g++) {
        try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-never-" + g + "-" + n, "x".repeat(grains[g])); } catch (e) {}
      }
      // The first write of this store's life, and it cannot land.
      window.nestory.store.createRoom({ name: "Never Saved Dom Room" });
      window.nestory.setView("home");
      const b = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const wf = window.nestory.store.storageWriteFailure();
      return {
        hasStoredData: wf ? wf.hasStoredData : null,
        failure: wf !== null,
        text: b ? b.textContent.replace(/\\s+/g, " ").trim() : "",
        storedBytes: (localStorage.getItem("nestory-v2-own") || "").length,
      };
    })()`);
    assert("never-saved-probe-really-has-nothing-stored",
      neverDom.failure === true && neverDom.hasStoredData === false && neverDom.storedBytes === 0,
      `the probe must reach a store with no save at all: ${JSON.stringify(neverDom).slice(0, 200)}`);
    assert("never-saved-notice-does-not-promise-a-last-successful-save",
      !/last successful save/i.test(neverDom.text) && !/Nothing you saved earlier/i.test(neverDom.text),
      neverDom.text.slice(0, 240));
    assert("never-saved-notice-says-nothing-has-been-saved-yet",
      /Nothing has been saved to this browser yet/i.test(neverDom.text)
        && /no earlier copy exists/i.test(neverDom.text),
      neverDom.text.slice(0, 240));

    // BOTH NOTICES, IN THE DOM. The store-level lock asserts both states can hold at once;
    // it says nothing about whether both are SHOWN. A reviewer added
    // `if (store.storageRecovery()) return "";` to the write-failure notice — suppressing it
    // whenever a recovery is also disclosed — and the whole suite passed, while the source
    // comment claimed "both can appear when both are true". Same DOM blindness that left
    // five earlier UI mutants alive.
    const bothDom = await evalPage<{
      recoveryVisible: boolean; failureVisible: boolean; failureText: string; recoveryText: string;
      hasStoredData: boolean | null; toastWarned: boolean; blockedOnly: boolean;
    }>(`(() => {
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k));
      // A corrupt live key with the FIRST quarantine slot FREE, so the writer can copy the
      // original aside and persist() reaches its try block; the refusal then comes from
      // quota rather than from the early return. With BOTH slots full the write never
      // reaches the quota path at all - that state is savingBlocked only, probed above.
      localStorage.setItem("nestory-v2-own", "{ this boot corruption");
      return { recoveryVisible: false, failureVisible: false, failureText: "", recoveryText: "", hasStoredData: null, toastWarned: false, blockedOnly: false };
    })()`);
    void bothDom;
    await evalPage(`location.reload()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    // FIRST, the savingBlocked-only state: `persist()` early-returns before its try block,
    // so `savingBlocked` is true while `writeFailure` stays null. The toast must still warn.
    // Dropping the savingBlocked leg of that check passed the suite for a reviewer.
    await evalPage(`(() => {
      // BOTH quarantine slots occupied by other originals, so the writer cannot secure the
      // corrupt original anywhere and persist() takes its early return: savingBlocked true,
      // writeFailure null. That is the leg being isolated here.
      localStorage.setItem("nestory-v2-own-unreadable", "{ older original A");
      localStorage.setItem("nestory-v2-own-unreadable-2", "{ older original B");
      localStorage.setItem("nestory-v2-own", "{ this boot corruption");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const blockedOnly = await evalPage<{ savingBlocked: boolean | null; writeFailure: boolean; controlFound: boolean }>(`(() => {
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const s = window.nestory.store;
      const roomId = s.createRoom({ name: "Blocked Only Room" });
      const contId = s.createContainer({ name: "Blocked Only Shelf", kind: "shelf", roomId });
      window.nestory.openContainer(contId);
      const btn = document.querySelector('[data-action="confirm-container"]');
      if (btn) btn.click();
      return {
        savingBlocked: s.storageRecovery() ? s.storageRecovery().savingBlocked : null,
        writeFailure: s.storageWriteFailure() !== null,
        controlFound: Boolean(btn),
      };
    })()`);
    await sleep(300);
    const blockedToast = await evalPage<{ toastWarned: boolean; toasts: string[] }>(`(() => ({
      toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim()),
      toastWarned: [...document.querySelectorAll(".toast")].some((t) => /NOT saved/i.test(t.textContent)),
    }))()`);
    assert("blocked-only-probe-reached-saving-blocked-without-a-write-failure",
      blockedOnly.savingBlocked === true && blockedOnly.writeFailure === false && blockedOnly.controlFound === true,
      `the probe must isolate the savingBlocked leg or the toast lock below proves nothing: ${JSON.stringify(blockedOnly)}`);
    assert("savingBlocked-alone-still-warns-in-the-toast", blockedToast.toastWarned === true,
      `a write refused to protect the only copy was confirmed as plain success: ${JSON.stringify(blockedToast.toasts)}`);

    // NOW add refused writes on top, so both states hold, and check both notices are shown.
    // The blocked-only fixture above left BOTH slots full, which is exactly the state where
    // persist() never reaches the quota path. Reset to one free slot before the compound case.
    await evalPage(`(() => {
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k));
      localStorage.removeItem("nestory-v2-own-unreadable");
      localStorage.removeItem("nestory-v2-own-unreadable-2");
      localStorage.setItem("nestory-v2-own", "{ this boot corruption");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const bothShown = await evalPage<{ recoveryVisible: boolean; failureVisible: boolean; failureText: string; hasStoredData: boolean | null }>(`(() => {
      const grains = [1024*512, 1024*16, 1024, 64, 8];
      for (let g = 0; g < grains.length; g++) {
        try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-both-" + g + "-" + n, "x".repeat(grains[g])); } catch (e) {}
      }
      window.nestory.store.createRoom({ name: "Both States Room" });
      window.nestory.setView("home");
      window.scrollTo(0, 0);
      const rec = document.querySelector('[data-testid="storage-recovery-banner"]');
      const fail = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const wf = window.nestory.store.storageWriteFailure();
      return {
        recoveryVisible: Boolean(rec && rec.offsetParent !== null),
        failureVisible: Boolean(fail && fail.offsetParent !== null),
        failureText: fail ? fail.textContent.replace(/\\s+/g, " ").trim() : "",
        hasStoredData: wf ? wf.hasStoredData : null,
      };
    })()`);
    assert("both-notices-are-shown-when-both-states-hold",
      bothShown.recoveryVisible === true && bothShown.failureVisible === true,
      JSON.stringify(bothShown).slice(0, 200));
    // And the write-failure copy must not contradict the recovery notice above it in EITHER
    // direction: the stored bytes exist (so "nothing has been saved yet" is false) but are
    // unreadable (so "exactly as it was at the last successful save" is false too).
    assert("compound-state-copy-claims-neither-a-good-save-nor-an-empty-store",
      bothShown.hasStoredData === false
        && !/last successful save/i.test(bothShown.failureText)
        && !/Nothing has been saved to this browser yet/i.test(bothShown.failureText)
        && /cannot read it/i.test(bothShown.failureText),
      bothShown.failureText.slice(0, 260));

    // THE TOAST'S DIRECTION MUST BE TRUE, IN BOTH DIRECTIONS. The notice sits behind a fixed
    // z-index-100 scrim while a modal is open, so "See the notice above" would point at
    // something unreadable; the toast itself is at z-index 200 and stays legible.
    //
    // But `ui.modal` at act() time is the WRONG test, and a single-direction lock hid that.
    // The form-submit handlers (`snapshot-submit`, `add-belonging-submit`) call act() with the
    // modal open and then close it and re-render immediately, so the toast told the person to
    // close something already gone while the notice was on screen and unoccluded. Only
    // `confirm-container` genuinely leaves the modal open - which is exactly why a lock that
    // drove only that control passed. Both arms are asserted here.
    const modalKeeps = await evalPage<{ drove: boolean; modalStillOpen: boolean }>(`(() => {
      const s = window.nestory.store;
      const roomId = s.createRoom({ name: "Modal Keep Room" });
      const contId = s.createContainer({ name: "Modal Keep Shelf", kind: "shelf", roomId });
      window.nestory.openContainer(contId);
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const btn = document.querySelector('.modal [data-action="confirm-container"]');
      if (btn) btn.click();
      return { drove: Boolean(btn), modalStillOpen: Boolean(document.querySelector(".modal-overlay")) };
    })()`);
    await sleep(300);
    const modalKeepsToast = await evalPage<{ toasts: string[]; saysClose: boolean; saysAbove: boolean; overlay: boolean }>(`(() => ({
      toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim()),
      saysClose: [...document.querySelectorAll(".toast")].some((t) => /Close this to see why/i.test(t.textContent)),
      saysAbove: [...document.querySelectorAll(".toast")].some((t) => /See the notice above/i.test(t.textContent)),
      overlay: Boolean(document.querySelector(".modal-overlay")),
    }))()`);
    assert("modal-keep-probe-really-left-the-modal-open",
      modalKeeps.drove === true && modalKeeps.modalStillOpen === true && modalKeepsToast.overlay === true,
      `the probe must act with a modal that STAYS open: ${JSON.stringify({ ...modalKeeps, ...modalKeepsToast }).slice(0, 240)}`);
    assert("toast-says-close-this-when-a-modal-really-is-covering-the-notice",
      modalKeepsToast.saysClose === true && modalKeepsToast.saysAbove === false,
      `with the modal still open the toast must not say "above": ${JSON.stringify(modalKeepsToast.toasts)}`);

    // THE OTHER ARM: a handler that CLOSES the modal must not say "Close this".
    const modalCloses = await evalPage<{ drove: boolean; modalOpenAtAct: boolean }>(`(() => {
      const s = window.nestory.store;
      const c = s.containersView().find((x) => x.kind !== "box");
      window.nestory.openContainer(c.id);
      const modalOpenAtAct = Boolean(window.nestory.ui.modal);
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const ta = document.getElementById("snapshot-text");
      if (ta) ta.value = "settled probe text";
      const btn = document.querySelector('[data-action="snapshot-submit"]');
      if (btn) btn.click();
      return { drove: Boolean(btn), modalOpenAtAct };
    })()`);
    await sleep(300);
    const modalClosesToast = await evalPage<{ toasts: string[]; saysClose: boolean; saysAbove: boolean; overlay: boolean; bannerVisible: boolean }>(`(() => ({
      toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim()),
      saysClose: [...document.querySelectorAll(".toast")].some((t) => /Close this to see why/i.test(t.textContent)),
      saysAbove: [...document.querySelectorAll(".toast")].some((t) => /See the notice above/i.test(t.textContent)),
      overlay: Boolean(document.querySelector(".modal-overlay")),
      bannerVisible: (() => { const b = document.querySelector('[data-testid="storage-write-failure-banner"]'); return Boolean(b && b.offsetParent !== null); })(),
    }))()`);
    assert("modal-close-probe-really-closed-the-modal-after-acting",
      modalCloses.drove === true && modalCloses.modalOpenAtAct === true
        && modalClosesToast.overlay === false && modalClosesToast.bannerVisible === true,
      `the probe must act inside a modal that then CLOSES, leaving the notice visible: ${JSON.stringify({ ...modalCloses, ...modalClosesToast }).slice(0, 260)}`);
    assert("toast-does-not-say-close-this-when-no-modal-is-open",
      modalClosesToast.saysAbove === true && modalClosesToast.saysClose === false,
      `the modal closed and the notice is visible, so the toast must point at it: ${JSON.stringify(modalClosesToast.toasts)}`);

    // EVERY FAILURE TOAST MUST BE AUDIBLE. `toast()` now derives its live-region urgency from
    // the leading "⚠", so a failure message WITHOUT that prefix is announced politely and can
    // be missed entirely by a screen-reader user. Two identical image-read failures differed
    // only by the prefix — one audible, one not — and a DOM probe cannot reach either without a
    // real file upload, so the invariant is asserted over the SOURCE instead. This is a static
    // check by necessity, and it is stated as such rather than dressed up as a behavioural one.
    const appSource = await readFile(new URL("./app.ts", import.meta.url), "utf8");
    const unprefixedFailureToasts = [...appSource.matchAll(/toast\("([^"\u26a0][^"]*)"\)/g)]
      .map((m) => m[1] ?? "")
      // A failure is what the person could not do or must do first. Confirmations of work that
      // actually happened legitimately stay polite.
      .filter((t) => /^(Could not|Cannot|Add |Accept |Describe |Type |Product name)/.test(t));
    assert("every-refusal-toast-carries-the-warning-prefix-that-makes-it-audible",
      unprefixedFailureToasts.length === 0,
      `these refusal messages would be announced politely and can be missed: ${JSON.stringify(unprefixedFailureToasts)}`);

    // A READ MUST NOT REPORT A WRITE. `act()` also wraps `ask()`, whose locate /
    // which-container / container-contents / attention / unpack branches never write. The
    // first version of the silent-write disclosure used `okMsg === null` as its test for "a
    // silent write", so it fired on questions — and because the failure only clears on a
    // landed write, EVERY question for the rest of the session reported a change the person
    // never made. Announcing a write that never happened is the same dishonesty as hiding one
    // that did, and it went unnoticed because nothing in this suite drove `ask` under a
    // standing failure. It does now, through the real control.
    const askUnderFailure = await evalPage<{ failureStanding: boolean; askRan: boolean; toasts: string[]; claimsAChange: boolean; answered: boolean }>(`(() => {
      const s = window.nestory.store;
      // Establish a standing refusal first, via a real mutation.
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k));
      const roomId = s.createRoom({ name: "Ask Probe Room" });
      const contId = s.createContainer({ name: "Ask Probe Shelf", kind: "shelf", roomId });
      // A belonging too: the control case below drives the item-state select, which only
      // exists inside an item modal, which needs an item.
      s.createBelonging({ name: "Ask Probe Passport", kinds: ["passport"], defaultHome: { type: "container", id: contId } });
      const g = [1024*512, 1024*16, 1024, 64, 8];
      for (let i = 0; i < g.length; i++) { try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-ask-" + i + "-" + n, "x".repeat(g[i])); } catch (e) {} }
      s.createRoom({ name: "Ask Probe Refused" });
      const failureStanding = s.storageWriteFailure() !== null;
      // Now ASK a question through the app's own control, and clear prior toasts first.
      window.nestory.setView("ask");
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const input = document.getElementById("ask-input");
      const btn = document.querySelector('[data-action="ask-send"]');
      if (!input || !btn) return { failureStanding, askRan: false, toasts: [], claimsAChange: false, answered: false };
      input.value = "where is my passport";
      btn.click();
      const toasts = [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim());
      return {
        failureStanding,
        askRan: true,
        toasts,
        // The defect signature: a read producing a "not saved" / "that change" claim.
        claimsAChange: toasts.some((t) => /not saved|That change/i.test(t)),
        answered: window.nestory.ui.askLog.length > 0,
      };
    })()`);
    await sleep(400);
    const askSettled = await evalPage<{ toasts: string[]; claimsAChange: boolean }>(`(() => {
      const toasts = [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim());
      return { toasts, claimsAChange: toasts.some((t) => /not saved|That change/i.test(t)) };
    })()`);
    assert("ask-probe-really-asked-under-a-standing-failure",
      askUnderFailure.failureStanding === true && askUnderFailure.askRan === true && askUnderFailure.answered === true,
      `the probe must ask a real question while a refusal stands: ${JSON.stringify(askUnderFailure).slice(0, 260)}`);
    assert("a-read-does-not-report-a-write-that-never-happened",
      askUnderFailure.claimsAChange === false && askSettled.claimsAChange === false,
      `asking a question must not claim a change: ${JSON.stringify(askSettled.toasts)}`);
    // THE KIT BRANCH IS A WRITE. `ask()` is not purely a read: its kit branch reaches
    // `start_operation` -> `appendCommit()` -> `persist()`, a real commit to the Place Graph.
    // A reviewer found the reply saying "Started the gym kit" in the past tense while the write
    // had been refused and nothing said so — and found it against a comment of mine asserting
    // ask() never writes. Hand-tagging mutating callers is what drifted; the trigger now
    // measures the refusal count across the call, so this case needs no tag and cannot be
    // missed by classification. Driven through the real Ask composer.
    const kitAsk = await evalPage<{ asked: boolean; countBefore: number | null; countAfter: number | null; replyText: string }>(`(() => {
      const s = window.nestory.store;
      const before = s.storageWriteFailure();
      window.nestory.setView("ask");
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const input = document.getElementById("ask-input");
      const btn = document.querySelector('[data-action="ask-send"]');
      if (!input || !btn) return { asked: false, countBefore: null, countAfter: null, replyText: "" };
      input.value = "get my gym kit ready";
      btn.click();
      const after = s.storageWriteFailure();
      const log = window.nestory.ui.askLog;
      return { asked: true,
               countBefore: before ? before.unsavedChanges : 0,
               countAfter: after ? after.unsavedChanges : 0,
               replyText: log.length ? String(log[log.length - 1].text || "") : "" };
    })()`);
    await sleep(400);
    const kitToast = await evalPage<{ warned: boolean; toasts: string[] }>(`(() => ({
      toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim()),
      warned: [...document.querySelectorAll(".toast")].some((t) => /not saved/i.test(t.textContent || "")),
    }))()`);
    assert("kit-ask-probe-really-attempted-a-write-that-was-refused",
      kitAsk.asked === true && kitAsk.countAfter !== null && kitAsk.countBefore !== null
        && (kitAsk.countAfter as number) > (kitAsk.countBefore as number),
      `the kit branch must attempt a real write and be refused: ${JSON.stringify(kitAsk).slice(0, 240)}`);
    assert("a-refused-write-inside-ask-is-not-reported-as-done",
      kitToast.warned === true,
      `the reply said the kit was started while the write was refused, and nothing said so: ${JSON.stringify(kitToast.toasts)}`);

    // The control case, same session: a real silent WRITE still discloses.
    const silentStillSpeaks = await evalPage<{ drove: boolean; why?: string; items?: number; failureStanding?: boolean }>(`(() => {
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const item = window.nestory.store.searchBelongings("")[0];
      if (!item) return { drove: false, why: "no belonging exists in this store" };
      window.nestory.openItem(item.id);
      const sel = document.querySelector('[data-action="item-state"]');
      if (!sel) return { drove: false, why: "no item-state select in the item modal",
        items: window.nestory.store.searchBelongings("").length,
        failureStanding: window.nestory.store.storageWriteFailure() !== null };
      const next = [...sel.options].map((o) => o.value).find((v) => v !== sel.value);
      sel.value = next;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { drove: true };
    })()`);
    await sleep(400);
    const silentSpoke = await evalPage<{ warned: boolean; toasts: string[] }>(`(() => ({
      toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim()),
      warned: [...document.querySelectorAll(".toast")].some((t) => /not saved/i.test(t.textContent || "")),
    }))()`);
    assert("silencing-reads-did-not-silence-refused-silent-writes",
      silentStillSpeaks.drove === true && silentSpoke.warned === true,
      `a refused select-driven write must still speak: ${JSON.stringify({ ...silentStillSpeaks, ...silentSpoke })}`);
    await evalPage(`(() => { Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k)); })()`);

    // THE LEFTOVER-RECOVERY STATE, IN THE DOM. A quarantine copy from an EARLIER boot sets a
    // recovery while the live key reads perfectly and the person's records load. Keying the
    // copy on "a recovery exists" told them their saved data cannot be read while the recovery
    // banner directly above said "Your current records loaded normally" - two banners
    // contradicting each other about the same bytes, and a false reason to reach for a
    // destructive repair. The store-level flag was locked; the rendered COPY was not, which is
    // the third time in this slice a state lock left a disclosure unchecked.
    const leftoverDom = await evalPage<{ recoverySaysLoadedNormally: boolean; failureText: string; hasStoredData: boolean | null; liveKeyReadable: boolean; seeded: boolean | null }>(`(() => {
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k));
      localStorage.removeItem("nestory-v2-own-unreadable-2");
      // An earlier boot's quarantine copy, and a HEALTHY live key holding real records.
      localStorage.setItem("nestory-v2-own-unreadable", "{ an older original");
      localStorage.removeItem("nestory-v2-own");
      location.reload();
      return { pending: true };
    })()`);
    void leftoverDom;
    await sleep(900);
    await waitForApp();
    const leftoverShown = await evalPage<{ recoverySaysLoadedNormally: boolean; failureText: string; hasStoredData: boolean | null; liveKeyReadable: boolean; seeded: boolean | null }>(`(() => {
      const s = window.nestory.store;
      // Land a write so the live key holds the person's own records and parses.
      const roomId = s.createRoom({ name: "Leftover Dom Room" });
      s.createContainer({ name: "Leftover Dom Shelf", kind: "shelf", roomId });
      let readable = false;
      try { readable = Boolean(JSON.parse(localStorage.getItem("nestory-v2-own") || "null")); } catch (e) { readable = false; }
      const g = [1024*512, 1024*16, 1024, 64, 8];
      for (let i = 0; i < g.length; i++) { try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-leftover-" + i + "-" + n, "x".repeat(g[i])); } catch (e) {} }
      s.createRoom({ name: "Leftover Dom Refused" });
      window.nestory.setView("home");
      const rec = document.querySelector('[data-testid="storage-recovery-banner"]');
      const fail = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const wf = s.storageWriteFailure();
      return {
        recoverySaysLoadedNormally: rec ? /loaded normally/i.test(rec.textContent) : false,
        failureText: fail ? fail.textContent.replace(/\\s+/g, " ").trim() : "",
        hasStoredData: wf ? wf.hasStoredData : null,
        liveKeyReadable: readable,
        seeded: s.storageRecovery() ? s.storageRecovery().seededThisBoot : null,
      };
    })()`);
    assert("leftover-dom-probe-has-a-readable-live-key-and-a-non-seeded-recovery",
      leftoverShown.liveKeyReadable === true && leftoverShown.seeded === false
        && leftoverShown.recoverySaysLoadedNormally === true && leftoverShown.failureText.length > 0,
      `the probe must reach a leftover recovery over readable data: ${JSON.stringify(leftoverShown).slice(0, 260)}`);
    assert("leftover-recovery-notice-does-not-call-readable-saved-data-unreadable",
      leftoverShown.hasStoredData === true
        && !/cannot read it/i.test(leftoverShown.failureText)
        && /last successful save/i.test(leftoverShown.failureText),
      leftoverShown.failureText.slice(0, 300));

    // THE SEVENTH STATE, IN THE DOM. A seeded boot whose write then LANDS must not be told the
    // stored copy is unreadable or that everything will be gone: the landed work survives. The
    // store flag is locked above, but a mutant that made the notice re-derive from
    // `seededThisBoot` alone passed the whole suite — the store-only lock could not see the copy.
    await evalPage(`(() => {
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k));
      localStorage.removeItem("nestory-v2-own-unreadable");
      localStorage.removeItem("nestory-v2-own-unreadable-2");
      localStorage.setItem("nestory-v2-own", "{ this boot corruption");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const seededLandedDom = await evalPage<{ seeded: boolean | null; landedInStorage: boolean; hasStoredData: boolean | null; text: string }>(`(() => {
      const s = window.nestory.store;
      const seeded = s.storageRecovery() ? s.storageRecovery().seededThisBoot : null;
      s.createRoom({ name: "Landed After Recovery" });        // LANDS: bytes are now ours
      let landed = false;
      try { landed = String(localStorage.getItem("nestory-v2-own") || "").indexOf("Landed After Recovery") !== -1; } catch (e) {}
      const g = [1024*512, 1024*16, 1024, 64, 8];
      for (let i = 0; i < g.length; i++) { try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-seeded-" + i + "-" + n, "x".repeat(g[i])); } catch (e) {} }
      s.createRoom({ name: "Refused After Landing" });        // refused
      window.nestory.setView("home");
      const b = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const wf = s.storageWriteFailure();
      return { seeded, landedInStorage: landed, hasStoredData: wf ? wf.hasStoredData : null,
               text: b ? b.textContent.replace(/\\s+/g, " ").trim() : "" };
    })()`);
    assert("seeded-then-landed-dom-probe-really-landed-a-write-after-a-seeded-boot",
      seededLandedDom.seeded === true && seededLandedDom.landedInStorage === true
        && seededLandedDom.text.length > 0,
      `the probe must land a write after a seeded boot: ${JSON.stringify(seededLandedDom).slice(0, 240)}`);
    assert("after-a-landed-write-the-notice-does-not-call-the-stored-copy-unreadable",
      seededLandedDom.hasStoredData === true
        && !/cannot read it/i.test(seededLandedDom.text)
        && !/Everything in this session/i.test(seededLandedDom.text)
        && /last successful save/i.test(seededLandedDom.text),
      seededLandedDom.text.slice(0, 320));
    await evalPage(`(() => { Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k)); localStorage.removeItem("nestory-v2-own"); location.reload(); })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    await evalPage(`(() => { Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k)); localStorage.removeItem("nestory-v2-own-unreadable"); localStorage.removeItem("nestory-v2-own"); location.reload(); })()`).catch(() => null);
    await sleep(900);
    await waitForApp();

    // THE TOAST IS ITS OWN ANNOUNCEMENT CHANNEL. A review measured it carrying no ARIA at
    // all - plain generic/StaticText in the a11y tree - so wherever the banner's assertive
    // moment was missed, nothing told a screen-reader user anything. A warning interrupts;
    // an ordinary confirmation stays polite.
    const writeFailureToastAria = await evalPage<{ warnRole: string | null; warnLive: string | null; plainRole: string | null; plainLive: string | null; warnText: string; plainText: string }>(`(() => {
      const s = window.nestory.store;
      const read = () => {
        const t = document.querySelector(".toast");
        return { role: t ? t.getAttribute("role") : null, live: t ? t.getAttribute("aria-live") : null, text: t ? t.textContent.trim() : "" };
      };
      // Do not inherit quota state from earlier probes: establish it here. A landed write
      // first (so a store exists at all), then fill, then a refusal.
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k));
      const roomId = s.createRoom({ name: "Aria Base Room" });
      const contId = s.createContainer({ name: "Aria Shelf", kind: "shelf", roomId });
      s.createBelonging({ name: "Aria Item", kinds: ["misc"], defaultHome: { type: "container", id: contId } });
      const g = [1024*512, 1024*16, 1024, 64, 8];
      for (let i = 0; i < g.length; i++) { try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-aria-" + i + "-" + n, "x".repeat(g[i])); } catch (e) {} }
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      // Drive a real control: calling s.createRoom() directly bypasses act(), which is what
      // produces the toast, so the probe would read an empty toast and blame the product.
      window.nestory.setView("setup");
      const btn = document.querySelector('[data-action="setup-add-room"]');
      if (btn) btn.click();
      return { pending: true, droveControl: Boolean(btn) };
    })()`);
    void writeFailureToastAria;
    await sleep(300);
    const writeFailureToastAriaWarn = await evalPage<{ role: string | null; live: string | null; text: string }>(`(() => {
      const t = document.querySelector(".toast");
      return { role: t ? t.getAttribute("role") : null, live: t ? t.getAttribute("aria-live") : null, text: t ? t.textContent.trim() : "" };
    })()`);
    assert("aria-probe-drove-a-real-control-and-got-a-toast",
      writeFailureToastAriaWarn.text.length > 0,
      `the probe must produce a real toast via act(), got: ${JSON.stringify(writeFailureToastAriaWarn)}`);
    assert("a-not-saved-toast-is-an-assertive-live-region",
      writeFailureToastAriaWarn.role === "alert" && writeFailureToastAriaWarn.live === "assertive" && /not saved/i.test(writeFailureToastAriaWarn.text),
      JSON.stringify(writeFailureToastAriaWarn));
    // And a SILENT write - the select-driven changes that pass okMsg === null - must still
    // speak when refused. The select shows the new value; without a toast nothing says it
    // will not survive a reload. Driven through the REAL select and a real change event, not
    // by calling the store method, which would bypass act() and prove nothing.
    const silentWrite = await evalPage<{ droveSelect: boolean; itemOpened: boolean }>(`(() => {
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const s = window.nestory.store;
      const item = s.searchBelongings("")[0];
      if (!item) return { droveSelect: false, itemOpened: false };
      window.nestory.openItem(item.id);
      const sel = document.querySelector('[data-action="item-state"]');
      if (!sel) return { droveSelect: false, itemOpened: true };
      const next = [...sel.options].map((o) => o.value).find((v) => v !== sel.value);
      sel.value = next;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { droveSelect: true, itemOpened: true };
    })()`);
    await sleep(300);
    const silentToast = await evalPage<{ toasts: string[]; warned: boolean; role: string | null }>(`(() => {
      const t = document.querySelector(".toast");
      return {
        toasts: [...document.querySelectorAll(".toast")].map((x) => x.textContent.trim()),
        warned: [...document.querySelectorAll(".toast")].some((x) => /not saved/i.test(x.textContent)),
        role: t ? t.getAttribute("role") : null,
      };
    })()`);
    assert("silent-write-probe-drove-the-real-select",
      silentWrite.droveSelect === true,
      `the probe must drive the real item-state select: ${JSON.stringify(silentWrite)}`);
    assert("a-refused-silent-write-still-says-it-was-not-saved",
      silentToast.warned === true && silentToast.role === "alert",
      `a select-driven change that was refused must not pass in silence: ${JSON.stringify(silentToast)}`);

    // A SECOND EPISODE MUST BE ANNOUNCED AGAIN. fail -> heal -> fail: the new refusal is
    // genuinely new disclosure even when its count coincides with the previous episode's.
    // Deleting the `announcedUnsavedChanges = 0` reset is type-clean and passed the whole
    // suite, while behaviourally rendering the second episode as `status` - so a
    // screen-reader user is told about the first loss and never about the second.
    const secondEpisode = await evalPage<{ firstRole: string | null; firstCount: number | null; healed: boolean; secondCount: number | null; secondRole: string | null }>(`(() => {
      const s = window.nestory.store;
      const fill = () => { const g = [1024*512, 1024*16, 1024, 64, 8];
        for (let i = 0; i < g.length; i++) { try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-episode-" + i + "-" + n, "x".repeat(g[i])); } catch (e) {} } };
      const free = () => Object.keys(localStorage).filter((k) => k.indexOf("quota-fill-episode-") === 0).forEach((k) => localStorage.removeItem(k));
      // Earlier probes in this section leave a standing failure and their own filler keys.
      // Clear EVERYTHING quota-fill-prefixed and land a write first, so this probe genuinely starts
      // from "saving works" - otherwise the heal below cannot happen and the counts carry
      // over from a previous episode (measured: secondCount 9 instead of 1).
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k));
      free();
      s.createRoom({ name: "Episode Base" });
      fill();
      s.createRoom({ name: "Episode One Refused" });
      window.nestory.setView("home");
      const b1 = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const firstRole = b1 ? b1.getAttribute("role") : null;
      const wf1 = window.nestory.store.storageWriteFailure();
      return { firstRole, firstCount: wf1 ? wf1.unsavedChanges : null, healed: false, secondCount: null, secondRole: null };
    })()`);
    await sleep(250);
    const secondEpisodeOut = await evalPage<{ healed: boolean; secondCount: number | null; secondRole: string | null }>(`(() => {
      const s = window.nestory.store;
      // HEAL: free the space and let a write land, which must clear the notice entirely.
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill-episode-") === 0).forEach((k) => localStorage.removeItem(k));
      s.createRoom({ name: "Episode Healed" });
      window.nestory.setView("home");
      const healed = window.nestory.store.storageWriteFailure() === null
        && !document.querySelector('[data-testid="storage-write-failure-banner"]');
      // FAIL AGAIN: a brand-new episode, whose count restarts at 1 just like the first.
      const g = [1024*512, 1024*16, 1024, 64, 8];
      for (let i = 0; i < g.length; i++) { try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-episode-" + i + "-" + n, "x".repeat(g[i])); } catch (e) {} }
      s.createRoom({ name: "Episode Two Refused" });
      window.nestory.setView("home");
      const b = document.querySelector('[data-testid="storage-write-failure-banner"]');
      const wf = window.nestory.store.storageWriteFailure();
      return { healed, secondCount: wf ? wf.unsavedChanges : null, secondRole: b ? b.getAttribute("role") : null };
    })()`);
    assert("second-episode-probe-really-healed-in-between",
      secondEpisode.firstRole === "alert" && secondEpisode.firstCount === 1
        && secondEpisodeOut.healed === true && secondEpisodeOut.secondCount === 1,
      `the probe must go fail -> heal -> fail with the count restarting: ${JSON.stringify({ ...secondEpisode, ...secondEpisodeOut })}`);
    assert("a-second-failure-episode-is-announced-again",
      secondEpisodeOut.secondRole === "alert",
      `a new episode must re-announce even when its count matches the previous one, got ${secondEpisodeOut.secondRole}`);
    await evalPage(`(() => { Object.keys(localStorage).filter((k) => k.indexOf("quota-fill-episode-") === 0).forEach((k) => localStorage.removeItem(k)); })()`);

    // IMPORT, the one user-facing write that used to bypass act(). It replaces the WHOLE
    // ledger, so it is both the write most likely to exceed quota and the one whose silent
    // failure costs most - and it alone still toasted a plain "Imported." while nothing had
    // reached storage. Driven through the real handler, not by calling importJson directly.
    await evalPage(`(() => {
      Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k));
      localStorage.removeItem("nestory-v2-own-unreadable");
      localStorage.removeItem("nestory-v2-own-unreadable-2");
      localStorage.removeItem("nestory-v2-own");
      location.reload();
    })()`).catch(() => null);
    await sleep(900);
    await waitForApp();
    const importDom = await evalPage<{ pending: boolean; before: string; dumpReady: boolean }>(`(() => {
      const s = window.nestory.store;
      s.createRoom({ name: "Import Base Room" });
      // The dump must be BIGGER than what is stored. Importing a byte-identical dump needs
      // no extra quota, so it succeeds and the probe would measure nothing: an earlier
      // version of this probe read beforeBytes === afterBytes === 315 and mistook "nothing
      // changed" for "the write was refused". Add rooms AFTER snapshotting the baseline.
      // Build the bigger dump FIRST (these writes land), then shrink the store back to the
      // small baseline, then fill quota. Only now is the pending import genuinely larger
      // than what is stored AND unable to fit.
      for (let i = 0; i < 40; i++) s.createRoom({ name: "Import Filler Room " + i });
      const dump = s.exportJson();
      s.reset();
      s.createRoom({ name: "Import Base Room" });
      const before = localStorage.getItem("nestory-v2-own") || "";
      window.__p5ImportBefore = before;
      const grains = [1024*512, 1024*16, 1024, 64, 8];
      for (let g = 0; g < grains.length; g++) {
        try { for (let n = 0; n < 20000; n++) localStorage.setItem("quota-fill-import-" + g + "-" + n, "x".repeat(grains[g])); } catch (e) {}
      }
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      // Drive the REAL control: build a File, put it on the actual #import-file input, and
      // dispatch a change event so the app's own handler and FileReader run. No test-only
      // hook is added to the product for this - the lock must exercise the shipped path.
      // The file input lives on the Ledger view only; navigate there through the app first.
      window.nestory.setView("ledger");
      const input = document.getElementById("import-file");
      if (!input) return { pending: false, before: before, dumpReady: false, why: "no #import-file on the ledger view" };
      const file = new File([JSON.stringify(dump)], "dump.json", { type: "application/json" });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { pending: true, before: before, dumpReady: Boolean(dump && dump.records && dump.records.length) };
    })()`);
    // FileReader is async: let the real onload fire before reading the outcome.
    await sleep(700);
    const importDom2 = await evalPage<{ toastWarned: boolean; toastSaid: string[]; storageUnchanged: boolean; failure: boolean; afterBytes: number; beforeBytes: number }>(`(() => {
      const after = localStorage.getItem("nestory-v2-own") || "";
      return {
        toastSaid: [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim()),
        toastWarned: [...document.querySelectorAll(".toast")].some((t) => /NOT saved/i.test(t.textContent)),
        storageUnchanged: window.__p5ImportBefore === after,
        failure: window.nestory.store.storageWriteFailure() !== null,
        afterBytes: after.length,
        beforeBytes: (window.__p5ImportBefore || "").length,
      };
    })()`);
    assert("import-probe-really-refused-the-write",
      importDom.dumpReady === true && importDom2.failure === true && importDom2.storageUnchanged === true,
      `the import probe must reach a refused write: ${JSON.stringify({ dumpReady: importDom.dumpReady, failure: importDom2.failure, storageUnchanged: importDom2.storageUnchanged, beforeBytes: importDom2.beforeBytes, afterBytes: importDom2.afterBytes })}`);
    assert("a-refused-import-is-not-toasted-as-plain-success", importDom2.toastWarned === true,
      `import replaced the whole ledger in memory and said it was saved: ${JSON.stringify(importDom2.toastSaid)}`);

    // Leave own mode clean for the assertions that follow.
    await evalPage(`(() => { Object.keys(localStorage).filter((k) => k.indexOf("quota-fill") === 0).forEach((k) => localStorage.removeItem(k)); localStorage.removeItem("nestory-v2-own"); localStorage.removeItem("nestory-v2-own-unreadable"); localStorage.removeItem("nestory-v2-own-unreadable-2"); location.reload(); })()`).catch(() => null);
    await sleep(900);
    await waitForApp();

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
    // EVERY REFUSAL MUST CARRY THE PREFIX THAT MAKES IT AUDIBLE. Urgency is derived from the
    // leading "⚠", so a failure message without it is announced politely and can be missed.
    //
    // INVERTED ON PURPOSE. The first version enumerated the wordings that existed the day it
    // was written (`/^(Could not|Cannot|Add |Accept |...)/`), which pins a string list while
    // the assertion NAME claims an invariant — a reviewer added `toast("Select a container
    // first.")` and the suite passed 369/369. So the test now works the other way round: every
    // toast literal must EITHER carry the prefix OR be named here as a genuine confirmation.
    // A new message defaults to failing, and the failure says exactly what to do — classify
    // it. That is the safe direction: an unclassified refusal is silent, and silence is the
    // defect. Template forms are scanned too, since a refusal can be interpolated.
    //
    // WHY STATIC, stated accurately. An earlier version of this comment claimed the file-upload
    // refusals could not be reached behaviourally; a reviewer disproved that by driving one
    // through `DataTransfer` + a synthetic `File` + a `change` event, all within this harness's
    // existing capabilities. The real reason is coverage economics: one source sweep pins every
    // message at once, including future ones, where a behavioural probe pins the paths someone
    // remembered to drive. It is the weaker instrument for any single message and the stronger
    // one for the invariant. The ARIA behaviour itself is asserted in the browser below.
    const CONFIRMATIONS_THAT_MAY_STAY_POLITE = [
      "Visual draft ready — inspect every candidate before Review.",
    ];
    const appSrc = await readFile(new URL("./app.ts", import.meta.url), "utf8");
    const toastLiterals = [
      ...[...appSrc.matchAll(/toast\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1] ?? ""),
      ...[...appSrc.matchAll(/toast\(`((?:[^`\\]|\\.)*)`\)/g)].map((m) => m[1] ?? ""),
    ];
    const unclassified = toastLiterals
      .filter((t) => !t.startsWith("\u26a0"))
      .filter((t) => !CONFIRMATIONS_THAT_MAY_STAY_POLITE.includes(t));
    // Honesty guard: if the scan matched nothing at all, everything below is vacuous.
    assert("toast-literal-scan-actually-found-the-messages",
      toastLiterals.length >= 8 && toastLiterals.some((t) => t.startsWith("\u26a0")),
      `the scan must find real toast messages, found ${toastLiterals.length}`);
    assert("every-refusal-toast-carries-the-warning-prefix-that-makes-it-audible",
      unclassified.length === 0,
      `these messages are neither prefixed nor listed as confirmations, so they would be ` +
      `announced politely and can be missed — prefix them or classify them: ${JSON.stringify(unclassified)}`);

    // IMPORT MUST NOT CONFIRM ITSELF. It was the one user-facing write with its own try/catch
    // and its own success toast, bypassing the single place where a write's outcome is judged.
    // It replaces the whole ledger, so a silent failure costs everything.
    //
    // The first version paired a positive regex with a negative one meant to catch the reverted
    // form; a reviewer showed the negative clause could not match it (`[^)]*` cannot cross the
    // `)` inside `JSON.parse(String(...))`), and that a variant which calls act() AND then
    // toasts separately passed. Replaced with a check on the import handler's own body: within
    // it, `importJson` must appear inside an `act(` call, and no bare success toast may sit
    // beside it. Scoped to the handler so an unrelated `toast("Imported.")` elsewhere cannot
    // satisfy or break it.
    const importHandler = (() => {
      const at = appSrc.indexOf("reader.onload");
      if (at < 0) return "";
      return appSrc.slice(at, appSrc.indexOf("reader.readAsText", at));
    })();
    assert("import-handler-was-actually-located-for-inspection",
      importHandler.includes("importJson"),
      "the import handler body must be found, or the lock below proves nothing");
    assert("import-reports-through-the-shared-write-path-not-its-own-toast",
      /act\(\s*\(\)\s*=>\s*store\.importJson\(/.test(importHandler)
        && !/toast\(\s*"Imported\./.test(importHandler),
      `import must route its outcome through act() and must not toast success itself: ${JSON.stringify(importHandler.trim().slice(0, 220))}`);

    // ---------------------------------------------------------------- toast audibility
    // The toast is the only feedback several actions give, and it carried no live-region
    // semantics at all, so a screen-reader user was told nothing by it — including when it
    // reported a failure. Driven through real controls in a real browser.
    const toastAria = await evalPage<{ warnRole: string | null; warnLive: string | null; warnText: string; okRole: string | null; okLive: string | null; okText: string }>(`(() => {
      const read = () => {
        const t = document.querySelector(".toast");
        return { role: t ? t.getAttribute("role") : null, live: t ? t.getAttribute("aria-live") : null, text: t ? t.textContent.trim() : "" };
      };
      // A REFUSAL, whichever one this reaches. Submitting the add-belonging modal with an empty
      // name is refused by the store and surfaced through the shared catch as a prefixed
      // warning. An earlier comment claimed it exercised the no-container-selected guard; that
      // branch is unreachable in the seeded home, because the default-home select is populated.
      // The ARIA claim holds either way - a real refusal on a real warning path - but the
      // comment named a branch the assertion never touched.
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      window.nestory.setView("belongings");
      const opener = document.querySelector('[data-action="open-add-belonging"]');
      if (opener) opener.click();
      const submit = document.querySelector('[data-action="add-belonging-submit"]');
      if (submit) submit.click();
      const warn = read();
      // A CONFIRMATION: adding a room through Setup succeeds and toasts politely.
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      window.nestory.ui.modal = null;
      window.nestory.setView("setup");
      const addRoom = document.querySelector('[data-action="setup-add-room"]');
      if (addRoom) addRoom.click();
      const ok = read();
      // Leave the app exactly as the following assertions expect it: this probe navigated and
      // opened a modal, and the plan assertion below reads the Plan view. Restoring here rather
      // than making the next assertion tolerant, so it keeps testing what it was written for.
      window.nestory.ui.modal = null;
      window.nestory.setView("plan");
      return { warnRole: warn.role, warnLive: warn.live, warnText: warn.text,
               okRole: ok.role, okLive: ok.live, okText: ok.text };
    })()`);
    // Honesty guard: if neither control produced a toast, everything below would be vacuous.
    assert("toast-probe-produced-both-a-refusal-and-a-confirmation",
      toastAria.warnText.length > 0 && toastAria.okText.length > 0
        && toastAria.warnText.startsWith("\u26a0") && !toastAria.okText.startsWith("\u26a0"),
      JSON.stringify(toastAria));
    assert("a-refusal-toast-is-an-assertive-live-region",
      toastAria.warnRole === "alert" && toastAria.warnLive === "assertive",
      JSON.stringify({ role: toastAria.warnRole, live: toastAria.warnLive, text: toastAria.warnText }));
    // And a confirmation must NOT interrupt: making every toast assertive would train people
    // to ignore the channel, which costs exactly the warnings this change exists to deliver.
    assert("a-confirmation-toast-stays-polite",
      toastAria.okRole === "status" && toastAria.okLive === "polite",
      JSON.stringify({ role: toastAria.okRole, live: toastAria.okLive, text: toastAria.okText }));

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
