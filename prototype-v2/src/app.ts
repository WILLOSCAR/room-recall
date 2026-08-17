// Nestory V2 · Home Memory Console UI.
// Thin DOM layer over store.ts. All state mutations go through the store;
// the UI re-renders from derived state on every change.
//
// Two home modes (PRD P0.9): "demo" boots the seeded home, "own" starts from
// an empty Place Graph with a guided Setup flow. Each mode persists its own
// records; the first run shows a welcome choice.

import { catalog, buildSeedRecords, emptyCatalog, ROOM_TEMPLATES, CONTAINER_KIND_OPTIONS } from "./data.ts";
import { createStore } from "./store.ts";
import { createAgentToolkit } from "./agent.ts";
import type { AgentToolkit } from "./agent.ts";
import { ask } from "./ask.ts";
import type { AskReply } from "./ask.ts";
import { decorateIcons } from "../lucide-lite.js";
import type { SpatialObject, SpatialSceneData } from "./spatial.ts";
import type {
  BoxStatus, CommitOp, ContainerView, DeepReadonly, LifecycleState, LocateAnswer,
  ObservationRecord, OperationView, PhotoMedia, ProposalView, RowStatus, StorageLike, Store
} from "./types.ts";
import { BOX_STATUSES, LIFECYCLE_STATES, ROW_STATUSES } from "./types.ts";

// ------------------------------------------------------------------- mode

type HomeMode = "demo" | "own";
const MODE_KEY = "nestory-v2-mode";

function requiredBrowserStorage(): StorageLike {
  const storage = window.localStorage;
  const probeKey = "nestory-v2-storage-probe";
  storage.setItem(probeKey, "1");
  storage.removeItem(probeKey);
  return storage;
}

const browserStorage = requiredBrowserStorage();

function readMode(): HomeMode | null {
  const raw = browserStorage.getItem(MODE_KEY);
  return raw === "demo" || raw === "own" ? raw : null;
}

const mode: HomeMode | null = readMode();
document.body.classList.toggle("welcome-mode", mode === null);

const store: Store = createStore(
  mode === "own"
    ? { catalog: emptyCatalog, seedFactory: () => [], persistKey: "nestory-v2-own", storage: browserStorage }
    : { catalog, seedFactory: () => buildSeedRecords(Date.now()), persistKey: "nestory-v2", storage: browserStorage }
);

const agent: AgentToolkit = createAgentToolkit(store);

function chooseMode(next: HomeMode): void {
  browserStorage.setItem(MODE_KEY, next);
  location.reload();
}

// --------------------------------------------------------------------- ui

const VIEWS = [
  { id: "home", label: "Home", icon: "house", group: "overview" },
  { id: "ask", label: "Ask Nestory", icon: "sparkles", group: "memory" },
  { id: "capture", label: "Capture", icon: "scan-line", group: "memory" },
  { id: "setup", label: "Setup", icon: "wand-sparkles", group: "memory" },
  { id: "spaces", label: "Spaces", icon: "panels-top-left", group: "memory" },
  { id: "belongings", label: "Belongings", icon: "package-search", group: "memory" },
  { id: "operations", label: "Operations", icon: "route", group: "workflows" },
  { id: "review", label: "Review inbox", icon: "list-checks", group: "workflows" },
  { id: "plan", label: "Spatial view", icon: "cuboid", group: "system" },
  { id: "ledger", label: "Commit Ledger", icon: "rows-3", group: "system" }
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

type Modal =
  | { type: "container"; id: string }
  | { type: "item"; id: string }
  | { type: "add-belonging" }
  | { type: "mobile-nav" };

interface AskLogEntry {
  who: "you" | "nestory";
  text: string;
  reply?: AskReply;
}

type CaptureMode = "room" | "container" | "product";
type PlanMode = "2d" | "3d";
type ScanDecision = "pending" | "accepted" | "rejected";

interface ScanDraftProposal {
  id: string;
  label: string;
  kind: "furniture" | "container" | "item";
  confidence: number;
  decision: ScanDecision;
  object: SpatialObject;
}

interface ScanDraft {
  fileName: string;
  anchorCm: number;
  coverage: number;
  proposals: ScanDraftProposal[];
}

interface ProposalReviewEdit {
  placements: Record<string, string>;
  mergeKeepId?: string;
}

interface CaptureDrafts {
  room: { anchorCm: string; scope: string; targetContainerId: string };
  container: { containerId: string; seen: string };
  product: {
    name: string;
    tags: string;
    width: string;
    depth: string;
    height: string;
    defaultHome: string;
    source: "product" | "manual" | "scan";
  };
  snapshots: Record<string, string>;
}

interface FurnitureVisualProfile {
  height: number;
  color: number;
  archetype: SpatialObject["archetype"];
  rotationY?: number;
}

const DEFAULT_FURNITURE_VISUAL: FurnitureVisualProfile = { height: 0.68, color: 0x9a9f96, archetype: "block" };
const FURNITURE_VISUALS: Readonly<Record<string, FurnitureVisualProfile>> = {
  bed: { height: 0.48, color: 0xc5b8a6, archetype: "bed" },
  wardrobe: { height: 2.05, color: 0x879286, archetype: "wardrobe" },
  desk: { height: 0.74, color: 0x697d71, archetype: "desk" },
  "storage-shelf": { height: 1.72, color: 0x879286, archetype: "bookcase" },
  "bedside-table": { height: 0.62, color: 0x8a7b6b, archetype: "nightstand" },
  "shoe-rack": { height: 0.52, color: 0xa39a8a, archetype: "rack" },
  "bathroom-shelf": { height: 0.52, color: 0x8b9c94, archetype: "rack" }
};

const OPERATION_LAUNCHERS: Readonly<Record<string, { icon: string; note: string }>> = {
  move: { icon: "truck", note: "Boxes, destinations, unpack order" },
  gym: { icon: "dumbbell", note: "Resolve gear into pickup stops" },
  travel: { icon: "luggage", note: "Pack essentials without duplicates" }
};

const LIST_WINDOW_SIZE = 100;
const REVIEW_WINDOW_SIZE = 20;
const MOBILE_PRIMARY_VIEWS: readonly ViewId[] = ["home", "ask", "capture", "review"];

interface UIState {
  view: ViewId;
  lastAnswer: DeepReadonly<LocateAnswer> | null;
  modal: Modal | null;
  belongingsQuery: string;
  belongingsOffset: number;
  stateFilter: LifecycleState | "";
  openOpId: string | null;
  boxQuery: string;
  pendingSnapshotPhoto: PhotoMedia | null;
  askLog: AskLogEntry[];
  captureMode: CaptureMode;
  planMode: PlanMode;
  spatialPreset: "home" | "study" | "top";
  spatialSelectedId: string | null;
  spatialLayers: { furniture: boolean; boxes: boolean; proposals: boolean; pin: boolean };
  spatialXray: boolean;
  scanDraft: ScanDraft | null;
  captureMedia: { room: PhotoMedia | null; container: PhotoMedia | null };
  captureDrafts: CaptureDrafts;
  proposalEdits: Record<string, ProposalReviewEdit>;
  reviewOffset: number;
  ledgerOffset: number;
  containerItemsQuery: string;
  containerItemsOffset: number;
  mediaPending: { room: boolean; container: boolean; snapshot: boolean };
}

const ui: UIState = {
  view: mode === "own" && store.state.rooms.size === 0 ? "setup" : "home",
  lastAnswer: null,
  modal: null,
  belongingsQuery: "",
  belongingsOffset: 0,
  stateFilter: "",
  openOpId: null,
  boxQuery: "",
  pendingSnapshotPhoto: null,
  askLog: [],
  captureMode: "room",
  planMode: "3d",
  spatialPreset: "home",
  spatialSelectedId: null,
  spatialLayers: { furniture: true, boxes: true, proposals: true, pin: true },
  spatialXray: false,
  scanDraft: null,
  captureMedia: { room: null, container: null },
  captureDrafts: {
    room: { anchorCm: "140", scope: "Bedroom", targetContainerId: "" },
    container: { containerId: "", seen: "" },
    product: { name: "", tags: "", width: "", depth: "", height: "", defaultHome: "", source: "product" },
    snapshots: {}
  },
  proposalEdits: {},
  reviewOffset: 0,
  ledgerOffset: 0,
  containerItemsQuery: "",
  containerItemsOffset: 0,
  mediaPending: { room: false, container: false, snapshot: false }
};

const compactHomeQuery = window.matchMedia("(max-width: 760px)");

interface MountedSpatialSurface {
  element: HTMLElement;
  signature: string;
  dispose(): void;
}

interface PendingSpatialSurface {
  key: string;
  element: HTMLElement;
  signature: string;
  data: SpatialSceneData;
}

const mountedSpatialSurfaces = new Map<string, MountedSpatialSurface>();
let spatialModule: Promise<typeof import("./spatial.ts")> | null = null;
let renderGeneration = 0;
let decorationFrame: number | null = null;
let focusRestoreFrame: number | null = null;
let snapshotPhotoReadToken = 0;
let scanMediaReadToken = 0;
let focusModalOnRender = false;
let focusViewOnRender = false;

function dispatchSpatialCommand(detail:
  | { type: "preset"; preset: UIState["spatialPreset"] }
  | { type: "select"; id: string }
  | { type: "layer"; layer: "furniture" | "boxes" | "proposals" | "pin"; visible: boolean }
  | { type: "xray"; on: boolean }
): void {
  const surface = document.querySelector<HTMLElement>('[data-testid="plan-3d"][data-spatial-scene]');
  surface?.dispatchEvent(new CustomEvent("spatial-command", { detail }));
}

// Selection is state-first: `ui.spatialSelectedId` is authoritative and the DOM
// (aria-pressed across every spatial-select control, the inspector title/detail,
// and the 2D plan outline) is patched directly. This works in 2D mode and after a
// lost/failed 3D mount, where no live scene exists to echo a `spatial-selection`
// event back. Selection state stays out of `spatialSceneData()` so the scene
// signature is stable and the WebGL context is never disposed/remounted (ADR 0002).
function applySpatialSelection(id: string | null, opts: { dispatchToScene?: boolean } = {}): void {
  ui.spatialSelectedId = id;
  const object = id ? store.catalog.furniture.find((f) => f.id === id) ?? null : null;
  const roomId = object?.room ?? null;
  const roomName = roomId ? store.state.rooms.get(roomId)?.name ?? "Home" : null;
  for (const button of document.querySelectorAll<HTMLElement>('[data-action="spatial-select"]')) {
    button.setAttribute("aria-pressed", String(button.dataset.id === id));
  }
  for (const group of document.querySelectorAll<SVGElement>('.plan-object[data-id]')) {
    const selected = group.getAttribute("data-id") === id;
    group.classList.toggle("selected", selected);
    if (selected) group.setAttribute("aria-pressed", "true");
    else group.setAttribute("aria-pressed", "false");
  }
  const title = document.querySelector<HTMLElement>("[data-spatial-selection-title]");
  const detail = document.querySelector<HTMLElement>("[data-spatial-selection-detail]");
  if (title) title.textContent = object?.name ?? "Choose an anchor";
  if (detail) detail.textContent = object ? (roomName ?? "Home") : "Select a furniture anchor to inspect it.";
  if (object) announce(`${object.name}, ${roomName ?? "home"}.`);
  if (opts.dispatchToScene && id) dispatchSpatialCommand({ type: "select", id });
}

document.addEventListener("spatial-preset-change", (event) => {
  const preset = (event as CustomEvent<UIState["spatialPreset"]>).detail;
  if (preset !== "home" && preset !== "study" && preset !== "top") return;
  ui.spatialPreset = preset;
  for (const button of document.querySelectorAll<HTMLElement>('[data-action="spatial-preset"]')) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === preset));
  }
});

document.addEventListener("spatial-selection", (event) => {
  const selection = (event as CustomEvent<{ id: string; name: string; roomId?: string } | null>).detail;
  // The scene raised this (a canvas click), so reflect it into state/DOM but do
  // not dispatch back to the scene — it already knows.
  applySpatialSelection(selection?.id ?? null);
});

interface ModalReturnFocus {
  elementId?: string;
  dataset: Record<string, string>;
  selection?: { start: number; end: number };
  reveal?: boolean;
}

let modalReturnFocus: ModalReturnFocus | null = null;
let controlReturnFocus: ModalReturnFocus | null = null;

function visibleViews(): typeof VIEWS[number][] {
  return VIEWS.filter((v) => v.id !== "setup" || mode === "own");
}

const STATE_CHIP: Record<LifecycleState, [string, string]> = {
  at_home: ["sage", "at home"], with_me: ["violet", "with me"], packed: ["accent", "packed"],
  in_transit: ["blue", "in transit"], laundry: ["blue", "laundry"], drying: ["blue", "drying"],
  lent_out: ["amber", "lent out"], consumed: ["neutral", "consumed"],
  missing: ["red", "missing"], retired: ["neutral", "retired"]
};

const ROW_CHIP: Record<RowStatus, [string, string]> = {
  to_get: ["neutral", "to get"], found: ["sage", "found"], packed: ["accent", "packed"],
  skipped: ["neutral", "skipped"], substituted: ["blue", "substituted"],
  missing: ["red", "missing"], uncertain: ["amber", "uncertain"]
};

// ------------------------------------------------------------------ utils

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function inputValue(id: string): string {
  const el = document.getElementById(id);
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : "";
}

function inputNumber(id: string): number {
  const value = Number(inputValue(id));
  return Number.isFinite(value) ? value : 0;
}

function syncDraftControl(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  switch (control.dataset.draft) {
    case "room-anchor": ui.captureDrafts.room.anchorCm = control.value; break;
    case "room-scope": ui.captureDrafts.room.scope = control.value; break;
    case "room-target": ui.captureDrafts.room.targetContainerId = control.value; break;
    case "container-id": ui.captureDrafts.container.containerId = control.value; break;
    case "container-seen": ui.captureDrafts.container.seen = control.value; break;
    case "product-name": ui.captureDrafts.product.name = control.value; break;
    case "product-tags": ui.captureDrafts.product.tags = control.value; break;
    case "product-width": ui.captureDrafts.product.width = control.value; break;
    case "product-depth": ui.captureDrafts.product.depth = control.value; break;
    case "product-height": ui.captureDrafts.product.height = control.value; break;
    case "product-home": ui.captureDrafts.product.defaultHome = control.value; break;
    case "product-source":
      if (control.value === "product" || control.value === "manual" || control.value === "scan") ui.captureDrafts.product.source = control.value;
      break;
    case "snapshot-text":
      if (control.dataset.container) ui.captureDrafts.snapshots[control.dataset.container] = control.value;
      break;
    default: break;
  }
}

function activeControlBookmark(): ModalReturnFocus | null {
  const active = document.activeElement;
  const view = document.getElementById("view");
  return active instanceof HTMLElement && view?.contains(active) ? focusBookmark(active) : null;
}

function buildScanDraft(anchorCm: number): ScanDraft {
  return {
    fileName: ui.captureMedia.room ? "room-photo.jpg" : "demo-room-sweep",
    anchorCm,
    coverage: ui.captureMedia.room ? 82 : 74,
    proposals: [
      { id: "scan-desk", label: "Desk · footprint 140 × 70 cm", kind: "furniture", confidence: 0.94, decision: "pending", object: { id: "scan-desk", label: "Desk candidate", kind: "furniture", x: 2.6, z: 0.15, w: 1.4, d: 0.7, h: 0.74, proposalState: "pending" } },
      { id: "scan-shelf", label: "Storage shelf · 4 levels", kind: "container", confidence: 0.78, decision: "pending", object: { id: "scan-shelf", label: "Shelf candidate", kind: "furniture", x: 3.65, z: 1.15, w: 0.45, d: 1.05, h: 1.75, proposalState: "pending" } },
      { id: "scan-bottle", label: "Water bottle · desk surface", kind: "item", confidence: 0.86, decision: "pending", object: { id: "scan-bottle", label: "Water bottle", kind: "box", x: 3.35, z: 0.38, w: 0.12, d: 0.12, h: 0.28, proposalState: "pending" } },
      { id: "scan-card", label: "Gym card · entry tray", kind: "item", confidence: 0.61, decision: "pending", object: { id: "scan-card", label: "Gym card", kind: "box", x: 4.82, z: 2.65, w: 0.12, d: 0.08, h: 0.02, proposalState: "pending" } }
    ]
  };
}

// The scene object a located item rests on/in: the nearest furniture or box in
// the answer's place chain. Used to pair the pin with a selection outline.
function spatialObjectIdForAnswer(answer: DeepReadonly<LocateAnswer> | null): string | null {
  if (!answer?.ok || !answer.planPin) return null;
  const furnitureIds = new Set(store.catalog.furniture.map((f) => f.id));
  const boxIds = new Set(store.containersView().filter((c) => c.kind === "box").map((c) => c.id));
  for (const node of answer.chain) {
    if (node.type === "furniture" && furnitureIds.has(node.id)) return node.id;
    if (node.type === "container" && boxIds.has(node.id)) return node.id;
  }
  return null;
}

// Set the current locate answer and pair the spatial selection with it so the
// pin and the selection outline reinforce each other in both 2D and 3D. Pure
// projection: no store write.
function setLocateAnswer(answer: DeepReadonly<LocateAnswer>): DeepReadonly<LocateAnswer> {
  ui.lastAnswer = answer;
  const paired = spatialObjectIdForAnswer(answer);
  if (paired) ui.spatialSelectedId = paired;
  return answer;
}

function spatialSceneData(includeScanDraft: boolean): SpatialSceneData {
  const rooms = [...store.state.rooms.values()].map((room) => ({
    id: room.id, name: room.name, x: room.plan.x, z: room.plan.y, w: room.plan.w, d: room.plan.h
  }));
  const objects: SpatialObject[] = store.catalog.furniture.map((f) => {
    const visual = FURNITURE_VISUALS[f.id] ?? DEFAULT_FURNITURE_VISUAL;
    return {
      id: f.id, name: f.name, roomId: f.room, kind: "furniture", x: f.plan.x, z: f.plan.y,
      w: f.plan.w, d: f.plan.h, h: visual.height, color: visual.color, archetype: visual.archetype, rotationY: visual.rotationY
    };
  });
  store.containersView().filter((c) => c.kind === "box").forEach((box, index) => {
    const room = store.state.rooms.get(box.parent.id) ?? [...store.state.rooms.values()][0];
    if (!room) return;
    objects.push({
      id: box.id, name: box.name, roomId: room.id, kind: "box", h: 0.46, w: 0.42, d: 0.42,
      archetype: "box",
      x: room.plan.x + room.plan.w - 0.58 - (index % 3) * 0.48,
      z: room.plan.y + room.plan.h - 0.55 - Math.floor(index / 3) * 0.48
    });
  });
  // The compact Home preview is ambient and never needs a search pin; keeping
  // it independent from lastAnswer preserves the mounted WebGL context across
  // the core Locate interaction. The full Plan owns the inspectable pin.
  const answer = ui.view === "plan" ? ui.lastAnswer : null;
  // Pair the pin with the spatial object the located item rests on/in: the nearest
  // furniture (or box) node in the answer's place chain that exists as a scene
  // object. This lets the scene auto-select it so the pin and selection outline
  // reinforce each other. Derived from the answer only — no store write.
  const spatialObjectIds = new Set(objects.map((o) => o.id));
  let pinObjectId: string | undefined;
  if (answer?.ok && answer.planPin) {
    for (const node of answer.chain) {
      if ((node.type === "furniture" || node.type === "container") && spatialObjectIds.has(node.id)) {
        pinObjectId = node.id;
        break;
      }
    }
  }
  return {
    rooms,
    objects,
    proposals: includeScanDraft ? ui.scanDraft?.proposals.map((p) => p.object) ?? [] : [],
    pin: answer?.ok && answer.planPin ? {
      x: answer.planPin.x, z: answer.planPin.y, y: 0.82,
      radius: 0.14 + (1 - answer.confidence) * 0.28,
      objectId: pinObjectId
    } : null
  };
}

function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "never";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function daysBetween(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function stateChip(state: LifecycleState): string {
  const [color, label] = STATE_CHIP[state];
  return `<span class="chip ${color}">${esc(label)}</span>`;
}

function rowChip(status: RowStatus): string {
  const [color, label] = ROW_CHIP[status];
  return `<span class="chip ${color}">${esc(label)}</span>`;
}

function confDot(c: number): string {
  const cls = c >= 0.7 ? "high" : c >= 0.45 ? "mid" : "low";
  return `<span class="conf-dot ${cls}"></span>`;
}

function confBar(c: number): string {
  const color = c >= 0.7 ? "var(--sage)" : c >= 0.45 ? "var(--amber)" : "var(--red)";
  return `<span class="conf-bar"><span style="width:${Math.round(c * 100)}%;background:${color}"></span></span>`;
}

interface PageIntroOptions {
  eyebrow: string;
  title: string;
  description: string;
  aside?: string;
  className?: string;
}

function renderPageIntro(options: PageIntroOptions): string {
  return `<div class="page-intro${options.className ? ` ${esc(options.className)}` : ""}">
    <div><div class="eyebrow">${esc(options.eyebrow)}</div><h2>${esc(options.title)}</h2><p>${esc(options.description)}</p></div>
    ${options.aside ?? ""}
  </div>`;
}

function renderPageMetrics(metrics: Array<{ value: string | number; label: string; valueId?: string }>): string {
  return `<div class="page-metrics">${metrics.map((metric) => `<span><strong${metric.valueId ? ` id="${esc(metric.valueId)}"` : ""}>${esc(metric.value)}</strong><small>${esc(metric.label)}</small></span>`).join("")}</div>`;
}

type ToastTone = "info" | "success" | "error";

interface ToastOptions {
  view?: ViewId | "global";
  tone?: ToastTone;
}

const toastTimers = new WeakMap<HTMLElement, number>();

function dismissToast(el: HTMLElement, immediate = false): void {
  const timer = toastTimers.get(el);
  if (timer !== undefined) window.clearTimeout(timer);
  toastTimers.delete(el);
  if (immediate || el.classList.contains("is-leaving")) {
    el.remove();
    return;
  }
  el.classList.add("is-leaving");
  window.setTimeout(() => el.remove(), 150);
}

function pruneToastsForView(view: ViewId | null): void {
  const root = document.getElementById("toast-root");
  if (!root) return;
  for (const candidate of [...root.children]) {
    if (!(candidate instanceof HTMLElement)) continue;
    const target = candidate.dataset.view;
    if (target !== "global" && target !== view) dismissToast(candidate, true);
  }
}

function toast(msg: string, options: ToastOptions = {}): void {
  const root = must<HTMLDivElement>("toast-root");
  const targetView = options.view ?? ui.view;
  const existing = [...root.children].find((candidate): candidate is HTMLElement =>
    candidate instanceof HTMLElement && candidate.dataset.view === targetView && candidate.textContent === msg
  );
  if (existing) dismissToast(existing, true);
  const el = document.createElement("div");
  const tone = options.tone ?? (msg.startsWith("⚠") ? "error" : "success");
  el.className = `toast tone-${tone}`;
  el.dataset.view = targetView;
  el.textContent = msg;
  root.appendChild(el);
  while (root.children.length > 3) {
    const oldest = root.firstElementChild;
    if (oldest instanceof HTMLElement) dismissToast(oldest, true);
  }
  toastTimers.set(el, window.setTimeout(() => dismissToast(el), 2_800));
}

function announce(message: string): void {
  const region = document.getElementById("answer-announcer");
  if (!region) return;
  region.textContent = "";
  queueMicrotask(() => { region.textContent = message; });
}

function rememberModalTrigger(trigger: HTMLElement): void {
  modalReturnFocus = focusBookmark(trigger);
}

function focusBookmark(trigger: HTMLElement): ModalReturnFocus {
  const selection = trigger instanceof HTMLInputElement || trigger instanceof HTMLTextAreaElement
    ? trigger.selectionStart !== null && trigger.selectionEnd !== null
      ? { start: trigger.selectionStart, end: trigger.selectionEnd }
      : undefined
    : undefined;
  return {
    elementId: trigger.id || undefined,
    dataset: Object.fromEntries(Object.entries(trigger.dataset).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    ...(selection ? { selection } : {})
  };
}

function restoreFocusTarget(target: ModalReturnFocus | null): void {
  if (!target) return;
  const byId = target.elementId ? document.getElementById(target.elementId) : null;
  const match = byId instanceof HTMLElement ? byId : [...document.querySelectorAll<HTMLElement>("[data-action], [data-role]")].find((candidate) =>
    Object.entries(target.dataset).every(([key, value]) => candidate.dataset[key] === value)
  );
  if (match) {
    match.focus({ preventScroll: true });
    if (target.selection && (match instanceof HTMLInputElement || match instanceof HTMLTextAreaElement)) {
      match.setSelectionRange(target.selection.start, target.selection.end);
    }
    if (target.reveal) match.scrollIntoView({ block: "nearest", inline: "nearest" });
    return;
  }
  const dialog = document.querySelector<HTMLElement>(".modal[role=dialog]");
  if (ui.modal && dialog) {
    dialog.focus();
    return;
  }
  const nextReviewAction = ui.view === "review"
    ? document.querySelector<HTMLElement>('[data-testid="proposal-card"] [data-action="accept-proposal"], [data-testid="review-empty"] button')
    : null;
  if (nextReviewAction) nextReviewAction.focus();
  else must<HTMLElement>("view").focus({ preventScroll: true });
}

function restoreModalTrigger(target: ModalReturnFocus | null): void {
  if (!target) return;
  if (focusRestoreFrame !== null) cancelAnimationFrame(focusRestoreFrame);
  const generation = renderGeneration;
  focusRestoreFrame = requestAnimationFrame(() => {
    focusRestoreFrame = null;
    if (generation !== renderGeneration) return;
    restoreFocusTarget(target);
  });
}

function closeModal({ restoreFocus = true } = {}): void {
  const returnTarget = restoreFocus ? modalReturnFocus : null;
  ui.modal = null;
  ui.pendingSnapshotPhoto = null;
  ui.mediaPending.snapshot = false;
  snapshotPhotoReadToken += 1;
  modalReturnFocus = null;
  controlReturnFocus = null;
  focusModalOnRender = false;
  focusViewOnRender = false;
  render();
  // `render()` is synchronous, so the opener already exists in the new DOM.
  // Restore immediately instead of waiting a frame and exposing a brief focus
  // vacuum to keyboard and screen-reader users.
  restoreFocusTarget(returnTarget);
}

function act<T>(fn: () => T, okMsg: string | null, okToast: ToastOptions = {}): T | null {
  try {
    const out = fn();
    if (okMsg) toast(okMsg, okToast);
    return out;
  } catch (err) {
    toast(`⚠ ${err instanceof Error ? err.message : String(err)}`, { tone: "error" });
    return null;
  }
}

function containerOptions(selected: string | null = null, { includeBoxes = true } = {}): string {
  return store.containersView()
    .filter((c) => includeBoxes || c.kind !== "box")
    .map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`)
    .join("");
}

async function downscalePhoto(file: File, maxDim = 640): Promise<PhotoMedia> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.8), width: w, height: h };
}

// ----------------------------------------------------------------- render

let renderQueued = false;
let sidebarProjectionKey: string | null = null;
let topbarProjectionKey: string | null = null;

function requestRender(): void {
  if (renderQueued) return;
  if (!controlReturnFocus && !focusModalOnRender) {
    const active = activeControlBookmark();
    if (active) {
      controlReturnFocus = active;
      focusViewOnRender = false;
    }
  }
  renderQueued = true;
  queueMicrotask(() => {
    if (!renderQueued) return;
    renderQueued = false;
    renderNow();
  });
}

function render(): void {
  // An explicit UI-state transition owns the commit for this task. If a Store
  // notification already queued the same work, this immediate final-state
  // render consumes it and the queued microtask becomes a no-op.
  renderQueued = false;
  renderNow();
}

function renderNow(): void {
  renderGeneration += 1;
  pruneToastsForView(mode === null ? null : ui.view);
  if (decorationFrame !== null) {
    cancelAnimationFrame(decorationFrame);
    decorationFrame = null;
  }
  if (focusRestoreFrame !== null) {
    cancelAnimationFrame(focusRestoreFrame);
    focusRestoreFrame = null;
  }
  renderSidebar();
  renderTopbar();
  if (mode === null) {
    must<HTMLElement>("view").innerHTML = renderWelcome();
    decorateUi();
    return;
  }
  const renderer: Record<ViewId, () => string> = {
    home: renderHome, ask: renderAsk, capture: renderCapture, setup: renderSetup, spaces: renderSpaces, belongings: renderBelongings,
    operations: renderOperations, review: renderReview, plan: renderPlan, ledger: renderLedger
  };
  must<HTMLElement>("view").innerHTML = renderer[ui.view]() + renderModal();
  decorateUi();
}

function decorateUi(): void {
  const generation = renderGeneration;
  const pendingSpatialSurfaces = reconcileSpatialSurfaces();
  decorateIcons();
  decorationFrame = requestAnimationFrame(() => {
    decorationFrame = null;
    if (focusModalOnRender && ui.modal) {
      focusModalOnRender = false;
      const dialog = document.querySelector<HTMLElement>(".modal[role=dialog]");
      if (dialog && !dialog.contains(document.activeElement)) {
        const initial = dialog.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]');
        (initial ?? dialog).focus({ preventScroll: true });
      }
    } else if (controlReturnFocus) {
      const target = controlReturnFocus;
      controlReturnFocus = null;
      restoreFocusTarget(target);
    } else if (focusViewOnRender) {
      focusViewOnRender = false;
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      must<HTMLElement>("view").focus({ preventScroll: true });
    }
    if (!pendingSpatialSurfaces.length) return;
    spatialModule ??= import("./spatial.ts");
    void spatialModule.then(({ mountSpatialScene }) => {
      if (generation !== renderGeneration) return;
      for (const pending of pendingSpatialSurfaces) {
        if (!pending.element.isConnected || mountedSpatialSurfaces.has(pending.key)) continue;
        const dispose = mountSpatialScene(pending.element, pending.data);
        mountedSpatialSurfaces.set(pending.key, {
          element: pending.element,
          signature: pending.signature,
          dispose
        });
      }
    }).catch((error: unknown) => {
      if (generation !== renderGeneration) return;
      for (const pending of pendingSpatialSurfaces) {
        if (!pending.element.isConnected) continue;
        pending.element.setAttribute("role", "status");
        pending.element.textContent = `Spatial view unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
  });
}

function spatialSurfaceKey(element: HTMLElement, index: number): string {
  return `${ui.view}:${element.dataset.spatialScene ?? "scene"}:${index}`;
}

function retainSpatialContainer(current: HTMLElement, placeholder: HTMLElement): void {
  if (current === placeholder) return;
  const renderSurface = current.querySelector<HTMLElement>("[data-spatial-scene-canvas=true], [data-spatial-scene-fallback=true]");
  const nextOverlay = [...placeholder.childNodes];
  for (const child of [...current.childNodes]) {
    if (child !== renderSurface) child.remove();
  }
  for (const attribute of [...current.attributes]) {
    if (attribute.name !== "style") current.removeAttribute(attribute.name);
  }
  for (const attribute of [...placeholder.attributes]) current.setAttribute(attribute.name, attribute.value);
  placeholder.replaceWith(current);
  for (const child of nextOverlay) current.appendChild(child);
  for (const child of [...current.children]) {
    if (!(child instanceof HTMLElement) || child === renderSurface) continue;
    if (getComputedStyle(child).position === "static") child.style.position = "relative";
    if (getComputedStyle(child).zIndex === "auto") child.style.zIndex = "1";
  }
}

function reconcileSpatialSurfaces(): PendingSpatialSurface[] {
  const placeholders = [...document.querySelectorAll<HTMLElement>("[data-spatial-scene]")];
  const liveKeys = new Set<string>();
  const pending: PendingSpatialSurface[] = [];

  placeholders.forEach((placeholder, index) => {
    const key = spatialSurfaceKey(placeholder, index);
    liveKeys.add(key);
    const data = spatialSceneData(placeholder.dataset.spatialScene === "scan");
    const signature = JSON.stringify(data);
    const mounted = mountedSpatialSurfaces.get(key);
    if (mounted && mounted.signature === signature) {
      retainSpatialContainer(mounted.element, placeholder);
      return;
    }
    if (mounted) {
      mounted.dispose();
      mountedSpatialSurfaces.delete(key);
    }
    pending.push({ key, element: placeholder, signature, data });
  });

  for (const [key, mounted] of mountedSpatialSurfaces) {
    if (liveKeys.has(key)) continue;
    mounted.dispose();
    mountedSpatialSurfaces.delete(key);
  }
  return pending;
}

function renderSidebar(): void {
  const pending = mode === null ? 0 : store.proposals("pending").length;
  const moreOpen = ui.modal?.type === "mobile-nav";
  const currentIsSecondary = !MOBILE_PRIMARY_VIEWS.includes(ui.view);
  const currentLabel = VIEWS.find((view) => view.id === ui.view)?.label ?? "section";
  const projectionKey = mode === null
    ? "welcome"
    : `${mode}:${ui.view}:${pending}:${store.state.belongings.size}:${moreOpen}`;
  if (sidebarProjectionKey === projectionKey) return;
  sidebarProjectionKey = projectionKey;

  const brand = `<div class="brand">
    <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
    <span class="brand-copy"><strong>Nestory</strong><small>Home memory</small></span>
  </div>`;
  if (mode === null) {
    must<HTMLElement>("sidebar").innerHTML = brand;
    return;
  }
  const groups = [
    ["overview", "Overview"],
    ["memory", "Memory"],
    ["workflows", "Workflows"],
    ["system", "Spatial & history"]
  ] as const;
  const navigation = groups.map(([group, label]) => {
    const views = visibleViews().filter((view) => view.group === group);
    if (!views.length) return "";
    return `<div class="nav-group">
      <div class="nav-group-label">${label}</div>
      ${views.map((v) => `
        <button class="nav-btn ${ui.view === v.id ? "active" : ""}" data-action="nav" data-view="${v.id}" data-testid="nav-${v.id}" data-mobile-primary="${MOBILE_PRIMARY_VIEWS.includes(v.id)}" ${ui.view === v.id ? 'aria-current="page"' : ""}>
          <span class="icon"><i data-lucide="${v.icon}"></i></span><span class="label">${v.label}</span>
          ${v.id === "review" && pending ? `<span class="badge" data-testid="review-badge">${pending}</span>` : ""}
        </button>`).join("")}
    </div>`;
  }).join("");
  must<HTMLElement>("sidebar").innerHTML = `
    ${brand}
    <div class="memory-status">
      <span class="memory-status-orb"><span class="live-dot"></span></span>
      <span><strong>${mode === "own" ? "Your home" : "Demo residence"}</strong><small>Home memory · ready</small></span>
      <span class="memory-status-count">${store.state.belongings.size}</span>
    </div>
    <nav class="primary-navigation" aria-label="Primary" data-testid="navigation-primary">${navigation}
      <button class="nav-btn mobile-nav-more ${currentIsSecondary ? "active" : ""}" data-action="open-mobile-nav" data-testid="mobile-nav-more" aria-haspopup="dialog" aria-controls="mobile-nav-dialog" aria-expanded="${moreOpen}" ${currentIsSecondary ? 'aria-current="page"' : ""} aria-label="More sections${currentIsSecondary ? `, current: ${esc(currentLabel)}` : ""}">
        <span class="icon"><i data-lucide="menu"></i></span><span class="label">More</span>
      </button>
    </nav>
    <button class="sidebar-capture" data-action="nav" data-view="capture"><i data-lucide="plus"></i><span>Capture memory</span></button>
    <div class="sidebar-foot"><i data-lucide="shield-check"></i><span>Uncertain changes wait for your review.</span></div>`;
}

function renderTopbar(): void {
  const projectionKey = mode === null ? "welcome" : `${mode}:${ui.view}`;
  if (topbarProjectionKey === projectionKey) return;
  topbarProjectionKey = projectionKey;

  if (mode === null) {
    must<HTMLElement>("topbar").innerHTML = `<h1>Welcome</h1>`;
    return;
  }
  const title = VIEWS.find((v) => v.id === ui.view)?.label ?? "Home";
  must<HTMLElement>("topbar").innerHTML = `
    <div class="topbar-context">
      <span>Home memory</span>
      <h1>${esc(title)}</h1>
    </div>
    <div class="global-command" data-testid="global-command">
      <i data-lucide="search"></i>
      <input type="text" id="top-search-input" placeholder="Find anything in your home…" aria-label="Find anything in your home" data-enter="top-locate">
      <span class="key-hint">/</span>
      <button class="command-submit" data-action="top-locate" aria-label="Locate item"><span>Locate</span><i data-lucide="arrow-right"></i></button>
    </div>
    <button class="top-capture" data-action="nav" data-view="capture" title="Capture home memory" aria-label="Capture home memory"><i data-lucide="scan-line"></i><span>Capture</span></button>`;
}

// ---------------------------------------------------------------- welcome

function renderWelcome(): string {
  return `<section data-testid="view-welcome">
    <div class="hero">
      <h2>Nestory — a memory system for your home</h2>
      <div class="muted">It remembers what you own, where it lives, what state it is in, and what you need for real operations like moving, unpacking, and preparing kits. Every answer carries evidence and confidence; nothing uncertain becomes truth without your review.</div>
    </div>
    <div class="grid-2">
      <button type="button" class="card op-card choice-card" data-action="choose-mode" data-mode="demo" data-testid="btn-mode-demo">
        <h3>Explore the demo home</h3>
        <div class="sub">A furnished rental bedroom mid-move: packed boxes, a fitness kit, a review inbox with real decisions to make. The fastest way to feel the product.</div>
        <span class="choice-cta">Open demo <i data-lucide="arrow-up-right"></i></span>
      </button>
      <button type="button" class="card op-card choice-card primary-choice" data-action="choose-mode" data-mode="own" data-testid="btn-mode-own">
        <h3>Start with my own home</h3>
        <div class="sub">Begin from nothing. A guided setup gets you to a searchable home memory — rooms, containers, first ten belongings, first operation — in under ten minutes.</div>
        <span class="choice-cta">Start setup <i data-lucide="arrow-up-right"></i></span>
      </button>
    </div>
    <div class="card" style="margin-top:14px"><div class="sub">You can switch between the two at any time from the Commit Ledger tab. Each keeps its own records.</div></div>
  </section>`;
}

// ------------------------------------------------------------------ setup

function activationChecklist(): string {
  const a = store.activation();
  const check = (ok: boolean, label: string) => `<span class="chip ${ok ? "sage" : "neutral"}">${ok ? "✓" : "○"} ${esc(label)}</span>`;
  return `<div style="display:flex;gap:6px;flex-wrap:wrap" data-testid="activation-checklist">
    ${check(a.rooms >= 1, `room (${a.rooms})`)}
    ${check(a.containers >= 1, `container (${a.containers})`)}
    ${check(a.belongings >= 10, `10 belongings (${a.belongings}/10)`)}
    ${check(a.operations >= 1, `operation started (${a.operations})`)}
    ${a.complete ? '<span class="chip sage">activated ✓</span>' : ""}
  </div>`;
}

function renderSetup(): string {
  if (mode !== "own") {
    return `<section data-testid="view-setup"><div class="card muted">Setup belongs to your own home. Switch modes from the Commit Ledger tab.</div></section>`;
  }
  const rooms = [...store.state.rooms.values()];
  const containers = store.containersView().filter((c) => c.kind !== "box");
  const belongings = store.searchBelongings("");
  const a = store.activation();
  const remainingTemplates = ROOM_TEMPLATES.filter((t) => !rooms.some((r) => r.name.toLowerCase() === t.toLowerCase()));

  return `<section data-testid="view-setup">
    <div class="hero">
      <h2>Set up your home memory</h2>
      <div class="muted">Four small steps. Every action below becomes a Commit Ledger entry — you can inspect all of it later.</div>
      <div style="margin-top:10px">${activationChecklist()}</div>
    </div>

    <div class="card">
      <h3>1 · Rooms</h3>
      <div class="sub">Add the rooms you actually use. Plan positions are auto-assigned.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
        ${remainingTemplates.map((t) => `<button class="small" data-action="setup-add-room" data-name="${esc(t)}">＋ ${esc(t)}</button>`).join("")}
        <input type="text" id="setup-room-name" aria-label="Custom room name" placeholder="Custom room…" maxlength="100" style="max-width:180px" data-enter="setup-add-room-custom">
        <button class="small" data-action="setup-add-room-custom">Add room</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${rooms.map((r) => `<span class="chip neutral">${esc(r.name)}</span>`).join("") || '<span class="faint">No rooms yet.</span>'}</div>
    </div>

    <div class="card">
      <h3>2 · Containers</h3>
      <div class="sub">Drawers, shelves, bags, boxes — the places things live in.</div>
      ${rooms.length ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;align-items:center">
          <select id="setup-container-room" aria-label="Room for new container">${rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select>
          <select id="setup-container-kind" aria-label="Container kind">${CONTAINER_KIND_OPTIONS.map((k) => `<option value="${k}">${k}</option>`).join("")}</select>
          <input type="text" id="setup-container-name" aria-label="Container name" placeholder="e.g. Top drawer" maxlength="120" style="max-width:200px" data-enter="setup-add-container">
          <button class="small" data-action="setup-add-container" data-testid="btn-setup-container">Add container</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${containers.map((c) => `<span class="chip neutral">${esc(c.name)}</span>`).join("") || '<span class="faint">No containers yet.</span>'}</div>
      ` : `<div class="muted" style="margin-top:8px">Add a room first.</div>`}
    </div>

    <div class="card">
      <h3>3 · First belongings <span class="chip ${a.belongings >= 10 ? "sage" : "accent"}">${a.belongings}/10</span></h3>
      <div class="sub">Start with what you actually lose: chargers, documents, gym gear, seasonal things. Tags help kits find them later (e.g. <span class="mono">charger</span>, <span class="mono">towel</span>, <span class="mono">passport</span>).</div>
      ${containers.length ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;align-items:center">
          <input type="text" id="setup-item-name" aria-label="Belonging name" placeholder="Belonging name" maxlength="200" style="max-width:190px" data-enter="setup-add-belonging">
          <input type="text" id="setup-item-tags" aria-label="Belonging tags" placeholder="tags (comma)" style="max-width:160px" data-enter="setup-add-belonging">
          <select id="setup-item-container" aria-label="Belonging default container">${containers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
          <select id="setup-item-importance" aria-label="Belonging importance"><option value="normal">normal</option><option value="high">high</option><option value="essential">essential</option></select>
          <button class="small primary" data-action="setup-add-belonging" data-testid="btn-setup-belonging">Add</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${belongings.slice(0, 12).map((v) => `<span class="chip neutral">${esc(v.name)}</span>`).join("")}${belongings.length > 12 ? `<span class="faint">+${belongings.length - 12} more</span>` : ""}</div>
      ` : `<div class="muted" style="margin-top:8px">Add a container first.</div>`}
    </div>

    <div class="card">
      <h3>4 · Start your first operation</h3>
      <div class="sub">Operations are why the memory stays alive. A Move works with just one room; kits resolve against your tags.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${store.catalog.operationTemplates.filter((t) => t.id !== "cleaning").map((t) => `<button data-action="start-op" data-template="${esc(t.id)}">＋ ${esc(t.name)}</button>`).join("")}
        <span style="flex:1"></span>
        <button class="ghost" data-action="nav" data-view="home">Go to Home →</button>
      </div>
    </div>
  </section>`;
}

// -------------------------------------------------------------------- ask

function askBubble(entry: AskLogEntry): string {
  if (entry.who === "you") {
    return `<div class="ask-row you"><div class="ask-bubble you">${esc(entry.text)}</div></div>`;
  }
  const reply = entry.reply;
  const calls = reply?.toolCalls.map((c) => `<span class="op-badge">${esc(c.name)} · ${esc(JSON.stringify(c.input))}</span>`).join("") ?? "";
  let extra = "";
  if (reply?.answer?.ok) {
    extra = renderAnswerCard(reply.answer);
  } else if (reply?.plan?.length) {
    extra = `<div class="card" style="box-shadow:none;margin-top:8px">
      ${reply.plan.map((g) => `<div class="priority-item"><span class="grow"><strong>${esc(g.label)}</strong>${g.needsReview ? ' <span class="chip amber">needs review</span>' : ""}<div class="place">${g.items.map((i) => esc(i.name)).join(" · ")}</div></span></div>`).join("")}
    </div>`;
  } else if (reply?.attention) {
    const rows = [
      ...reply.attention.staleContainers.slice(0, 3).map((c) => `<div class="attention-row"><span class="chip amber">stale</span><span class="grow">${esc(c.name)}</span></div>`),
      ...(reply.attention.pendingProposals ? [`<div class="attention-row"><span class="chip amber">review</span><span class="grow">${reply.attention.pendingProposals} pending proposal(s)</span><button class="small ghost" data-action="nav" data-view="review">Open</button></div>`] : [])
    ].join("");
    if (rows) extra = `<div class="card" style="box-shadow:none;margin-top:8px">${rows}</div>`;
  }
  return `<div class="ask-row"><div class="ask-bubble nestory">
    ${reply?.answer?.ok ? "" : `<div>${esc(entry.text)}</div>`}
    ${extra}
    ${calls ? `<details class="technical-details"><summary>How this answer was checked</summary><div class="cops">${calls}</div></details>` : ""}
  </div></div>`;
}

function renderAsk(): string {
  return `<section data-testid="view-ask">
    ${renderPageIntro({
      eyebrow: "Evidence before eloquence",
      title: "Ask the memory—not a model’s imagination.",
      description: "Every answer is checked against your home records, then paired with confidence, freshness, evidence, and a next action.",
      className: "ask-intro",
      aside: `<div class="ask-contract"><span class="live-dot"></span><span><strong>${agent.tools.length} trusted checks</strong><small>grounded in your home records</small></span></div>`
    })}
    <div class="ask-console">
      <div class="ask-console-head"><span><i data-lucide="sparkles"></i> Nestory</span><span><span class="live-dot"></span> Home memory ready</span></div>
      <div class="ask-log" role="log" aria-label="Conversation" data-testid="ask-log">
        ${ui.askLog.map(askBubble).join("") || `<div class="ask-starters"><span>Try asking</span>${["Where is my water bottle?", "Which box has my winter jacket?", "Prepare my gym kit", "What needs attention?"].map((prompt) => `<button data-action="ask-prompt" data-prompt="${esc(prompt)}"><i data-lucide="arrow-up-right"></i>${esc(prompt)}</button>`).join("")}</div>`}
      </div>
      <div class="ask-composer">
        <i data-lucide="sparkles"></i><input type="text" id="ask-input" aria-label="Ask Nestory" data-enter="ask-send" placeholder="Ask about belongings, boxes, kits, or what needs attention…">
        <button class="primary" data-action="ask-send" data-testid="btn-ask" aria-label="Ask Nestory"><i data-lucide="arrow-up"></i></button>
      </div>
    </div>
  </section>`;
}

function doAsk(raw: string): AskReply | null {
  const text = raw.trim();
  if (!text) return null;
  ui.askLog.push({ who: "you", text });
  const reply = act(() => ask(store, agent, text), null);
  if (reply) ui.askLog.push({ who: "nestory", text: reply.text, reply });
  render();
  const input = document.getElementById("ask-input");
  if (input instanceof HTMLInputElement) input.focus();
  const log = document.querySelector('[data-testid="ask-log"]');
  if (log) log.scrollTop = log.scrollHeight;
  if (reply) announce(reply.text);
  return reply;
}

// --------------------------------------------------------------- capture

function captureTabs(): string {
  const tabs: Array<[CaptureMode, string, string]> = [
    ["room", "scan-line", "Room scan"],
    ["container", "camera", "Container"],
    ["product", "barcode", "Product"]
  ];
  return `<div class="segmented" role="group" aria-label="Capture method">
    ${tabs.map(([id, icon, label]) => `<button type="button" aria-pressed="${ui.captureMode === id}" class="${ui.captureMode === id ? "active" : ""}" data-action="capture-mode" data-mode="${id}"><i data-lucide="${icon}"></i>${label}</button>`).join("")}
  </div>`;
}

function renderCapture(): string {
  const body = ui.captureMode === "room"
    ? renderRoomCapture()
    : ui.captureMode === "container" ? renderContainerCapture() : renderProductCapture();
  return `<section data-testid="view-capture">
    <div class="page-intro capture-intro">
      <div>
        <div class="eyebrow">Capture becomes a proposal, never automatic truth</div>
        <h2>Teach Nestory what your home looks like.</h2>
        <p>Start broad with a room, refresh one drawer with a photo, or add exact product dimensions. Everything enters the same review loop.</p>
      </div>
      <div class="flow-line" aria-label="Capture trust flow">
        <span>Capture</span><i data-lucide="arrow-right"></i><span>Observe</span><i data-lucide="arrow-right"></i><span>Review</span><i data-lucide="arrow-right"></i><span>Commit</span>
      </div>
    </div>
    ${captureTabs()}
    ${body}
  </section>`;
}

function renderRoomCapture(): string {
  const draft = ui.scanDraft;
  const accepted = draft?.proposals.filter((p) => p.decision === "accepted") ?? [];
  const containers = store.containersView().filter((c) => c.kind !== "box");
  return `<div class="capture-workspace">
    <div class="capture-controls">
      <div class="step-kicker">01 · Visual input</div>
      <h3>Walk the room once</h3>
      <p class="muted">Start with one wide room photo. A short walkthrough and corner photos can add more coverage when you need it.</p>
      <label class="upload-zone ${ui.captureMedia.room ? "has-media" : ""}">
        <input type="file" accept="image/*" capture="environment" data-role="room-scan-media">
        ${ui.mediaPending.room ? `<i data-lucide="scan-search"></i><span role="status"><strong>Preparing photo…</strong><small>Draft actions will unlock when it is ready.</small></span>` : ui.captureMedia.room ? `<img src="${esc(ui.captureMedia.room.dataUrl)}" alt="Room capture preview"><span><strong>Capture ready</strong><small>${ui.captureMedia.room.width} × ${ui.captureMedia.room.height}px</small></span>` : `<i data-lucide="camera"></i><span><strong>Add a room photo</strong><small>Camera or photo library</small></span>`}
      </label>
      <div class="field-row">
        <label><span>Known measurement</span><input type="number" id="scan-anchor" min="20" max="500" value="${esc(ui.captureDrafts.room.anchorCm)}" data-draft="room-anchor"><small>Desk width, cm</small></label>
        <label><span>Scan scope</span><select id="scan-scope" data-draft="room-scope">${["Bedroom", "Living room", "Entryway"].map((scope) => `<option ${ui.captureDrafts.room.scope === scope ? "selected" : ""}>${scope}</option>`).join("")}</select><small>One room per pass</small></label>
      </div>
      <button class="primary wide icon-label" data-action="run-room-scan" data-testid="btn-run-room-scan" ${ui.mediaPending.room ? "disabled" : ""}><i data-lucide="scan-line"></i><span>${ui.mediaPending.room ? "Preparing photo…" : draft ? "Rebuild visual draft" : "Build visual draft"}</span></button>
      <div class="honesty-note"><i data-lucide="info"></i><span>This preview uses a sample layout. Nothing enters home memory until you confirm it.</span></div>
    </div>
    <div class="capture-scene ${draft ? "is-ready" : ""}">
      <div class="scene-toolbar">
        <span><span class="live-dot ${draft ? "" : "idle"}"></span>${draft ? `Draft ready · ${draft.coverage}% coverage` : "Waiting for capture"}</span>
        ${draft ? `<span class="chip neutral">anchor ${draft.anchorCm} cm</span>` : ""}
      </div>
      ${draft
        ? `<div class="scan-scene" data-spatial-scene="scan" aria-label="Interactive 3D scan proposal"></div>`
        : `<div class="empty-scene"><i data-lucide="box"></i><strong>Your scan draft appears here</strong><span>Orbit the room, inspect translucent geometry, then decide what becomes memory.</span></div>`}
    </div>
  </div>
  ${draft ? `<div class="scan-review">
    <div class="scan-review-head"><div><div class="step-kicker">02 · Proposal review</div><h3>${draft.proposals.length} candidates found</h3></div><span class="muted">Furniture geometry remains a draft; accepted item observations can enter Review now.</span></div>
    <div class="proposal-table">
      ${draft.proposals.map((p) => `<div class="scan-proposal ${p.decision}" data-testid="scan-proposal">
        <span class="proposal-swatch ${p.kind}"></span>
        <span class="grow"><strong>${esc(p.label)}</strong><small>${p.kind} · confidence ${Math.round(p.confidence * 100)}%</small></span>
        <div class="decision-buttons">
          <button class="icon-button ${p.decision === "accepted" ? "selected good" : ""}" data-action="scan-decision" data-id="${p.id}" data-decision="accepted" aria-label="Accept ${esc(p.label)}" aria-pressed="${p.decision === "accepted"}" title="Accept"><i data-lucide="check"></i></button>
          <button class="icon-button ${p.decision === "rejected" ? "selected bad" : ""}" data-action="scan-decision" data-id="${p.id}" data-decision="rejected" aria-label="Reject ${esc(p.label)}" aria-pressed="${p.decision === "rejected"}" title="Reject"><i data-lucide="x"></i></button>
        </div>
      </div>`).join("")}
    </div>
    <div class="scan-commit-bar">
      <div><strong>${accepted.length} accepted</strong><span>Accepted furniture stays in the layout draft. Accepted item labels become a container snapshot proposal.</span></div>
      <select id="scan-target-container" aria-label="Target container" data-draft="room-target">${containers.map((c) => `<option value="${esc(c.id)}" ${ui.captureDrafts.room.targetContainerId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <button class="primary" data-action="scan-send-review" ${accepted.some((p) => p.kind === "item") && containers.length && !ui.mediaPending.room ? "" : "disabled"}>${ui.mediaPending.room ? "Preparing photo…" : "Send items to Review"}</button>
    </div>
  </div>` : ""}
  <div class="pipeline-strip">
    <div><i data-lucide="camera"></i><span><strong>Capture</strong><small>phone image or video</small></span></div>
    <div><i data-lucide="scan-search"></i><span><strong>Reconstruct</strong><small>camera + geometry draft</small></span></div>
    <div><i data-lucide="boxes"></i><span><strong>Map</strong><small>room, furniture, items</small></span></div>
    <div><i data-lucide="list-checks"></i><span><strong>Review</strong><small>accept, correct, reject</small></span></div>
  </div>`;
}

function renderContainerCapture(): string {
  const containers = store.containersView();
  return `<div class="capture-form-layout">
    <div>
      <div class="step-kicker">Focused refresh</div>
      <h3>Photograph one drawer, shelf, bag, or box.</h3>
      <p>Container snapshots are the practical scanning wedge: quick enough to repeat, specific enough to trust, and useful without a full room reconstruction.</p>
    </div>
    <div class="form-surface">
      <label><span>Container</span><select id="capture-container" data-draft="container-id">${containers.map((c) => `<option value="${esc(c.id)}" ${ui.captureDrafts.container.containerId === c.id ? "selected" : ""}>${esc(c.name)} · ${esc(c.kind)}</option>`).join("")}</select></label>
      <label><span>What can you see?</span><textarea id="capture-container-text" placeholder="charger, gym card, coins" maxlength="4000" data-draft="container-seen">${esc(ui.captureDrafts.container.seen)}</textarea><small>Comma-separated labels are matched to existing belongings · up to 100 labels.</small></label>
      <label class="upload-zone compact ${ui.captureMedia.container ? "has-media" : ""}">
        <input type="file" accept="image/*" capture="environment" data-role="capture-photo">
        ${ui.mediaPending.container ? `<i data-lucide="scan-search"></i><span role="status"><strong>Preparing photo…</strong><small>Proposal action is temporarily paused.</small></span>` : ui.captureMedia.container ? `<img src="${esc(ui.captureMedia.container.dataUrl)}" alt="Container photo preview"><span><strong>Photo attached</strong><small>Stored as evidence</small></span>` : `<i data-lucide="camera"></i><span><strong>Add photo evidence</strong><small>Optional, never auto-committed</small></span>`}
      </label>
      <button class="primary wide" data-action="capture-container-submit" ${containers.length && !ui.mediaPending.container ? "" : "disabled"}>${ui.mediaPending.container ? "Preparing photo…" : "Create review proposal"}</button>
    </div>
  </div>`;
}

function renderProductCapture(): string {
  const containers = store.containersView().filter((c) => c.kind !== "box");
  return `<div class="capture-form-layout product-intake">
    <div>
      <div class="step-kicker">Exact object prior</div>
      <h3>Add a product before the camera recognizes it.</h3>
      <p>Names, aliases, exact dimensions, and a default home give later scans something concrete to match instead of creating duplicates.</p>
      <div class="dimension-preview"><span class="dimension-box"></span><span><strong>Normalized in meters</strong><small>Input stays familiar in centimeters.</small></span></div>
    </div>
    <div class="form-surface">
      <div class="field-row"><label><span>Product name</span><input id="product-name" type="text" maxlength="200" placeholder="IKEA RÅSKOG trolley" value="${esc(ui.captureDrafts.product.name)}" data-draft="product-name"></label><label><span>Category / tags</span><input id="product-tags" type="text" maxlength="2048" placeholder="storage, trolley, metal" value="${esc(ui.captureDrafts.product.tags)}" data-draft="product-tags"></label></div>
      <div class="field-row dimensions">
        <label><span>Width</span><input id="product-width" type="number" min="1" placeholder="35" value="${esc(ui.captureDrafts.product.width)}" data-draft="product-width"><small>cm</small></label>
        <label><span>Depth</span><input id="product-depth" type="number" min="1" placeholder="45" value="${esc(ui.captureDrafts.product.depth)}" data-draft="product-depth"><small>cm</small></label>
        <label><span>Height</span><input id="product-height" type="number" min="1" placeholder="78" value="${esc(ui.captureDrafts.product.height)}" data-draft="product-height"><small>cm</small></label>
      </div>
      <label><span>Default home</span><select id="product-home" data-draft="product-home">${containers.map((c) => `<option value="${esc(c.id)}" ${ui.captureDrafts.product.defaultHome === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label><span>Source</span><select id="product-source" data-draft="product-source">${(["product", "manual", "scan"] as const).map((source) => `<option value="${source}" ${ui.captureDrafts.product.source === source ? "selected" : ""}>${source === "product" ? "Product page / packaging" : source === "manual" ? "Measured manually" : "Visual estimate"}</option>`).join("")}</select></label>
      <button class="primary wide" data-action="product-create" ${containers.length ? "" : "disabled"}>Add product to home memory</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------------- home

function renderAnswerCard(a: DeepReadonly<LocateAnswer> | null): string {
  if (!a) return "";
  if (!a.ok) {
    return `<div class="card answer-card uncertain" data-testid="answer-card">
      <div class="sentence">${esc(a.sentence)}</div>
      <div class="answer-actions"><button data-action="nav" data-view="belongings">Open belongings</button></div>
    </div>`;
  }
  const ev = a.evidence.slice(-3).reverse()
    .map((e) => `<li>${e.media ? `<img src="${esc(e.media.dataUrl)}" alt="evidence photo" style="height:34px;border-radius:6px;border:1px solid var(--line);vertical-align:middle;margin-right:6px">` : ""}${esc(e.summary)} <span class="faint">(${esc(e.kind.replace(/_/g, " "))}, ${daysLabel(daysBetween(e.at))})</span></li>`)
    .join("");
  return `<div class="card answer-card ${a.uncertain ? "uncertain" : ""}" data-testid="answer-card">
    <div class="sentence">${esc(a.sentence)}</div>
    <div class="answer-meta">
      <span>${confDot(a.confidence)}Confidence ${a.confidence.toFixed(2)} ${confBar(a.confidence)}</span>
      <span>Last updated: ${daysLabel(a.daysSinceUpdate)}</span>
      <span>Default home: ${esc(a.defaultHomeText || "—")} ${a.atDefaultHome ? '<span class="chip sage">at default</span>' : '<span class="chip amber">away</span>'}</span>
    </div>
    ${ev ? `<ul class="evidence-list">${ev}</ul>` : ""}
    <div class="muted" style="margin-top:8px">${esc(a.hint)}</div>
    <div class="answer-actions">
      <button data-action="answer-not-there" data-item="${esc(a.itemId)}" data-testid="btn-not-there">Not there</button>
      <button data-action="answer-show-plan">Show on plan</button>
      <button class="ghost" data-action="open-item" data-id="${esc(a.itemId)}">Open item</button>
    </div>
  </div>`;
}

function renderHome(): string {
  const attention = store.attention();
  const activationState = store.activation();
  const ops = store.operationsView().filter((o) => o.status === "active");
  const commits = store.commitsView(5);
  const pending = store.proposals("pending");
  const roomsCount = store.state.rooms.size;
  const compactHome = compactHomeQuery.matches;

  const setupBanner = mode === "own" && !activationState.complete ? `
    <div class="card activation-banner" data-testid="activation-banner">
      <div class="op-head"><h3>Finish setting up your home memory</h3><button data-action="nav" data-view="setup">Continue setup</button></div>
      ${activationChecklist()}
    </div>` : "";

  return `<section class="home-page" data-testid="view-home">
    ${setupBanner}
    ${renderAnswerCard(ui.lastAnswer)}
    <div class="home-priority-strip" aria-label="Current home priorities" data-testid="home-priorities">
      <button data-action="nav" data-view="review"><span class="signal-icon"><i data-lucide="list-checks"></i></span><span><strong>${pending.length}</strong><small>review decision${pending.length === 1 ? "" : "s"}</small></span><i data-lucide="chevron-right"></i></button>
      <button data-action="nav" data-view="operations"><span class="signal-icon"><i data-lucide="route"></i></span><span><strong>${ops.length}</strong><small>active operation${ops.length === 1 ? "" : "s"}</small></span><i data-lucide="chevron-right"></i></button>
      <button data-action="nav" data-view="spaces"><span class="signal-icon"><i data-lucide="history"></i></span><span><strong>${attention.staleContainers.length}</strong><small>stale container${attention.staleContainers.length === 1 ? "" : "s"}</small></span><i data-lucide="chevron-right"></i></button>
      <button data-action="focus-attention"><span class="signal-icon"><i data-lucide="circle-help"></i></span><span><strong>${attention.uncertainItems.length}</strong><small>uncertain item${attention.uncertainItems.length === 1 ? "" : "s"}</small></span><i data-lucide="chevron-right"></i></button>
    </div>
    <div class="home-cockpit" data-testid="home-memory-cockpit">
      <div class="memory-stage-copy">
        <div class="eyebrow"><span class="live-dot"></span> Home memory is online</div>
        <h2>Everything has a place.<br><em>Even when it moves.</em></h2>
        <p>Search belongings, inspect the evidence, and move through real-life operations without losing the thread of your home.</p>
        <div class="hero-search">
          <i data-lucide="search"></i>
          <input type="text" id="hero-search-input" placeholder="Water bottle, passport, winter coat…" data-enter="hero-locate" aria-label="Find a belonging">
          <button class="primary" data-action="hero-locate" data-testid="btn-hero-locate"><span>Locate</span><i data-lucide="arrow-up-right"></i></button>
        </div>
        <div class="quick-actions">
          <button data-action="nav" data-view="capture"><i data-lucide="scan-line"></i><span>Capture</span></button>
          <button data-action="start-op" data-template="gym"><i data-lucide="dumbbell"></i><span>Gym kit</span></button>
          <button data-action="nav" data-view="plan"><i data-lucide="cuboid"></i><span>Spatial view</span></button>
        </div>
      </div>
      ${compactHome ? `<button class="home-spatial-mobile" data-action="nav" data-view="plan" aria-label="Open the spatial view">
        <span><i data-lucide="cuboid"></i><strong>Spatial view</strong><small>Open the full 2D or 3D home model on demand.</small></span><i data-lucide="arrow-up-right"></i>
      </button>` : `<div class="memory-stage-visual" data-spatial-scene="home" aria-label="Interactive 3D home preview">
        <div class="scene-label"><span class="live-dot"></span> Spatial projection</div>
        <div class="scene-readout"><span>${roomsCount} rooms</span><span>${store.catalog.furniture.length} anchors</span><span>${store.containersView().length} containers</span></div>
        <button class="scene-open" data-action="nav" data-view="plan" aria-label="Open full spatial view" title="Open full spatial view"><i data-lucide="maximize-2"></i><span>Explore</span></button>
        <div class="scene-caption"><strong>Your home at a glance</strong><span>Orbit to inspect · your confirmed records stay in control</span></div>
      </div>`}
    </div>

    <div class="home-workspace">
      <div class="home-primary-column">
        <div class="section-heading"><span><small>In motion</small><strong>Active operations</strong></span><button class="ghost" data-action="nav" data-view="operations">View all <i data-lucide="arrow-right"></i></button></div>
        <div class="operation-stack">
          ${ops.length ? ops.map(opCard).join("") : `<div class="card empty-card"><i data-lucide="route"></i><span><strong>No active operation</strong><small>Start a move or prepare a recurring kit.</small></span><button data-action="nav" data-view="operations">Start one</button></div>`}
        </div>

        <div class="section-heading"><span><small>Memory health</small><strong>Needs attention</strong></span><span class="section-count">${attention.staleContainers.length + attention.uncertainItems.length}</span></div>
        <div class="card attention-surface" data-testid="attention-card" tabindex="-1">
          ${attention.staleContainers.slice(0, 4).map((c) => `
            <div class="attention-row">
              <span class="attention-icon stale"><i data-lucide="history"></i></span>
              <span class="grow"><strong>${esc(c.name)}</strong><small>Last confirmed ${daysLabel(c.daysSinceConfirmed)}</small></span>
              <button class="small" data-action="confirm-container" data-id="${esc(c.id)}">Confirm</button><button class="icon-button subtle" data-action="open-container" data-id="${esc(c.id)}" aria-label="Open ${esc(c.name)}"><i data-lucide="arrow-up-right"></i></button>
            </div>`).join("")}
          ${attention.uncertainItems.slice(0, 3).map((v) => `
            <div class="attention-row">
              <span class="attention-icon uncertain"><i data-lucide="circle-help"></i></span>
              <span class="grow"><strong>${esc(v.name)}</strong><small>${esc(v.chainText || "No trusted place")}</small></span>
              <button class="icon-button subtle" data-action="open-item" data-id="${esc(v.id)}" aria-label="Open ${esc(v.name)}"><i data-lucide="arrow-up-right"></i></button>
            </div>`).join("")}
          ${!attention.staleContainers.length && !attention.uncertainItems.length ? `<div class="empty-inline"><i data-lucide="badge-check"></i><span>Everything is fresh and confident.</span></div>` : ""}
        </div>
      </div>

      <aside class="home-side-column">
        <div class="review-spotlight">
          <div class="spotlight-head"><span class="spotlight-icon"><i data-lucide="list-checks"></i></span><span><small>Review inbox</small><strong>${pending.length} decision${pending.length === 1 ? "" : "s"} waiting</strong></span></div>
          ${pending.length ? pending.slice(0, 3).map((p, index) => `<button class="proposal-preview" data-action="nav" data-view="review"><span>${String(index + 1).padStart(2, "0")}</span><span><strong>${esc(p.type.replace(/_/g, " "))}</strong><small>${esc(p.summary)}</small></span><i data-lucide="chevron-right"></i></button>`).join("") : `<div class="empty-inline light"><i data-lucide="badge-check"></i><span>Inbox clear</span></div>`}
          <button class="spotlight-action" data-action="nav" data-view="review">Open Review <i data-lucide="arrow-up-right"></i></button>
        </div>

        <div class="activity-panel">
          <div class="section-heading"><span><small>Commit Ledger</small><strong>Recent changes</strong></span><button class="icon-button subtle" data-action="nav" data-view="ledger" aria-label="Open Commit Ledger"><i data-lucide="arrow-up-right"></i></button></div>
          <div class="activity-timeline">
            ${commits.map((c, index) => `<div class="activity-row"><span class="timeline-node ${index === 0 ? "active" : ""}"></span><span><strong>${esc(c.summary)}</strong><small>${daysLabel(daysBetween(c.at))} · ${c.ops.length} typed operation${c.ops.length === 1 ? "" : "s"}</small></span></div>`).join("") || `<div class="muted">No activity yet.</div>`}
          </div>
        </div>
      </aside>
    </div>
  </section>`;
}

function opCard(op: DeepReadonly<OperationView>): string {
  const chip = op.type === "move"
    ? `<span class="chip ${op.readiness.status === "ready" ? "sage" : "accent"}">${op.readiness.status === "ready" ? "all unpacked" : `${op.readiness.openBoxes ?? 0} open boxes`}</span>`
    : `<span class="chip ${op.readiness.status === "ready" ? "sage" : op.readiness.status === "missing_items" ? "red" : "amber"}">${op.readiness.status === "ready" ? "ready" : op.readiness.status === "missing_items" ? `missing ${op.readiness.missing}` : `review ${op.readiness.unresolved}`}</span>`;
  const sub = op.type === "move"
    ? `${op.boxes.length} boxes · ${op.packedCount} items packed`
    : `${op.rows.length} checklist rows`;
  return `<button type="button" class="card op-card" data-action="open-op" data-id="${esc(op.id)}" data-testid="op-card">
    <div class="op-head"><h3>${esc(op.name)}</h3>${chip}</div>
    <div class="sub">${esc(sub)}</div>
  </button>`;
}

// ----------------------------------------------------------------- spaces

function renderSpaces(): string {
  const rooms = [...store.state.rooms.values()];
  const containers = store.containersView();
  const byParent = new Map<string, ContainerView[]>();
  const boxes: ContainerView[] = [];
  for (const c of containers) {
    if (c.kind === "box") { boxes.push(c); continue; }
    const key = c.parent.type === "furniture" ? `furniture:${c.parent.id}` : `room:${c.parent.id}`;
    const list = byParent.get(key) ?? [];
    list.push(c);
    byParent.set(key, list);
  }

  if (!rooms.length) {
    return `<section data-testid="view-spaces">
      ${renderPageIntro({ eyebrow: "Rooms · containers · evidence", title: "Your home, from the inside out.", description: "Build memory around the places that actually hold your belongings." })}
      <div class="card muted">No rooms yet — describe your home in <button class="ghost" data-action="nav" data-view="setup">Setup</button>.</div>
    </section>`;
  }

  const roomSections = rooms.map((room) => {
    const furn = store.catalog.furniture.filter((f) => f.room === room.id);
    const groups = furn.map((f) => {
      const list = byParent.get(`furniture:${f.id}`) ?? [];
      if (!list.length) return "";
      return `<div class="furniture-group">
        <div class="fname">${esc(f.name)}</div>
        <div class="grid-cards">${list.map(containerCard).join("")}</div>
      </div>`;
    }).join("");
    const direct = byParent.get(`room:${room.id}`) ?? [];
    const directGroup = direct.length ? `<div class="furniture-group">
      <div class="fname">In this room</div>
      <div class="grid-cards">${direct.map(containerCard).join("")}</div>
    </div>` : "";
    const content = groups + directGroup;
    const roomContainerCount = direct.length + furn.reduce((sum, furniture) => sum + (byParent.get(`furniture:${furniture.id}`)?.length ?? 0), 0);
    return `<div class="room-section">
      <div class="room-heading"><span><small>Room</small><strong>${esc(room.name)}</strong></span><span>${roomContainerCount} container${roomContainerCount === 1 ? "" : "s"}</span></div>
      ${content || `<div class="card muted">No containers recorded here yet.</div>`}
    </div>`;
  }).join("");

  return `<section data-testid="view-spaces">
    ${renderPageIntro({
      eyebrow: "Rooms · containers · evidence",
      title: "Your home, from the inside out.",
      description: "Browse the containment chain behind every answer. Freshness belongs to the container, not to a decorative floor plan.",
      aside: renderPageMetrics([{ value: rooms.length, label: "rooms" }, { value: containers.length, label: "containers" }])
    })}
    ${roomSections}
    <div class="room-heading"><span><small>In motion</small><strong>Moving boxes</strong></span><span>${boxes.length} total</span></div>
    <div class="grid-cards">${boxes.map(containerCard).join("") || `<div class="card muted">No boxes yet.</div>`}</div>
  </section>`;
}

function containerCard(c: ContainerView): string {
  const fresh = c.stale
    ? `<span class="chip amber">stale · ${daysLabel(c.daysSinceConfirmed)}</span>`
    : `<span class="chip sage">confirmed ${daysLabel(c.daysSinceConfirmed)}</span>`;
  const boxChip = c.kind === "box" && c.boxStatus ? `<span class="chip accent">${esc(c.boxStatus)}</span>` : "";
  return `<button type="button" class="card container-card" data-action="open-container" data-id="${esc(c.id)}" data-testid="container-card">
    <div class="kind">${esc(c.kind)}</div>
    <div class="cname">${esc(c.name)}</div>
    <div class="meta"><span class="chip neutral">${c.itemCount} item${c.itemCount === 1 ? "" : "s"}</span>${fresh}${boxChip}</div>
  </button>`;
}

// ------------------------------------------------------------- belongings

interface ListPage<T> {
  rows: T[];
  start: number;
  end: number;
  total: number;
}

function listBounds(total: number, requestedOffset: number, size: number): Pick<ListPage<unknown>, "start" | "end" | "total"> {
  const lastStart = total ? Math.floor((total - 1) / size) * size : 0;
  const start = Math.min(lastStart, Math.max(0, Math.floor(requestedOffset / size) * size));
  return { start, end: Math.min(total, start + size), total };
}

function listPage<T>(rows: readonly T[], requestedOffset: number, size: number): ListPage<T> {
  const bounds = listBounds(rows.length, requestedOffset, size);
  return { rows: rows.slice(bounds.start, bounds.end), ...bounds };
}

function renderListPager(
  page: Pick<ListPage<unknown>, "start" | "end" | "total">,
  { noun, previousAction, nextAction, testId, newestFirst = false, size }: {
    noun: string;
    previousAction: string;
    nextAction: string;
    testId: string;
    newestFirst?: boolean;
    size: number;
  }
): string {
  const shownStart = page.total ? page.start + 1 : 0;
  const shownRange = page.total && shownStart !== page.end ? `${shownStart.toLocaleString()}–${page.end.toLocaleString()}` : page.end.toLocaleString();
  const previousCount = Math.min(size, page.start);
  const nextCount = Math.min(size, page.total - page.end);
  return `<div class="list-window-footer" data-testid="${testId}">
    <span role="status" aria-live="polite" aria-atomic="true">Showing <strong>${shownRange}</strong> of <strong>${page.total.toLocaleString()}</strong> ${noun}${newestFirst ? " · newest first" : ""}</span>
    <span class="list-window-actions">
      ${page.start > 0 ? `<button class="small ghost" data-action="${previousAction}" aria-label="Previous ${previousCount.toLocaleString()} ${noun}"><i data-lucide="chevron-left"></i> Previous</button>` : ""}
      ${page.end < page.total ? `<button class="small ghost" data-action="${nextAction}" aria-label="Next ${nextCount.toLocaleString()} ${noun}">Next <i data-lucide="chevron-right"></i></button>` : ""}
    </span>
  </div>`;
}

function visibleBelongings(): ReturnType<Store["searchBelongings"]> {
  return store.searchBelongings(ui.belongingsQuery)
    .filter((view) => !ui.stateFilter || view.state === ui.stateFilter);
}

function renderBelongingRows(rows: ReturnType<Store["searchBelongings"]>): string {
  return rows.map((v) => `
    <button type="button" class="row clickable" data-action="open-item" data-id="${esc(v.id)}" aria-label="${esc(v.name)}. ${esc(v.chainText || "No trusted place")}. State ${esc(STATE_CHIP[v.state][1])}. Confidence ${Math.round(v.confidence * 100)} percent. Updated ${esc(daysLabel(v.daysSinceUpdate))}. Open details.">
      <span class="belonging-mark"><i data-lucide="${v.state === "packed" ? "package" : v.state === "with_me" ? "backpack" : "package-search"}"></i></span>
      <div class="grow">
        <div class="name">${esc(v.name)} ${v.group ? '<span class="chip neutral">group</span>' : ""} ${v.importance === "essential" ? '<span class="chip red">essential</span>' : ""}</div>
        <div class="place">${esc(v.chainText || "no trusted place")}</div>
      </div>
      <span class="inventory-state">${stateChip(v.state)}</span>
      <span class="inventory-confidence" title="confidence">${confDot(v.confidence)}<span class="faint">${v.confidence.toFixed(2)}</span></span>
      <span class="inventory-freshness faint">${daysLabel(v.daysSinceUpdate)}</span>
      <i class="inventory-open" data-lucide="chevron-right"></i>
    </button>`).join("") || `<div class="muted">Nothing matches${mode === "own" ? " — add belongings in Setup" : ""}.</div>`;
}

function renderBelongingsWindow(rows: ReturnType<Store["searchBelongings"]>): string {
  const page = listPage(rows, ui.belongingsOffset, LIST_WINDOW_SIZE);
  ui.belongingsOffset = page.start;
  return `${renderBelongingRows(page.rows)}${renderListPager(page, {
    noun: "matching belongings",
    previousAction: "belongings-page-previous",
    nextAction: "belongings-page-next",
    testId: "belongings-window-status",
    size: LIST_WINDOW_SIZE
  })}`;
}

function renderBelongings(): string {
  const rows = visibleBelongings();
  const filters: Array<LifecycleState | ""> = ["", "at_home", "packed", "laundry", "with_me", "missing"];
  return `<section data-testid="view-belongings">
    ${renderPageIntro({
      eyebrow: "Ownership recall",
      title: "Know what you own—and where it went.",
      description: "A searchable inventory with current place, default home, freshness, state, and correction history kept separate.",
      aside: renderPageMetrics([{ value: store.searchBelongings("").length, label: "remembered" }, { value: rows.length, label: "visible", valueId: "belongings-visible-count" }])
    })}
    <div class="inventory-toolbar">
      <div class="inventory-search"><i data-lucide="search"></i><input type="text" id="belongings-search" aria-label="Filter belongings" placeholder="Filter belongings…" value="${esc(ui.belongingsQuery)}" data-input="belongings-query"></div>
      <div class="filter-pills" role="group" aria-label="Filter belongings by state">${filters.map((f) => `<button class="small ${ui.stateFilter === f ? "primary" : ""}" aria-pressed="${ui.stateFilter === f}" data-action="belongings-filter" data-state="${f}">${f ? STATE_CHIP[f][1] : "all"}</button>`).join("")}</div>
      <button class="primary icon-label" data-action="open-add-belonging" data-testid="btn-add-belonging"><i data-lucide="plus"></i><span>Add belonging</span></button>
    </div>
    <div class="card inventory-table">
      <div class="inventory-table-head"><span>Belonging</span><span>State</span><span>Confidence</span><span>Freshness</span></div>
      <div class="row-list" id="belongings-list" data-testid="belongings-list">
        ${renderBelongingsWindow(rows)}
      </div>
    </div>
  </section>`;
}

// ------------------------------------------------------------- operations

function renderOperations(): string {
  const ops = store.operationsView();
  const active = ops.filter((o) => o.status === "active");
  const done = ops.filter((o) => o.status !== "active");
  const open = ui.openOpId ? store.operationView(ui.openOpId) : null;
  const launchers = store.catalog.operationTemplates.filter((t) => t.id !== "cleaning").map((template) => {
    const presentation = OPERATION_LAUNCHERS[template.id] ?? { icon: "route", note: template.description };
    return `<button class="operation-launcher" data-action="start-op" data-template="${esc(template.id)}" data-testid="start-op-${esc(template.id)}">
      <span class="launcher-icon"><i data-lucide="${presentation.icon}"></i></span><span><strong>${esc(template.name)}</strong><small>${esc(presentation.note)}</small></span><i data-lucide="arrow-up-right"></i>
    </button>`;
  }).join("");

  return `<section data-testid="view-operations">
    ${renderPageIntro({
      eyebrow: "Memory in motion",
      title: "Put your home memory to work.",
      description: "Operations create the reason to capture, confirm, and reuse where things live—during a move and long after it.",
      aside: renderPageMetrics([{ value: active.length, label: "active" }, { value: done.length, label: "closed" }])
    })}
    <div class="operation-launch-grid">${launchers}</div>
    <div class="room-heading"><span><small>Current work</small><strong>Active operations</strong></span><span>${active.length} running</span></div>
    ${active.map(opCard).join("") || `<div class="card muted">No active operations.</div>`}
    ${open ? renderOpDetail(open) : ""}
    ${done.length ? `<div class="room-heading"><span><small>History</small><strong>Closed operations</strong></span><span>${done.length} total</span></div>${done.map((o) => `<div class="card muted">${esc(o.name)} · ${esc(o.status)}</div>`).join("")}` : ""}
  </section>`;
}

function renderOpDetail(op: DeepReadonly<OperationView>): string {
  return op.type === "move" ? renderMoveDetail(op) : renderKitDetail(op);
}

function renderKitDetail(op: Extract<DeepReadonly<OperationView>, { type: "kit" }>): string {
  const r = op.readiness;
  const readinessText = r.status === "ready" ? "Ready — everything required is found or packed."
    : r.status === "missing_items" ? `Missing ${r.missing} required item${r.missing > 1 ? "s" : ""}.`
    : `${r.unresolved} row${r.unresolved > 1 ? "s" : ""} still need review.`;
  const plan = store.retrievalPlan(op.id);
  return `<div class="card" data-testid="kit-detail">
    <div class="op-head"><h3>${esc(op.name)}</h3>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="readiness ${r.status === "ready" ? "chip sage" : r.status === "missing_items" ? "chip red" : "chip amber"}">${esc(r.status.replace(/_/g, " "))}</span>
        <button class="small" data-action="close-op-detail">Close</button>
        <button class="small danger" data-action="finish-op" data-id="${esc(op.id)}">Finish operation</button>
      </div>
    </div>
    <div class="sub">${esc(readinessText)}</div>
    <div class="row-list" style="margin-top:8px">
      ${op.rows.map((row) => `
        <div class="kit-row" data-testid="kit-row">
          <div class="grow">
            <div class="name">${esc(row.reqLabels.join(" + "))}
              ${row.mergedRequirement ? '<span class="chip blue">merged</span>' : ""}
              ${row.level === "optional" ? '<span class="chip neutral">optional</span>' : ""}
              ${row.sharedWith?.length ? '<span class="chip violet" title="also needed by another active kit">shared</span>' : ""}
            </div>
            <div class="place">${row.item ? esc(`${row.item.name} — ${row.item.chainText || row.item.state.replace("_", " ")}`) : "no matching belonging"}${row.note ? ` · <em>${esc(row.note)}</em>` : ""}</div>
          </div>
          ${rowChip(row.status)}
          <select aria-label="Status for ${esc(row.reqLabels.join(" and "))}" data-action="row-status" data-op="${esc(op.id)}" data-row="${esc(row.id)}">
            ${ROW_STATUSES.map((s) => `<option value="${s}" ${s === row.status ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`).join("")}
          </select>
          ${row.item ? `<button class="small ghost" data-action="locate-item" data-id="${esc(row.item.id)}">Locate</button>` : ""}
        </div>`).join("")}
    </div>

    <div class="section-title">Retrieval plan — grouped by pickup stop</div>
    <div class="card" style="box-shadow:none" data-testid="retrieval-plan">
      ${plan.map((g) => `
        <div class="priority-item">
          <span class="grow">
            <strong>${esc(g.label)}</strong>${g.needsReview ? ' <span class="chip amber">needs review</span>' : ""}
            <div class="place">${g.items.map((i) => esc(i.name)).join(" · ")}</div>
          </span>
          <span class="faint">${g.items.length} item${g.items.length === 1 ? "" : "s"}</span>
        </div>`).join("") || `<div class="muted">Nothing to fetch.</div>`}
    </div>
  </div>`;
}

function renderMoveDetail(op: Extract<DeepReadonly<OperationView>, { type: "move" }>): string {
  const priority = store.unpackPriority(op.id);
  const packable = store.searchBelongings("").filter((v) => v.state !== "packed");
  const boxResults = ui.boxQuery ? store.whichContainerHas(ui.boxQuery).filter((r) => r.isBox) : null;

  return `<div class="card" data-testid="move-detail">
    <div class="op-head"><h3>${esc(op.name)}</h3>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="chip accent">${op.boxes.length} boxes · ${op.packedCount} packed</span>
        <button class="small" data-action="close-op-detail">Close</button>
        <button class="small danger" data-action="finish-op" data-id="${esc(op.id)}">Finish operation</button>
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px">
      <input type="text" id="new-box-label" aria-label="New box label" placeholder="New box label…" maxlength="100" style="max-width:200px">
      <input type="text" id="new-box-dest" aria-label="New box destination" placeholder="Destination (e.g. New home · kitchen)" maxlength="200" style="max-width:260px">
      <button class="primary" data-action="create-box" data-op="${esc(op.id)}" data-testid="btn-create-box">Create box</button>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
      <input type="text" id="box-search-input" aria-label="Search belongings across moving boxes" placeholder="Which box has…?" style="max-width:260px" value="${esc(ui.boxQuery)}" data-enter="box-search">
      <button data-action="box-search" data-testid="btn-box-search">Search boxes</button>
    </div>
    ${boxResults ? `<div class="card" style="box-shadow:none" data-testid="box-search-results">
      ${boxResults.length ? boxResults.map((r) => `<div class="attention-row"><span class="grow"><strong>${esc(r.item)}</strong> → ${esc(r.container.name)} <span class="faint">(${esc(r.container.box?.destination ?? "")}, ${esc(r.boxStatus ?? "")})</span></span></div>`).join("") : `<div class="muted">No packed belonging matches “${esc(ui.boxQuery)}”.</div>`}
    </div>` : ""}

    <div class="grid-cards" style="margin-top:10px">
      ${op.boxes.map((box) => `
        <div class="card box-card" data-testid="box-card">
          <div class="box-head"><strong>${esc(box.box?.label ?? box.name)}</strong>
            <select aria-label="Status for ${esc(box.box?.label ?? box.name)}" data-action="box-status" data-box="${esc(box.id)}">
              ${BOX_STATUSES.map((s) => `<option value="${s}" ${s === box.boxStatus ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
          <div class="dest">→ ${esc(box.box?.destination ?? "unassigned")}</div>
          <ul>${box.contents.map((i) => `<li>${esc(i.name)} ${i.importance === "essential" ? '<span class="chip red">essential</span>' : ""} <button class="small ghost" data-action="unpack-item" data-item="${esc(i.id)}">unpack</button></li>`).join("") || "<li class='faint'>empty</li>"}</ul>
          <div class="box-actions">
            <select aria-label="Item to pack into ${esc(box.box?.label ?? box.name)}" data-role="assign-select" data-box="${esc(box.id)}">
              <option value="">Pack an item…</option>
              ${packable.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("")}
            </select>
            <button class="small" data-action="assign-box" data-box="${esc(box.id)}">Pack</button>
          </div>
        </div>`).join("")}
    </div>

    <div class="section-title">Unpack priority</div>
    <div class="card" style="box-shadow:none" data-testid="unpack-priority">
      ${priority.map((p, i) => `
        <div class="priority-item">
          <span class="priority-rank">${i + 1}</span>
          <span class="grow"><strong>${esc(p.box.box?.label ?? p.box.name)}</strong> → ${esc(p.box.box?.destination ?? "")}
            ${p.essentials.length ? `<span class="chip red">essentials: ${esc(p.essentials.join(", "))}</span>` : ""}
          </span>
          <span class="faint">${p.contents.length} items · ${esc(p.box.boxStatus ?? "")}</span>
        </div>`).join("") || `<div class="muted">No boxes waiting to unpack.</div>`}
    </div>
  </div>`;
}

// ----------------------------------------------------------------- review

interface ProposalDiff {
  subject: string;
  before: string;
  after: string;
}

function observationCopy(observation: ObservationRecord): string {
  const itemName = observation.itemId ? store.state.belongings.get(observation.itemId)?.name ?? observation.itemId : null;
  const containerName = observation.containerId ? store.state.containers.get(observation.containerId)?.name ?? observation.containerId : null;
  if (observation.type === "container_snapshot") {
    const seen = typeof observation.payload?.seenText === "string" ? observation.payload.seenText : "contents were recorded";
    return `You recorded “${seen}” in ${containerName ?? "a container"}.`;
  }
  if (observation.type === "not_there_report") return `You reported that ${itemName ?? "this belonging"} was not at its recorded place.`;
  if (observation.type === "duplicate_suspected") {
    const ids = Array.isArray(observation.payload?.itemIds) ? observation.payload.itemIds.filter((id): id is string => typeof id === "string") : [];
    const names = ids.map((id) => store.state.belongings.get(id)?.name ?? id);
    return names.length ? `${names.join(" and ")} may describe the same belonging.` : "Two belonging records may describe the same thing.";
  }
  if (observation.type === "stale_container_flag") return `${containerName ?? "This container"} has not been confirmed recently.`;
  return `A manual note was attached${itemName ? ` to ${itemName}` : ""}.`;
}

function proposalDiffs(proposal: DeepReadonly<ProposalView>, edit: ProposalReviewEdit | undefined): ProposalDiff[] {
  const diffs: ProposalDiff[] = [];
  for (const op of proposal.suggestedOps) {
    if (op.type === "create_placement") {
      const belonging = store.belongingView(op.itemId);
      const editedContainerId = edit?.placements[op.itemId];
      const afterPlace = editedContainerId ? { type: "container" as const, id: editedContainerId } : op.placeRef;
      diffs.push({
        subject: belonging?.name ?? op.itemId,
        before: belonging?.chainText || "No trusted place",
        after: afterPlace ? store.chainText(store.chainFor(afterPlace)) : "Choose the actual place"
      });
    } else if (op.type === "merge_belongings") {
      const keepId = edit?.mergeKeepId && [op.keepId, op.mergeId].includes(edit.mergeKeepId) ? edit.mergeKeepId : op.keepId;
      const mergeId = keepId === op.keepId ? op.mergeId : op.keepId;
      const keep = store.state.belongings.get(keepId)?.name ?? keepId;
      const merge = store.state.belongings.get(mergeId)?.name ?? mergeId;
      diffs.push({ subject: "Duplicate records", before: `${keep} + ${merge}`, after: `Keep ${keep}; merge ${merge}` });
    } else if (op.type === "confirm_container") {
      const container = store.containersView().find((candidate) => candidate.id === op.containerId);
      diffs.push({
        subject: container?.name ?? op.containerId,
        before: container?.daysSinceConfirmed === null || container?.daysSinceConfirmed === undefined ? "Never confirmed" : `Confirmed ${daysLabel(container.daysSinceConfirmed)}`,
        after: "Confirmed now"
      });
    } else if (op.type === "set_state") {
      const belonging = store.state.belongings.get(op.itemId);
      diffs.push({ subject: belonging?.name ?? op.itemId, before: store.lifecycleOf(op.itemId).replace(/_/g, " "), after: op.state.replace(/_/g, " ") });
    }
  }
  return diffs;
}

function renderObservationEvidence(observation: ObservationRecord): string {
  return `<div class="evidence-card">
    <div class="evidence-card-head"><span><i data-lucide="scan-search"></i><strong>${esc(observation.type.replace(/_/g, " "))}</strong></span><time datetime="${esc(observation.at)}">${daysLabel(daysBetween(observation.at))}</time></div>
    <p>${esc(observationCopy(observation))}</p>
    ${observation.photo ? `<img src="${esc(observation.photo.dataUrl)}" alt="Photo attached to this observation" data-testid="proposal-photo">` : ""}
    <details class="technical-details"><summary>Technical record</summary><code>${esc(observation.id)} · ${esc(JSON.stringify(observation.payload ?? {}))}</code></details>
  </div>`;
}

function renderReview(): string {
  const allPending = store.proposals("pending");
  const pendingPage = listPage(allPending, ui.reviewOffset, REVIEW_WINDOW_SIZE);
  ui.reviewOffset = pendingPage.start;
  const pending = pendingPage.rows;
  const resolved = store.proposals(null).filter((p) => p.status !== "pending");
  return `<section data-testid="view-review">
    ${renderPageIntro({
      eyebrow: "Human in the loop",
      title: "Nothing becomes truth behind your back.",
      description: "Inspect the evidence, understand the proposed change, then accept or reject it. Every decision remains traceable.",
      className: "review-intro",
      aside: `<div class="review-counter"><strong>${allPending.length}</strong><span>waiting for<br>your decision</span></div>`
    })}
    <div class="review-principle"><i data-lucide="shield-check"></i><span><strong>Review is the commit gate.</strong> Captures and scan suggestions remain proposals until you decide.</span><span class="flow-mini">Observe <i data-lucide="arrow-right"></i> Review <i data-lucide="arrow-right"></i> Commit</span></div>
    ${pending.map((p) => {
      const sourceObservations = p.sourceObservationIds
        .map((oid) => store.state.observations.find((observation) => observation.id === oid))
        .filter((observation): observation is ObservationRecord => !!observation);
      const edit = ui.proposalEdits[p.id];
      const diffs = proposalDiffs(p, edit);
      const placementOps = p.suggestedOps
        .filter((op): op is Extract<DeepReadonly<CommitOp>, { type: "create_placement" }> => op.type === "create_placement")
        .filter((op, index, all) => all.findIndex((candidate) => candidate.itemId === op.itemId) === index);
      const mergeOp = p.suggestedOps.find((op): op is Extract<DeepReadonly<CommitOp>, { type: "merge_belongings" }> => op.type === "merge_belongings");
      const destructive = p.suggestedOps.some((op) => op.type === "contradict_placement" || op.type === "merge_belongings");
      const inspectable = sourceObservations.length > 0;
      const mergeCandidates = mergeOp ? [mergeOp.keepId, mergeOp.mergeId].map((id) => store.belongingView(id)).filter((item): item is NonNullable<typeof item> => !!item) : [];
      const selectedMergeKeepId = edit?.mergeKeepId ?? mergeOp?.keepId;
      const placementEditors = placementOps.map((placementOp) => {
        const itemName = store.state.belongings.get(placementOp.itemId)?.name ?? "proposed belonging";
        const proposedContainerId = placementOp.placeRef?.type === "container" ? placementOp.placeRef.id : null;
        const selectedContainerId = edit?.placements[placementOp.itemId] ?? proposedContainerId;
        return `<label class="proposal-editor"><span>${p.needsPlace ? `Choose the actual place for ${esc(itemName)}` : `Destination for ${esc(itemName)}`}</span><select data-action="proposal-place-edit" data-role="proposal-place" data-proposal="${esc(p.id)}" data-item="${esc(placementOp.itemId)}" aria-label="Destination for ${esc(itemName)}">${p.needsPlace ? '<option value="">Choose a container…</option>' : ""}${containerOptions(selectedContainerId)}</select><small>${p.needsPlace ? "A location is required before this can be accepted." : "Change this destination before committing if the proposal is not quite right."}</small></label>`;
      }).join("");
      return `
      <div class="card proposal-card" data-testid="proposal-card" data-role="proposal-record" data-proposal="${esc(p.id)}" tabindex="-1" aria-label="Proposal: ${esc(p.summary)}">
        <div class="proposal-index"><span>${esc(p.type.replace(/_/g, " "))}</span><time datetime="${esc(p.at)}">proposed ${daysLabel(daysBetween(p.at))}</time></div>
        <div class="ptype">What Nestory noticed</div>
        <div class="psummary">${esc(p.summary)}</div>
        <div class="proposal-section-label">Evidence you can inspect</div>
        <div class="evidence-stack">${sourceObservations.map(renderObservationEvidence).join("") || `<div class="evidence-card missing"><i data-lucide="circle-help"></i><span>No source observation is attached to this proposal.</span></div>`}</div>
        ${diffs.length ? `<div class="proposal-section-label">Before and after</div><div class="proposal-diff">${diffs.map((diff) => `<div><strong>${esc(diff.subject)}</strong><span><small>Current</small>${esc(diff.before)}</span><i data-lucide="arrow-right"></i><span><small>Proposed</small>${esc(diff.after)}</span></div>`).join("")}</div>` : ""}
        ${placementEditors}
        ${mergeOp ? `<div class="proposal-section-label">Choose the record to keep</div><div class="duplicate-compare">${mergeCandidates.map((item) => `<div><strong>${esc(item.name)}</strong><span>${esc(item.chainText || "No trusted place")}</span><small>${esc(item.kinds.join(" · "))} · confidence ${item.confidence.toFixed(2)}</small></div>`).join("")}</div><label class="proposal-editor"><span>Surviving record</span><select data-action="proposal-survivor-edit" data-role="proposal-survivor" data-proposal="${esc(p.id)}" aria-label="Record to keep">${mergeCandidates.map((item) => `<option value="${esc(item.id)}" ${item.id === selectedMergeKeepId ? "selected" : ""}>Keep ${esc(item.name)}</option>`).join("")}</select><small>The other record will remain traceable in the Commit Ledger.</small></label>` : ""}
        <details class="technical-details proposal-technical"><summary>Technical proposal</summary><code>${esc(p.id)}</code><ul class="proposal-ops">${p.suggestedOps.map((op) => `<li>${esc(describeOp(op))}</li>`).join("")}</ul></details>
        ${destructive && !inspectable ? `<div class="proposal-blocked"><i data-lucide="shield-check"></i><span>This proposal changes or merges an existing record but has no inspectable source, so it cannot be accepted.</span></div>` : ""}
        <div class="proposal-actions">
          <button class="primary" data-action="accept-proposal" data-id="${esc(p.id)}" data-testid="btn-accept" ${destructive && !inspectable ? "disabled" : ""}>Accept selected version</button>
          <button data-action="reject-proposal" data-id="${esc(p.id)}" data-testid="btn-reject">Reject</button>
        </div>
      </div>`;
    }).join("") || `<div class="card review-empty" data-testid="review-empty"><span><strong>Inbox clear.</strong><small>Snapshots, “not there” reports, and merge suggestions will land here.</small></span><button data-action="nav" data-view="capture"><i data-lucide="scan-line"></i> Capture new evidence</button></div>`}
    ${allPending.length ? renderListPager(pendingPage, {
      noun: "waiting proposals",
      previousAction: "review-page-previous",
      nextAction: "review-page-next",
      testId: "review-window-status",
      size: REVIEW_WINDOW_SIZE
    }) : ""}
    ${resolved.length ? `<div class="room-heading"><span><small>Decision history</small><strong>Recently resolved</strong></span><span>${resolved.length} total</span></div><div class="resolved-list">${resolved.slice(-5).reverse().map((p) => `<div class="resolved-row ${p.status}"><span>${p.status === "accepted" ? "✓" : "×"}</span><strong>${esc(p.summary)}</strong><small>${esc(p.status)}</small></div>`).join("")}</div>` : ""}
  </section>`;
}

function describeOp(op: DeepReadonly<CommitOp>): string {
  const itemName = (id: string): string => store.state.belongings.get(id)?.name ?? id;
  const containerName = (id: string): string => store.state.containers.get(id)?.name ?? id;
  switch (op.type) {
    case "create_placement":
      return op.placeRef
        ? `Place ${itemName(op.itemId)} into ${op.placeRef.type === "container" ? containerName(op.placeRef.id) : op.placeRef.id}`
        : `Place ${itemName(op.itemId)} — you choose where`;
    case "contradict_placement": return `Mark old placement of ${itemName(op.itemId)} as contradicted (${op.reason ?? "correction"})`;
    case "merge_belongings": return `Merge ${itemName(op.mergeId)} into ${itemName(op.keepId)}`;
    case "confirm_container": return `Confirm contents freshness of ${containerName(op.containerId)}`;
    case "set_state": return `Set ${itemName(op.itemId)} state to ${op.state}`;
    default: return op.type.replace(/_/g, " ");
  }
}

// ------------------------------------------------------------------- plan

function planFurnitureSymbol(
  id: string,
  name: string,
  archetype: NonNullable<SpatialObject["archetype"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  S: number,
  px: (meters: number) => string
): string {
  const sx = Number(px(x)), sy = Number(px(y)), sw = w * S, sh = h * S;
  const cx = sx + sw / 2, cy = sy + sh / 2;
  const labelY = archetype === "desk" ? sy + sh - 7 : cy + 4;
  const label = `<text class="plan-object-label" x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${esc(name)}</text>`;
  const frame = `<rect class="plan-object-body" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${sw.toFixed(1)}" height="${sh.toFixed(1)}" rx="6"/>`;
  let detail = "";
  if (archetype === "bed") {
    detail = `<rect class="plan-linen" x="${(sx + sw * 0.07).toFixed(1)}" y="${(sy + sh * 0.06).toFixed(1)}" width="${(sw * 0.86).toFixed(1)}" height="${(sh * 0.88).toFixed(1)}" rx="7"/><rect class="plan-pillow" x="${(sx + sw * 0.14).toFixed(1)}" y="${(sy + sh * 0.12).toFixed(1)}" width="${(sw * 0.3).toFixed(1)}" height="${(sh * 0.2).toFixed(1)}" rx="6"/>`;
  } else if (archetype === "wardrobe") {
    detail = `<line x1="${cx.toFixed(1)}" y1="${(sy + 5).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(sy + sh - 5).toFixed(1)}"/><circle cx="${(cx - 4).toFixed(1)}" cy="${cy.toFixed(1)}" r="1.7"/><circle cx="${(cx + 4).toFixed(1)}" cy="${cy.toFixed(1)}" r="1.7"/>`;
  } else if (archetype === "desk") {
    const chairW = Math.min(sw * 0.36, 42), chairH = Math.min(sh * 0.42, 24);
    detail = `<rect class="plan-monitor" x="${(cx - sw * 0.16).toFixed(1)}" y="${(sy + sh * 0.14).toFixed(1)}" width="${(sw * 0.32).toFixed(1)}" height="${Math.max(7, sh * 0.2).toFixed(1)}" rx="2"/><rect class="plan-chair" x="${(cx - chairW / 2).toFixed(1)}" y="${(sy + sh + 8).toFixed(1)}" width="${chairW.toFixed(1)}" height="${chairH.toFixed(1)}" rx="7"/>`;
  } else if (archetype === "bookcase" || archetype === "rack") {
    detail = Array.from({ length: 3 }, (_, index) => `<line x1="${(sx + 5).toFixed(1)}" y1="${(sy + sh * (index + 1) / 4).toFixed(1)}" x2="${(sx + sw - 5).toFixed(1)}" y2="${(sy + sh * (index + 1) / 4).toFixed(1)}"/>`).join("");
  } else if (archetype === "nightstand") {
    detail = `<line x1="${(sx + 4).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(sx + sw - 4).toFixed(1)}" y2="${cy.toFixed(1)}"/>`;
  }
  const selected = ui.spatialSelectedId === id;
  const roomLabel = esc(name);
  return `<g class="plan-object plan-${archetype}${selected ? " selected" : ""}" data-plan-archetype="${archetype}" data-id="${esc(id)}" data-action="spatial-select" role="button" tabindex="0" aria-pressed="${selected}" aria-label="Inspect ${roomLabel}"><title>${roomLabel}</title>${frame}<g class="plan-object-detail">${detail}</g>${label}<rect class="plan-object-outline" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${sw.toFixed(1)}" height="${sh.toFixed(1)}" rx="6"/></g>`;
}

function renderPlan(): string {
  const rooms = [...store.state.rooms.values()];
  if (!rooms.length) {
    return `<section data-testid="view-plan">
      <div class="card muted">The plan draws itself as you add rooms in <button class="ghost" data-action="nav" data-view="setup">Setup</button>.</div>
    </section>`;
  }
  const S = 120, PAD = 14;
  const maxX = Math.max(...rooms.map((r) => r.plan.x + r.plan.w));
  const maxY = Math.max(...rooms.map((r) => r.plan.y + r.plan.h));
  const W = (maxX + 0.1) * S + PAD * 2, H = (maxY + 0.1) * S + PAD * 2;
  const px = (m: number): string => (m * S + PAD).toFixed(1);

  const roomRects = rooms.map((r) => `
    <rect class="plan-room" x="${px(r.plan.x)}" y="${px(r.plan.y)}" width="${r.plan.w * S}" height="${r.plan.h * S}" rx="10"/>`).join("");

  const furniture = store.catalog.furniture.map((f) => {
    const visual = FURNITURE_VISUALS[f.id] ?? DEFAULT_FURNITURE_VISUAL;
    return planFurnitureSymbol(f.id, f.name, visual.archetype ?? "block", f.plan.x, f.plan.y, f.plan.w, f.plan.h, S, px);
  }).join("");

  // Room labels render after furniture (with a paper halo) so they stay legible.
  const roomLabels = rooms.map((r) => `
    <text class="plan-room-label" x="${px(r.plan.x + 0.04)}" y="${(Number(px(r.plan.y)) - 1).toFixed(1)}">${esc(r.name)}</text>`).join("");

  const planBoxes = store.containersView().filter((c) => c.kind === "box");
  const boxes = planBoxes.map((c, i) => {
    const room = store.state.rooms.get(c.parent.id) ?? rooms[0];
    if (!room) return "";
    const bx = room.plan.x + room.plan.w - 0.55 - (i % 3) * 0.45;
    const by = room.plan.y + room.plan.h - 0.5 - Math.floor(i / 3) * 0.45;
    return `<g>
      <title>${esc(c.box?.label ?? c.name)}</title>
      <rect class="plan-box" x="${px(bx)}" y="${px(by)}" width="${0.38 * S}" height="${0.38 * S}" rx="4"/>
      <text class="plan-box-number" x="${px(bx + 0.19)}" y="${px(by + 0.23)}" text-anchor="middle">${i + 1}</text>
    </g>`;
  }).join("");

  const a = ui.lastAnswer;
  const pin = a?.ok && a.planPin ? `
    <g data-testid="plan-pin">
      <circle class="plan-pin-ring" cx="${px(a.planPin.x)}" cy="${px(a.planPin.y)}" r="${(0.16 + (1 - a.confidence) * 0.3) * S}"/>
      <circle class="plan-pin" cx="${px(a.planPin.x)}" cy="${px(a.planPin.y)}" r="7"/>
      <text class="plan-pin-label" x="${px(a.planPin.x + 0.12)}" y="${px(a.planPin.y - 0.1)}">${esc(a.item)} · ${a.confidence.toFixed(2)}</text>
    </g>` : "";

  const roomArea = rooms.reduce((sum, room) => sum + room.plan.w * room.plan.h, 0);
  const selectedFurniture = store.catalog.furniture.find((item) => item.id === ui.spatialSelectedId) ?? null;
  const selectedRoom = selectedFurniture ? store.state.rooms.get(selectedFurniture.room) : null;
  return `<section data-testid="view-plan">
    <div class="spatial-head">
      <div><div class="eyebrow">A warm, inspectable model of home</div><h2>Spatial memory</h2><p>Move through a furnished home in 3D, or switch to an architectural plan for exact footprints. Both stay read-only projections of confirmed Home Memory.</p></div>
      <div class="segmented compact" role="group" aria-label="Spatial view">
        <button type="button" aria-pressed="${ui.planMode === "2d"}" class="${ui.planMode === "2d" ? "active" : ""}" data-action="plan-mode" data-mode="2d"><i data-lucide="map"></i>2D plan</button>
        <button type="button" aria-pressed="${ui.planMode === "3d"}" class="${ui.planMode === "3d" ? "active" : ""}" data-action="plan-mode" data-mode="3d"><i data-lucide="cuboid"></i>3D home</button>
      </div>
    </div>
    ${a && !a.ok ? `<div class="card answer-card uncertain plan-query-status" data-testid="plan-query-status"><div class="sentence">${esc(a.sentence)}</div><div class="answer-actions"><button data-action="nav" data-view="belongings">Search belongings</button></div></div>` : ""}
    ${ui.planMode === "3d" ? `<div class="spatial-workspace">
      <div class="spatial-canvas" data-spatial-scene="home" data-testid="plan-3d" aria-label="Interactive 3D home">
        <div class="spatial-canvas-chrome">
          <div class="scene-label"><span class="live-dot"></span> Live spatial projection</div>
          <div class="spatial-preset-bar" role="group" aria-label="Camera view">
            ${(["home", "study", "top"] as const).map((preset) => `<button type="button" data-action="spatial-preset" data-preset="${preset}" aria-pressed="${ui.spatialPreset === preset}">${preset === "home" ? "Whole home" : preset === "study" ? "Study corner" : "Top view"}</button>`).join("")}
            <button type="button" class="xray-toggle" data-action="spatial-xray" aria-pressed="${ui.spatialXray}" title="See through walls"><i data-lucide="scan-search"></i>X-ray</button>
          </div>
        </div>
        <div class="spatial-hint"><span>Drag to orbit</span><span>Scroll to zoom</span><span>Click to inspect · double-click to focus</span></div>
      </div>
      <aside class="spatial-inspector">
        <div class="step-kicker">Inspect the room</div>
        <h3 data-spatial-selection-title>${esc(selectedFurniture?.name ?? "Choose an anchor")}</h3>
        <p data-spatial-selection-detail aria-live="polite">${esc(selectedRoom?.name ?? "Select a furniture anchor to inspect it.")}</p>
        <div class="spatial-anchor-list" role="list" aria-label="Furniture anchors">
          ${store.catalog.furniture.map((item) => {
            const room = store.state.rooms.get(item.room);
            const visual = FURNITURE_VISUALS[item.id] ?? DEFAULT_FURNITURE_VISUAL;
            return `<button type="button" role="listitem" data-action="spatial-select" data-id="${esc(item.id)}" aria-pressed="${ui.spatialSelectedId === item.id}"><span class="spatial-anchor-icon ${visual.archetype}"></span><span><strong>${esc(item.name)}</strong><small>${esc(room?.name ?? "Home")} · ${item.plan.w.toFixed(1)} × ${item.plan.h.toFixed(1)} m</small></span><i data-lucide="chevron-right"></i></button>`;
          }).join("")}
        </div>
        <div class="metric-stack"><div><strong>${roomArea.toFixed(1)} m²</strong><span>mapped footprint</span></div><div><strong>${store.containersView().length}</strong><span>containers</span></div><div><strong>${store.searchBelongings("").length}</strong><span>belongings</span></div></div>
        ${a?.ok ? `<div class="located-summary"><i data-lucide="map-pin"></i><span><strong>${esc(a.item)}</strong><small>${esc(a.chainText)} · confidence ${a.confidence.toFixed(2)}</small></span></div>` : a ? `<div class="located-summary uncertain"><i data-lucide="circle-help"></i><span><strong>No trusted match</strong><small>${esc(a.sentence)}</small></span></div>` : `<div class="located-summary muted"><i data-lucide="search"></i><span>Locate an item to reveal its confidence halo.</span></div>`}
        <div class="layer-list" role="group" aria-label="Scene layers">
          ${([["furniture", "Confirmed furniture"], ["boxes", "Moving boxes"], ["proposals", "Proposals"], ["pin", "Located memory"]] as const).map(([key, label]) =>
            `<button type="button" class="layer-toggle" data-action="spatial-layer" data-layer="${key}" aria-pressed="${ui.spatialLayers[key]}"><i class="layer ${key === "boxes" ? "box" : key === "pin" ? "memory" : key}"></i>${label}</button>`).join("")}
        </div>
        <button data-action="nav" data-view="capture"><i data-lucide="scan-line"></i> Start a visual scan</button>
      </aside>
    </div>` : `<div class="plan-wrap">
      <div class="plan-scroll" tabindex="0" aria-label="Scrollable 2D floor plan">
        <svg class="plan-svg" viewBox="0 0 ${W} ${H}" data-testid="plan-svg" role="img" aria-label="2D floor plan">
          ${roomRects}${furniture}${roomLabels}${boxes}${pin}
        </svg>
      </div>
      <div class="plan-legend">
        <span>▭ room</span><span>▤ recognizable furniture</span><span class="accent-text">▣ moving box</span>
        ${a?.ok ? `<span class="accent-text">● ${esc(a.item)} — ring size shows uncertainty</span>` : `<span>Locate something to drop a pin.</span>`}
      </div>
      ${planBoxes.length ? `<div class="plan-box-actions" aria-label="Moving boxes on this plan">${planBoxes.map((box, index) => `<button class="small" data-action="open-container" data-id="${esc(box.id)}">${index + 1}. Open ${esc(box.box?.label ?? box.name)}</button>`).join("")}</div>` : ""}
    </div>`}
    <div class="trust-note"><i data-lucide="shield-check"></i><span><strong>The map never edits your memory on its own.</strong> A scan can suggest a position or size, but only Review can confirm where something belongs.</span></div>
  </section>`;
}

// ----------------------------------------------------------------- ledger

function renderLedger(): string {
  const totalCommits = store.state.commits.length;
  const commitBounds = listBounds(totalCommits, ui.ledgerOffset, LIST_WINDOW_SIZE);
  ui.ledgerOffset = commitBounds.start;
  const commits = store.commitsView(commitBounds.end).slice(commitBounds.start);
  const commitPage: ListPage<(typeof commits)[number]> = { rows: commits, ...commitBounds };
  return `<section data-testid="view-ledger">
    ${renderPageIntro({
      eyebrow: "Commit history",
      title: "Every change leaves a trace.",
      description: "Corrections preserve old placements instead of silently overwriting them. Export, import, reset, or inspect the record set behind your current home memory.",
      aside: renderPageMetrics([{ value: totalCommits, label: "commits" }, { value: store.recordCount, label: "records" }])
    })}
    <div class="ledger-toolbar">
      <div><span class="chip ${mode === "own" ? "accent" : "neutral"}">${mode === "own" ? "your home" : "demo residence"}</span><span class="ledger-health"><span class="live-dot"></span> local record set loaded</span></div>
      <div class="ledger-actions">
        <button data-action="ledger-export" data-testid="btn-export">Export JSON</button>
        <button data-action="ledger-import">Import JSON</button>
        <input type="file" id="import-file" accept="application/json" style="display:none">
        <button class="danger" data-action="ledger-reset" data-testid="btn-reset">Reset this home</button>
        ${mode === "own"
          ? `<button data-action="mode-switch" data-mode="demo" data-testid="btn-switch-demo">Switch to demo home</button>`
          : `<button data-action="mode-switch" data-mode="own" data-testid="btn-switch-own">Start my own home</button>`}
      </div></div>
    <div class="card ledger-surface">
      ${commits.map((c) => `
        <div class="commit-row" data-testid="commit-row" data-role="commit-record" data-id="${esc(c.id)}" tabindex="-1" aria-label="Commit: ${esc(c.summary)}">
          <div class="commit-time"><strong>${daysLabel(daysBetween(c.at))}</strong><small>${esc(new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</small></div>
          <div class="commit-body"><div class="csummary">${esc(c.summary)}</div><div class="faint">${esc(c.id)}${c.sourceProposalId ? ` · from ${esc(c.sourceProposalId)}` : ""}</div><div class="cops">${c.ops.map((op) => `<span class="op-badge">${esc(op.type)}</span>`).join("")}</div></div>
        </div>`).join("") || `<div class="muted">No commits yet — everything you do lands here.</div>`}
      ${renderListPager(commitPage, {
        noun: "commits",
        previousAction: "ledger-page-previous",
        nextAction: "ledger-page-next",
        testId: "ledger-window-status",
        newestFirst: true,
        size: LIST_WINDOW_SIZE
      })}
    </div>
  </section>`;
}

// ----------------------------------------------------------------- modals

function renderModal(): string {
  if (!ui.modal) return "";
  if (ui.modal.type === "mobile-nav") return mobileNavModal();
  if (ui.modal.type === "container") return containerModal(ui.modal.id);
  if (ui.modal.type === "item") return itemModal(ui.modal.id);
  return addBelongingModal();
}

function mobileNavModal(): string {
  const secondary = visibleViews().filter((view) => !MOBILE_PRIMARY_VIEWS.includes(view.id));
  return `<div class="modal-overlay mobile-nav-overlay" data-action="close-modal-overlay">
    <div class="modal mobile-nav-modal" id="mobile-nav-dialog" role="dialog" aria-modal="true" aria-labelledby="mobile-nav-title" tabindex="-1">
      <div class="modal-head">
        <div><div class="eyebrow">All sections</div><h3 id="mobile-nav-title">Go deeper</h3></div>
        <button class="close" data-action="close-modal" aria-label="Close more sections">✕</button>
      </div>
      <div class="mobile-nav-grid">
        ${secondary.map((view) => `<button class="mobile-nav-link ${ui.view === view.id ? "active" : ""}" data-action="nav" data-view="${view.id}" data-testid="mobile-nav-${view.id}" ${ui.view === view.id ? 'aria-current="page"' : ""}>
          <span class="icon"><i data-lucide="${view.icon}"></i></span><span><strong>${esc(view.label)}</strong><small>${view.group === "workflows" ? "Workflow" : view.group === "system" ? "Spatial & history" : "Home memory"}</small></span><i data-lucide="chevron-right"></i>
        </button>`).join("")}
      </div>
    </div>
  </div>`;
}

function visibleContainerItems(id: string): NonNullable<ReturnType<Store["containerContents"]>>["items"] {
  const contents = store.containerContents(id);
  if (!contents) return [];
  const query = ui.containerItemsQuery.trim().toLowerCase();
  if (!query) return contents.items;
  return contents.items.filter((item) =>
    item.name.toLowerCase().includes(query)
    || item.kinds.some((kind) => kind.toLowerCase().includes(query))
    || item.state.replace(/_/g, " ").includes(query)
  );
}

function renderContainerItemsWindow(id: string, isBox: boolean): string {
  const rows = visibleContainerItems(id);
  const page = listPage(rows, ui.containerItemsOffset, LIST_WINDOW_SIZE);
  ui.containerItemsOffset = page.start;
  const contents = page.rows.map((item) => `
    <div class="row" data-testid="container-item-row">
      <div class="grow"><div class="name">${esc(item.name)}</div><div class="place">default: ${esc(item.defaultHomeText)}</div></div>
      ${stateChip(item.state)}
      <button class="small ghost" data-action="locate-item" data-id="${esc(item.id)}">Locate</button>
      ${isBox ? `<button class="small" data-action="unpack-item" data-item="${esc(item.id)}">Unpack</button>` : ""}
    </div>`).join("") || `<div class="muted">${ui.containerItemsQuery ? "Nothing matches this filter." : "No recorded contents."}</div>`;
  return `${contents}${renderListPager(page, {
    noun: "matching contents",
    previousAction: "container-items-page-previous",
    nextAction: "container-items-page-next",
    testId: "container-items-window-status",
    size: LIST_WINDOW_SIZE
  })}`;
}

function containerModal(id: string): string {
  const cc = store.containerContents(id);
  if (!cc) { ui.modal = null; return ""; }
  const c = cc.container;
  const isBox = c.kind === "box";
  const boxStatus = c.boxStatus;
  return `<div class="modal-overlay" data-action="close-modal-overlay">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="container-modal-title" tabindex="-1" data-testid="container-modal">
      <div class="modal-head">
        <div>
          <h3 id="container-modal-title">${esc(c.name)}</h3>
          <div class="muted">${esc(c.kind)}${isBox && c.box?.destination ? ` → ${esc(c.box.destination)}` : ""} · ${cc.stale ? `<span class="chip amber">stale · confirmed ${daysLabel(cc.daysSinceConfirmed)}</span>` : `<span class="chip sage">confirmed ${daysLabel(cc.daysSinceConfirmed)}</span>`}</div>
        </div>
        <button class="close" data-action="close-modal" aria-label="Close ${esc(c.name)} details">✕</button>
      </div>
      ${cc.unknownNote ? `<div class="card" style="box-shadow:none;border-color:var(--amber);background:var(--amber-soft);margin-bottom:10px"><span class="muted" style="color:var(--amber)">${esc(cc.unknownNote)}</span></div>` : ""}
      <div class="container-items-toolbar">
        <label for="container-items-query">Filter ${cc.items.length.toLocaleString()} recorded contents</label>
        <div class="inventory-search"><i data-lucide="search"></i><input id="container-items-query" type="search" value="${esc(ui.containerItemsQuery)}" data-input="container-items-query" placeholder="Name, kind, or state…"></div>
      </div>
      <div class="row-list container-items-window" id="container-items-window">
        ${renderContainerItemsWindow(c.id, isBox)}
      </div>
      <div style="margin-top:14px">
        <label class="faint" for="snapshot-text" style="display:block;margin-bottom:4px">Container snapshot — type what you can see (comma-separated). It becomes a reviewable proposal, not truth.</label>
        <textarea id="snapshot-text" placeholder="e.g. charger, gym card, coins" maxlength="4000" data-testid="snapshot-input" data-draft="snapshot-text" data-container="${esc(c.id)}">${esc(ui.captureDrafts.snapshots[c.id] ?? "")}</textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
          <input type="file" id="snapshot-photo" accept="image/*" aria-label="Optional container snapshot photo" data-role="snapshot-photo" style="max-width:230px">
          ${ui.pendingSnapshotPhoto
            ? `<img src="${esc(ui.pendingSnapshotPhoto.dataUrl)}" alt="snapshot preview" data-testid="snapshot-photo-preview" style="height:48px;border-radius:8px;border:1px solid var(--line)"><button class="small ghost" data-action="clear-snapshot-photo">remove photo</button>`
            : `<span class="faint">optional photo — stored as evidence, never auto-recognized</span>`}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="primary" data-action="snapshot-submit" data-id="${esc(c.id)}" data-testid="btn-snapshot" ${ui.mediaPending.snapshot ? "disabled" : ""}>${ui.mediaPending.snapshot ? "Preparing photo…" : "Create snapshot proposal"}</button>
          <button data-action="confirm-container" data-id="${esc(c.id)}">Contents match — confirm</button>
          ${isBox ? `<select aria-label="Status for ${esc(c.name)}" data-action="box-status" data-box="${esc(c.id)}">${BOX_STATUSES.map((s) => `<option value="${s}" ${s === boxStatus ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}
        </div>
      </div>
    </div>
  </div>`;
}

function itemModal(id: string): string {
  const v = store.belongingView(id);
  if (!v) { ui.modal = null; return ""; }
  const evidence = (v.placement?.evidenceIds ?? [])
    .map((eid) => store.state.evidence.get(eid))
    .filter((e): e is NonNullable<typeof e> => !!e);
  return `<div class="modal-overlay" data-action="close-modal-overlay">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="item-modal-title" tabindex="-1" data-testid="item-modal">
      <div class="modal-head">
        <div><h3 id="item-modal-title">${esc(v.name)}</h3><div class="muted">${v.kinds.map((k) => `<span class="chip neutral">${esc(k)}</span>`).join(" ")}</div></div>
        <button class="close" data-action="close-modal" aria-label="Close ${esc(v.name)} details">✕</button>
      </div>
      <div class="answer-meta">
        <span>${stateChip(v.state)}</span>
        <span>${confDot(v.confidence)}confidence ${v.confidence.toFixed(2)}</span>
        <span>updated ${daysLabel(v.daysSinceUpdate)}</span>
      </div>
      <div class="muted" style="margin:6px 0"><strong>Current:</strong> ${esc(v.chainText || "no trusted place")} ${v.atDefaultHome ? '<span class="chip sage">at default</span>' : ""}</div>
      <div class="muted" style="margin:6px 0"><strong>Default home:</strong> ${esc(v.defaultHomeText || "—")}</div>
      ${v.dimensions ? `<div class="dimension-readout"><i data-lucide="ruler"></i><span><strong>${Math.round(v.dimensions.width * 100)} × ${Math.round(v.dimensions.depth * 100)} × ${Math.round(v.dimensions.height * 100)} cm</strong><small>${esc(v.dimensions.source)} dimensions · ${v.dimensions.verified ? "verified" : "needs verification"}</small></span></div>` : ""}
      ${evidence.length ? `<ul class="evidence-list">${evidence.map((e) => `<li>${e.media ? `<img src="${esc(e.media.dataUrl)}" alt="evidence photo" style="height:34px;border-radius:6px;border:1px solid var(--line);vertical-align:middle;margin-right:6px">` : ""}${esc(e.summary)} <span class="faint">(${esc(e.kind.replace(/_/g, " "))})</span></li>`).join("")}</ul>` : ""}
      <div class="section-title">Actions</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button data-action="answer-not-there" data-item="${esc(v.id)}">Not there</button>
        <select aria-label="Move ${esc(v.name)} to" data-role="move-select" data-item="${esc(v.id)}">${containerOptions(v.placement?.placeRef.id ?? null)}</select>
        <button data-action="item-move" data-id="${esc(v.id)}" data-testid="btn-move-item">Move here</button>
        <select aria-label="State for ${esc(v.name)}" data-action="item-state" data-id="${esc(v.id)}">${LIFECYCLE_STATES.map((s) => `<option value="${s}" ${s === v.state ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`).join("")}</select>
      </div>
      <div class="section-title">Placement history</div>
      <div class="row-list">
        ${[...v.history].reverse().map((h) => `
          <div class="row">
            <div class="grow">
              <div class="place">${esc(store.chainText(store.chainFor(h.placeRef)))}</div>
              <div class="faint">${daysLabel(daysBetween(h.at))} · conf ${h.confidence.toFixed(2)}${h.contradictedAt ? ` · <span style="color:var(--red)">contradicted (${esc(h.contradictedReason ?? "")})</span>` : h.supersededAt ? " · superseded" : ' · <span style="color:var(--sage)">active</span>'}</div>
            </div>
          </div>`).join("") || `<div class="muted">No placement history.</div>`}
      </div>
    </div>
  </div>`;
}

function addBelongingModal(): string {
  return `<div class="modal-overlay" data-action="close-modal-overlay">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-belonging-modal-title" tabindex="-1" data-testid="add-belonging-modal">
      <div class="modal-head"><h3 id="add-belonging-modal-title">Add belonging</h3><button class="close" data-action="close-modal" aria-label="Close add belonging">✕</button></div>
      <div class="form-grid">
        <div class="full"><label for="nb-name">Name</label><input type="text" id="nb-name" maxlength="200" placeholder="e.g. Kindle"></div>
        <div><label for="nb-kinds">Kinds / tags (comma)</label><input type="text" id="nb-kinds" placeholder="e-reader, electronics"></div>
        <div><label for="nb-importance">Importance</label><select id="nb-importance" style="width:100%"><option value="normal">normal</option><option value="high">high</option><option value="essential">essential</option></select></div>
        <div><label for="nb-default">Default home</label><select id="nb-default" style="width:100%">${containerOptions(null, { includeBoxes: false })}</select></div>
        <div><label for="nb-current">Current place</label><select id="nb-current" style="width:100%"><option value="">same as default</option>${containerOptions(null)}</select></div>
        <div class="full"><span class="field-label">Dimensions in cm (optional)</span><div class="field-row dimensions"><input type="number" id="nb-width" aria-label="Width in centimeters" min="1" placeholder="width"><input type="number" id="nb-depth" aria-label="Depth in centimeters" min="1" placeholder="depth"><input type="number" id="nb-height" aria-label="Height in centimeters" min="1" placeholder="height"></div></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="primary" data-action="add-belonging-submit" data-testid="btn-add-belonging-submit">Add to home memory</button>
        <button data-action="close-modal">Cancel</button>
      </div>
    </div>
  </div>`;
}

// ----------------------------------------------------------------- events

function isViewId(v: string | undefined): v is ViewId {
  return VIEWS.some((view) => view.id === v);
}

function navigate(view: ViewId, { focus = true, cancelMedia = true }: { focus?: boolean; cancelMedia?: boolean } = {}): void {
  if (cancelMedia) {
    snapshotPhotoReadToken += 1;
    scanMediaReadToken += 1;
    ui.mediaPending = { room: false, container: false, snapshot: false };
  }
  ui.view = view;
  ui.modal = null;
  ui.pendingSnapshotPhoto = null;
  modalReturnFocus = null;
  controlReturnFocus = null;
  focusModalOnRender = false;
  focusViewOnRender = focus;
  render();
}

function doLocate(query: string, returnFocusId: string): void {
  if (!query.trim()) return;
  const answer = setLocateAnswer(store.locate(query.trim()));
  if (ui.view !== "home" && ui.view !== "plan") {
    navigate("home");
  } else {
    controlReturnFocus = { elementId: returnFocusId, dataset: {} };
    render();
  }
  announce(answer.sentence);
}

document.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const t = target?.closest<HTMLElement>("[data-action]");
  if (!t) return;
  const action = t.dataset.action;

  switch (action) {
    case "choose-mode": {
      const m = t.dataset.mode;
      if (m === "demo" || m === "own") chooseMode(m);
      break;
    }
    case "mode-switch": {
      const m = t.dataset.mode;
      if ((m === "demo" || m === "own") && window.confirm(`Switch to the ${m === "demo" ? "demo" : "your own"} home? Each mode keeps its own records.`)) {
        chooseMode(m);
      }
      break;
    }
    case "nav": if (isViewId(t.dataset.view)) navigate(t.dataset.view); break;
    case "open-mobile-nav": rememberModalTrigger(t); focusViewOnRender = false; focusModalOnRender = true; ui.modal = { type: "mobile-nav" }; render(); break;
    case "capture-mode": {
      const next = t.dataset.mode;
      if (next === "room" || next === "container" || next === "product") {
        scanMediaReadToken += 1;
        ui.mediaPending.room = false;
        ui.mediaPending.container = false;
        ui.captureMode = next;
        controlReturnFocus = focusBookmark(t);
        render();
      }
      break;
    }
    case "plan-mode": {
      const next = t.dataset.mode;
      if (next === "2d" || next === "3d") { ui.planMode = next; controlReturnFocus = focusBookmark(t); render(); }
      break;
    }
    case "spatial-preset": {
      const preset = t.dataset.preset;
      if (preset === "home" || preset === "study" || preset === "top") {
        ui.spatialPreset = preset;
        dispatchSpatialCommand({ type: "preset", preset });
      }
      break;
    }
    case "spatial-select": {
      const id = t.dataset.id;
      // State-first: update selection + DOM directly so it works in 2D mode and
      // when no live 3D surface exists; also drive the scene when it is mounted.
      if (id) applySpatialSelection(id, { dispatchToScene: true });
      break;
    }
    case "spatial-layer": {
      const layer = t.dataset.layer;
      if (layer === "furniture" || layer === "boxes" || layer === "proposals" || layer === "pin") {
        ui.spatialLayers[layer] = !ui.spatialLayers[layer];
        t.setAttribute("aria-pressed", String(ui.spatialLayers[layer]));
        dispatchSpatialCommand({ type: "layer", layer, visible: ui.spatialLayers[layer] });
      }
      break;
    }
    case "spatial-xray": {
      ui.spatialXray = !ui.spatialXray;
      t.setAttribute("aria-pressed", String(ui.spatialXray));
      dispatchSpatialCommand({ type: "xray", on: ui.spatialXray });
      break;
    }
    case "run-room-scan": {
      if (ui.mediaPending.room) { toast("The selected photo is still being prepared.", { tone: "info" }); break; }
      controlReturnFocus = focusBookmark(t);
      ui.scanDraft = buildScanDraft(Math.max(20, inputNumber("scan-anchor") || 140));
      toast("Visual draft ready — inspect every candidate before Review.");
      render();
      break;
    }
    case "scan-decision": {
      const decision = t.dataset.decision;
      const proposal = ui.scanDraft?.proposals.find((p) => p.id === t.dataset.id);
      if (proposal && (decision === "accepted" || decision === "rejected")) {
        controlReturnFocus = focusBookmark(t);
        proposal.decision = proposal.decision === decision ? "pending" : decision;
        proposal.object.proposalState = proposal.decision;
        render();
      }
      break;
    }
    case "scan-send-review": {
      if (ui.mediaPending.room) { toast("The selected photo is still being prepared.", { tone: "info" }); break; }
      const containerId = inputValue("scan-target-container");
      const labels = ui.scanDraft?.proposals.filter((p) => p.kind === "item" && p.decision === "accepted").map((p) => p.label.split(" · ")[0]) ?? [];
      if (!containerId || !labels.length) { toast("Accept at least one item candidate first."); break; }
      const out = act(() => store.snapshotContainer(containerId, labels.join(", "), ui.captureMedia.room), "Scan observations sent to Review — memory is unchanged until acceptance.", { view: "review" });
      if (out) { ui.captureMedia.room = null; navigate("review"); }
      break;
    }
    case "capture-container-submit": {
      if (ui.mediaPending.container) { toast("The selected photo is still being prepared.", { tone: "info" }); break; }
      const containerId = inputValue("capture-container");
      const seen = inputValue("capture-container-text").trim();
      if (!seen) { toast("Describe what is visible so the photo has a reviewable claim."); break; }
      const out = act(() => store.snapshotContainer(containerId, seen, ui.captureMedia.container), "Container snapshot created as a Review proposal.", { view: "review" });
      if (out) {
        scanMediaReadToken += 1;
        ui.captureMedia.container = null;
        ui.captureDrafts.container.seen = "";
        navigate("review");
      }
      break;
    }
    case "product-create": {
      const name = inputValue("product-name").trim();
      const defaultHome = inputValue("product-home");
      const width = inputNumber("product-width"), depth = inputNumber("product-depth"), height = inputNumber("product-height");
      const sourceRaw = inputValue("product-source");
      const source = sourceRaw === "scan" || sourceRaw === "manual" ? sourceRaw : "product";
      const kinds = inputValue("product-tags").split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
      if (!name || !defaultHome) { toast("Product name and default home are required."); break; }
      if (!width || !depth || !height) { toast("Add all three dimensions so layout checks have a real volume."); break; }
      const out = act(() => store.createBelonging({
        name, kinds, importance: "normal", defaultHome: { type: "container", id: defaultHome }, source,
        dimensions: { width: width / 100, depth: depth / 100, height: height / 100, unit: "m", source, verified: source !== "scan" }
      }), "Product added with normalized dimensions.", { view: "belongings" });
      if (out) {
        ui.captureDrafts.product = { name: "", tags: "", width: "", depth: "", height: "", defaultHome: "", source: "product" };
        navigate("belongings");
      }
      break;
    }
    case "top-locate": doLocate(inputValue("top-search-input"), "top-search-input"); break;
    case "hero-locate": doLocate(inputValue("hero-search-input"), "hero-search-input"); break;
    case "ask-send": doAsk(inputValue("ask-input")); break;
    case "ask-prompt": if (t.dataset.prompt) doAsk(t.dataset.prompt); break;
    case "answer-not-there": {
      const itemId = t.dataset.item;
      if (!itemId) break;
      const out = act(() => store.markNotThere(itemId), "Correction opened in Review — nothing was silently overwritten.", { view: "review" });
      if (out) { ui.lastAnswer = store.locateById(itemId); navigate("review"); }
      break;
    }
    case "answer-show-plan": navigate("plan"); break;
    case "focus-attention": {
      const attention = document.querySelector<HTMLElement>('[data-testid="attention-card"]');
      attention?.focus({ preventScroll: true });
      attention?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      break;
    }
    case "open-container": if (t.dataset.id) {
      snapshotPhotoReadToken += 1;
      rememberModalTrigger(t);
      focusViewOnRender = false;
      focusModalOnRender = true;
      ui.modal = { type: "container", id: t.dataset.id };
      ui.pendingSnapshotPhoto = null;
      ui.containerItemsQuery = "";
      ui.containerItemsOffset = 0;
      render();
    } break;
    case "open-item": if (t.dataset.id) { rememberModalTrigger(t); focusViewOnRender = false; focusModalOnRender = true; ui.modal = { type: "item", id: t.dataset.id }; render(); } break;
    case "open-add-belonging": rememberModalTrigger(t); focusViewOnRender = false; focusModalOnRender = true; ui.modal = { type: "add-belonging" }; render(); break;
    case "close-modal": closeModal(); break;
    case "close-modal-overlay": if (e.target === t) closeModal(); break;
    case "clear-snapshot-photo": snapshotPhotoReadToken += 1; controlReturnFocus = focusBookmark(t); ui.pendingSnapshotPhoto = null; ui.mediaPending.snapshot = false; render(); break;
    case "confirm-container": if (t.dataset.id) { controlReturnFocus = focusBookmark(t); act(() => store.confirmContainer(t.dataset.id as string), "Container confirmed — freshness updated."); } break;
    case "snapshot-submit": {
      if (ui.mediaPending.snapshot) { toast("The selected photo is still being prepared.", { tone: "info" }); break; }
      const containerId = t.dataset.id;
      const text = inputValue("snapshot-text").trim();
      if (containerId && text) {
        const photo = ui.pendingSnapshotPhoto;
        const out = act(() => store.snapshotContainer(containerId, text, photo), "Snapshot recorded as a proposal — review it in the inbox.");
        if (out === null) break;
        snapshotPhotoReadToken += 1;
        ui.pendingSnapshotPhoto = null;
        delete ui.captureDrafts.snapshots[containerId];
        closeModal();
      } else if (!text) {
        toast("Type what you can see first — the photo alone is evidence, not recognition.");
      }
      break;
    }
    case "item-move": {
      const itemId = t.dataset.id;
      if (!itemId) break;
      const sel = document.querySelector<HTMLSelectElement>(`select[data-role="move-select"][data-item="${itemId}"]`);
      if (sel?.value) { controlReturnFocus = focusBookmark(t); act(() => store.correctPlacement(itemId, { type: "container", id: sel.value }), "Placement corrected — old record kept in history."); }
      break;
    }
    case "add-belonging-submit": {
      const name = inputValue("nb-name");
      const kinds = inputValue("nb-kinds").split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
      const importanceRaw = inputValue("nb-importance");
      const importance = importanceRaw === "essential" || importanceRaw === "high" ? importanceRaw : "normal";
      const def = inputValue("nb-default");
      const cur = inputValue("nb-current");
      const width = inputNumber("nb-width"), depth = inputNumber("nb-depth"), height = inputNumber("nb-height");
      const dimensions = width && depth && height
        ? { width: width / 100, depth: depth / 100, height: height / 100, unit: "m" as const, source: "manual" as const, verified: true }
        : undefined;
      if (!def) { toast("Add a container first."); break; }
      const out = act(() => store.createBelonging({
        name, kinds, importance,
        defaultHome: { type: "container", id: def },
        currentPlace: cur ? { type: "container", id: cur } : null,
        ...(dimensions ? { dimensions, source: "manual" as const } : {})
      }), "Belonging added to home memory.");
      if (out) closeModal();
      break;
    }
    case "setup-add-room": {
      const name = t.dataset.name;
      if (name) { controlReturnFocus = focusBookmark(t); act(() => store.createRoom({ name }), `Room added: ${name}`); }
      break;
    }
    case "setup-add-room-custom": {
      const name = inputValue("setup-room-name").trim();
      if (name) { controlReturnFocus = focusBookmark(t); act(() => store.createRoom({ name }), `Room added: ${name}`); }
      break;
    }
    case "setup-add-container": {
      const roomId = inputValue("setup-container-room");
      const kindRaw = inputValue("setup-container-kind");
      const kind = (CONTAINER_KIND_OPTIONS as readonly string[]).includes(kindRaw) ? kindRaw as (typeof CONTAINER_KIND_OPTIONS)[number] : "box";
      const name = inputValue("setup-container-name").trim() || `${kind[0]?.toUpperCase()}${kind.slice(1)}`;
      if (roomId) { controlReturnFocus = focusBookmark(t); act(() => store.createContainer({ name, kind, roomId }), `Container added: ${name}`); }
      break;
    }
    case "setup-add-belonging": {
      const name = inputValue("setup-item-name").trim();
      const kinds = inputValue("setup-item-tags").split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
      const containerId = inputValue("setup-item-container");
      const importanceRaw = inputValue("setup-item-importance");
      const importance = importanceRaw === "essential" || importanceRaw === "high" ? importanceRaw : "normal";
      if (name && containerId) {
        controlReturnFocus = focusBookmark(t);
        act(() => store.createBelonging({ name, kinds, importance, defaultHome: { type: "container", id: containerId } }), `Added ${name}.`);
      }
      break;
    }
    case "start-op": {
      const template = t.dataset.template;
      if (!template) break;
      const opId = act(() => store.startOperation(template), "Operation started.", { view: "operations" });
      if (opId) { ui.openOpId = opId; navigate("operations"); }
      break;
    }
    case "open-op": if (t.dataset.id) { controlReturnFocus = focusBookmark(t); ui.openOpId = t.dataset.id; ui.view = "operations"; render(); } break;
    case "close-op-detail": controlReturnFocus = focusBookmark(t); ui.openOpId = null; render(); break;
    case "finish-op": if (t.dataset.id) { ui.openOpId = null; controlReturnFocus = null; focusViewOnRender = true; act(() => store.setOperationStatus(t.dataset.id as string, "done"), "Operation finished."); } break;
    case "create-box": {
      const label = inputValue("new-box-label");
      const dest = inputValue("new-box-dest");
      controlReturnFocus = focusBookmark(t);
      act(() => store.createBox({ label, destination: dest, operationId: t.dataset.op ?? null }), "Box created.");
      break;
    }
    case "assign-box": {
      const boxId = t.dataset.box;
      if (!boxId) break;
      const sel = document.querySelector<HTMLSelectElement>(`select[data-role="assign-select"][data-box="${boxId}"]`);
      if (sel?.value) { controlReturnFocus = focusBookmark(t); act(() => store.assignToBox(sel.value, boxId), "Packed — placement and state ledgered."); }
      break;
    }
    case "unpack-item": if (t.dataset.item) { controlReturnFocus = focusBookmark(t); act(() => store.unpackItem(t.dataset.item as string), "Unpacked to default home."); } break;
    case "box-search": controlReturnFocus = focusBookmark(t); ui.boxQuery = inputValue("box-search-input"); render(); break;
    case "locate-item": if (t.dataset.id) { setLocateAnswer(store.locateById(t.dataset.id)); navigate("home"); } break;
    case "accept-proposal": {
      const pid = t.dataset.id;
      if (!pid) break;
      const placementSelects = document.querySelectorAll<HTMLSelectElement>(`select[data-role="proposal-place"][data-proposal="${pid}"]`);
      const survivor = document.querySelector<HTMLSelectElement>(`select[data-role="proposal-survivor"][data-proposal="${pid}"]`);
      const placementOverrides: Record<string, { type: "container"; id: string }> = {};
      for (const select of placementSelects) {
        if (select.dataset.item && select.value) placementOverrides[select.dataset.item] = { type: "container", id: select.value };
      }
      const extra: { placementOverrides?: Record<string, { type: "container"; id: string }>; mergeKeepId?: string } = {};
      if (Object.keys(placementOverrides).length) extra.placementOverrides = placementOverrides;
      if (survivor?.value) extra.mergeKeepId = survivor.value;
      controlReturnFocus = focusBookmark(t);
      const out = act(() => store.acceptProposal(pid, extra), "Accepted — your reviewed version is now part of home memory.");
      if (out !== null) delete ui.proposalEdits[pid];
      break;
    }
    case "reject-proposal": if (t.dataset.id) {
      controlReturnFocus = focusBookmark(t);
      const out = act(() => store.rejectProposal(t.dataset.id as string), "Rejected — decision ledgered.");
      if (out !== null) delete ui.proposalEdits[t.dataset.id];
    } break;
    case "belongings-filter": {
      const f = t.dataset.state ?? "";
      ui.stateFilter = (LIFECYCLE_STATES as readonly string[]).includes(f) ? (f as LifecycleState) : "";
      ui.belongingsOffset = 0;
      controlReturnFocus = focusBookmark(t);
      render();
      break;
    }
    case "belongings-page-next":
    case "belongings-page-previous": {
      const rows = visibleBelongings();
      const page = listPage(rows, ui.belongingsOffset, LIST_WINDOW_SIZE);
      const nextOffset = action === "belongings-page-next"
        ? Math.min(page.end, Math.max(0, page.total - 1))
        : Math.max(0, page.start - LIST_WINDOW_SIZE);
      const firstNew = rows[nextOffset];
      ui.belongingsOffset = nextOffset;
      controlReturnFocus = firstNew ? { dataset: { action: "open-item", id: firstNew.id }, reveal: true } : focusBookmark(t);
      render();
      break;
    }
    case "container-items-page-next":
    case "container-items-page-previous": {
      if (ui.modal?.type !== "container") break;
      const rows = visibleContainerItems(ui.modal.id);
      const page = listPage(rows, ui.containerItemsOffset, LIST_WINDOW_SIZE);
      const nextOffset = action === "container-items-page-next"
        ? Math.min(page.end, Math.max(0, page.total - 1))
        : Math.max(0, page.start - LIST_WINDOW_SIZE);
      const firstNew = rows[nextOffset];
      ui.containerItemsOffset = nextOffset;
      controlReturnFocus = firstNew ? { dataset: { action: "locate-item", id: firstNew.id }, reveal: true } : focusBookmark(t);
      render();
      break;
    }
    case "ledger-page-next":
    case "ledger-page-previous": {
      const page = listBounds(store.state.commits.length, ui.ledgerOffset, LIST_WINDOW_SIZE);
      const nextOffset = action === "ledger-page-next"
        ? Math.min(page.end, Math.max(0, page.total - 1))
        : Math.max(0, page.start - LIST_WINDOW_SIZE);
      const firstNew = store.commitsView(nextOffset + 1)[nextOffset];
      ui.ledgerOffset = nextOffset;
      controlReturnFocus = firstNew ? { dataset: { role: "commit-record", id: firstNew.id }, reveal: true } : focusBookmark(t);
      render();
      break;
    }
    case "review-page-next":
    case "review-page-previous": {
      const rows = store.proposals("pending");
      const page = listPage(rows, ui.reviewOffset, REVIEW_WINDOW_SIZE);
      const nextOffset = action === "review-page-next"
        ? Math.min(page.end, Math.max(0, page.total - 1))
        : Math.max(0, page.start - REVIEW_WINDOW_SIZE);
      const firstNew = rows[nextOffset];
      ui.reviewOffset = nextOffset;
      controlReturnFocus = firstNew ? { dataset: { role: "proposal-record", proposal: firstNew.id }, reveal: true } : focusBookmark(t);
      render();
      break;
    }
    case "ledger-export": {
      const blob = new Blob([store.exportJsonText()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nestory-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      break;
    }
    case "ledger-import": document.getElementById("import-file")?.click(); break;
    case "ledger-reset": {
      if (window.confirm("Return the current Place Graph to this home's starting state? Prior Commit Ledger history will remain available.")) {
        controlReturnFocus = focusBookmark(t);
        act(() => store.reset(), "Reset done.");
      }
      break;
    }
    default: break;
  }
});

document.addEventListener("change", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) syncDraftControl(target);
  const t = target?.closest<HTMLElement>("[data-action]");
  if (t instanceof HTMLSelectElement) {
    switch (t.dataset.action) {
      case "row-status":
        if (t.dataset.op && t.dataset.row && (ROW_STATUSES as readonly string[]).includes(t.value)) {
          controlReturnFocus = focusBookmark(t);
          act(() => store.setRowStatus(t.dataset.op as string, t.dataset.row as string, t.value as RowStatus), null);
        }
        break;
      case "box-status":
        if (t.dataset.box && (BOX_STATUSES as readonly string[]).includes(t.value)) {
          controlReturnFocus = focusBookmark(t);
          act(() => store.setBoxStatus(t.dataset.box as string, t.value as BoxStatus), null);
        }
        break;
      case "item-state":
        if (t.dataset.id && (LIFECYCLE_STATES as readonly string[]).includes(t.value)) {
          controlReturnFocus = focusBookmark(t);
          act(() => store.setItemState(t.dataset.id as string, t.value as LifecycleState), null);
        }
        break;
      case "proposal-place-edit":
        if (t.dataset.proposal && t.dataset.item) {
          const edit = ui.proposalEdits[t.dataset.proposal] ?? { placements: {} };
          edit.placements[t.dataset.item] = t.value;
          ui.proposalEdits[t.dataset.proposal] = edit;
          controlReturnFocus = focusBookmark(t);
          render();
        }
        break;
      case "proposal-survivor-edit":
        if (t.dataset.proposal) {
          const edit = ui.proposalEdits[t.dataset.proposal] ?? { placements: {} };
          edit.mergeKeepId = t.value;
          ui.proposalEdits[t.dataset.proposal] = edit;
          controlReturnFocus = focusBookmark(t);
          render();
        }
        break;
      default: break;
    }
  }
  if (target instanceof HTMLInputElement && target.dataset.role === "snapshot-photo") {
    const file = target.files?.[0];
    if (!file) return;
    const containerId = ui.modal?.type === "container" ? ui.modal.id : null;
    if (!containerId) return;
    const token = ++snapshotPhotoReadToken;
    controlReturnFocus = focusBookmark(target);
    ui.mediaPending.snapshot = true;
    render();
    void downscalePhoto(file)
      .then((photo) => {
        if (token !== snapshotPhotoReadToken || ui.modal?.type !== "container" || ui.modal.id !== containerId) return;
        const returnFocus = activeControlBookmark() ?? controlReturnFocus;
        controlReturnFocus = null;
        if (returnFocus) focusViewOnRender = false;
        ui.mediaPending.snapshot = false;
        ui.pendingSnapshotPhoto = photo;
        render();
        restoreFocusTarget(returnFocus);
      })
      .catch(() => {
        if (token !== snapshotPhotoReadToken) return;
        ui.mediaPending.snapshot = false;
        render();
        toast("⚠ Could not read that image.");
      });
    return;
  }
  if (target instanceof HTMLInputElement && (target.dataset.role === "room-scan-media" || target.dataset.role === "capture-photo")) {
    const file = target.files?.[0];
    if (!file) return;
    const captureMode = ui.captureMode;
    if (captureMode !== "room" && captureMode !== "container") return;
    const token = ++scanMediaReadToken;
    controlReturnFocus = focusBookmark(target);
    ui.mediaPending[captureMode] = true;
    render();
    void downscalePhoto(file, 960)
      .then((photo) => {
        if (token !== scanMediaReadToken || ui.view !== "capture" || ui.captureMode !== captureMode) return;
        const returnFocus = activeControlBookmark() ?? controlReturnFocus;
        controlReturnFocus = null;
        if (returnFocus) focusViewOnRender = false;
        ui.mediaPending[captureMode] = false;
        ui.captureMedia[captureMode] = photo;
        if (captureMode === "room") ui.scanDraft = null;
        render();
        restoreFocusTarget(returnFocus);
      })
      .catch(() => {
        if (token !== scanMediaReadToken) return;
        ui.mediaPending[captureMode] = false;
        render();
        toast("⚠ Could not read that image.");
      });
    return;
  }
  if (target instanceof HTMLInputElement && target.id === "import-file") {
    const file = target.files?.[0];
    if (!file) return;
    const expectedRevision = store.revision;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        store.importJson(JSON.parse(String(reader.result)), expectedRevision);
        toast("Imported.");
      } catch (err) {
        toast(`⚠ ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
  }
});

document.addEventListener("input", (e) => {
  const target = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement ? e.target : null;
  if (target) syncDraftControl(target);
  if (target instanceof HTMLInputElement && target.dataset.input === "belongings-query") {
    ui.belongingsQuery = target.value;
    ui.belongingsOffset = 0;
    const rows = visibleBelongings();
    const list = document.getElementById("belongings-list");
    if (list) list.innerHTML = renderBelongingsWindow(rows);
    const count = document.getElementById("belongings-visible-count");
    if (count) count.textContent = String(rows.length);
    decorateIcons();
  }
  if (target instanceof HTMLInputElement && target.dataset.input === "container-items-query" && ui.modal?.type === "container") {
    ui.containerItemsQuery = target.value;
    ui.containerItemsOffset = 0;
    const contents = store.containerContents(ui.modal.id);
    const list = document.getElementById("container-items-window");
    if (contents && list) list.innerHTML = renderContainerItemsWindow(ui.modal.id, contents.container.kind === "box");
    decorateIcons();
  }
});

document.addEventListener("keydown", (e) => {
  const typingTarget = e.target instanceof HTMLInputElement
    || e.target instanceof HTMLTextAreaElement
    || e.target instanceof HTMLSelectElement
    || (e.target instanceof HTMLElement && e.target.isContentEditable);
  if (e.key === "Escape" && ui.modal) {
    e.preventDefault();
    closeModal();
    return;
  }
  if (e.key === "Tab" && ui.modal) {
    const modal = document.querySelector<HTMLElement>(".modal[role=dialog]");
    const focusable = modal ? [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.offsetParent !== null) : [];
    if (!modal || !focusable.length) {
      e.preventDefault();
      modal?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
    return;
  }
  if (e.key === "/" && !typingTarget && mode !== null && !ui.modal) {
    e.preventDefault();
    const search = document.getElementById("top-search-input");
    if (search instanceof HTMLInputElement) search.focus();
    return;
  }
  // SVG plan-object groups are role=button/tabindex=0 but not native buttons, so
  // Enter/Space won't synthesize a click. Activate the focused spatial-select group.
  if ((e.key === "Enter" || e.key === " ") && !typingTarget) {
    const active = document.activeElement;
    if (active instanceof SVGElement && active.getAttribute("data-action") === "spatial-select") {
      const id = active.getAttribute("data-id");
      if (id) {
        e.preventDefault();
        applySpatialSelection(id, { dispatchToScene: true });
        return;
      }
    }
  }
  if (e.key !== "Enter") return;
  const target = e.target instanceof HTMLInputElement ? e.target : null;
  if (!target) return;
  const enter = target.dataset.enter;
  if (enter === "top-locate" || enter === "hero-locate") doLocate(target.value, target.id);
  if (enter === "ask-send") doAsk(target.value);
  if (enter === "box-search") { ui.boxQuery = target.value; render(); }
  if (enter === "setup-add-room-custom" || enter === "setup-add-container" || enter === "setup-add-belonging") {
    const btn = document.querySelector<HTMLElement>(`[data-action="${enter}"]`);
    btn?.click();
  }
});

store.subscribe(requestRender);
compactHomeQuery.addEventListener("change", requestRender);

// ------------------------------------------------- verification interface

export interface NestoryHooks {
  store: Store;
  ui: UIState;
  agent: AgentToolkit;
  mode: HomeMode | null;
  chooseMode(m: HomeMode): void;
  setView(v: ViewId): void;
  locate(q: string): DeepReadonly<LocateAnswer>;
  ask(q: string): AskReply | null;
  openContainer(id: string): void;
  openItem(id: string): void;
  openOperation(id: string): void;
  render(): void;
  version: string;
}

declare global {
  interface Window { nestory: NestoryHooks; }
}

window.nestory = {
  store,
  ui,
  agent,
  mode,
  chooseMode,
  setView(v) { navigate(v); },
  locate(q) { const answer = setLocateAnswer(store.locate(q)); render(); announce(answer.sentence); return answer; },
  ask(q) { ui.view = "ask"; ui.modal = null; return doAsk(q); },
  openContainer(id) {
    modalReturnFocus = null;
    focusViewOnRender = false;
    focusModalOnRender = true;
    ui.containerItemsQuery = "";
    ui.containerItemsOffset = 0;
    ui.modal = { type: "container", id };
    render();
  },
  openItem(id) { modalReturnFocus = null; focusViewOnRender = false; focusModalOnRender = true; ui.modal = { type: "item", id }; render(); },
  openOperation(id) { ui.openOpId = id; navigate("operations", { focus: false }); },
  render,
  version: "v2.5-ts"
};

render();
