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
