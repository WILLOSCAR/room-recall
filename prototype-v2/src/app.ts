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
import { mountSpatialScene } from "./spatial.ts";
import type { SpatialObject, SpatialSceneData } from "./spatial.ts";
import type {
  BoxStatus, CommitOp, ContainerView, LifecycleState, LocateAnswer,
  OperationView, PhotoMedia, RowStatus, Store
} from "./types.ts";
import { BOX_STATUSES, LIFECYCLE_STATES, ROW_STATUSES } from "./types.ts";

// ------------------------------------------------------------------- mode

type HomeMode = "demo" | "own";
const MODE_KEY = "nestory-v2-mode";

function readMode(): HomeMode | null {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    return raw === "demo" || raw === "own" ? raw : null;
  } catch { return null; }
}

const mode: HomeMode | null = readMode();

const store: Store = createStore(
  mode === "own"
    ? { catalog: emptyCatalog, seedFactory: () => [], persistKey: "nestory-v2-own" }
    : { catalog, seedFactory: () => buildSeedRecords(Date.now()), persistKey: "nestory-v2" }
);

const agent: AgentToolkit = createAgentToolkit(store);

function chooseMode(next: HomeMode): void {
  try { localStorage.setItem(MODE_KEY, next); } catch { /* private mode */ }
  location.reload();
}

// --------------------------------------------------------------------- ui

const VIEWS = [
  { id: "home", label: "Home", icon: "house" },
  { id: "ask", label: "Ask", icon: "sparkles" },
  { id: "capture", label: "Capture", icon: "scan-line" },
  { id: "setup", label: "Setup", icon: "wand-sparkles" },
  { id: "spaces", label: "Spaces", icon: "panels-top-left" },
  { id: "belongings", label: "Belongings", icon: "package-search" },
  { id: "operations", label: "Operations", icon: "route" },
  { id: "review", label: "Review", icon: "list-checks" },
  { id: "plan", label: "Plan", icon: "cuboid" },
  { id: "ledger", label: "Ledger", icon: "rows-3" }
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

type Modal =
  | { type: "container"; id: string }
  | { type: "item"; id: string }
  | { type: "add-belonging" };

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

interface UIState {
  view: ViewId;
  lastAnswer: LocateAnswer | null;
  modal: Modal | null;
  belongingsQuery: string;
  stateFilter: LifecycleState | "";
  openOpId: string | null;
  boxQuery: string;
  pendingSnapshotPhoto: PhotoMedia | null;
  askLog: AskLogEntry[];
  captureMode: CaptureMode;
  planMode: PlanMode;
  scanDraft: ScanDraft | null;
  scanMedia: PhotoMedia | null;
}

const ui: UIState = {
  view: mode === "own" && store.state.rooms.size === 0 ? "setup" : "home",
  lastAnswer: null,
  modal: null,
  belongingsQuery: "",
  stateFilter: "",
  openOpId: null,
  boxQuery: "",
  pendingSnapshotPhoto: null,
  askLog: [],
  captureMode: "room",
  planMode: "3d",
  scanDraft: null,
  scanMedia: null
};

let spatialCleanup: (() => void)[] = [];

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

function buildScanDraft(anchorCm: number): ScanDraft {
  return {
    fileName: ui.scanMedia ? "room-photo.jpg" : "demo-room-sweep",
    anchorCm,
    coverage: ui.scanMedia ? 82 : 74,
    proposals: [
      { id: "scan-desk", label: "Desk · footprint 140 × 70 cm", kind: "furniture", confidence: 0.94, decision: "pending", object: { id: "scan-desk", label: "Desk candidate", kind: "furniture", x: 2.6, z: 0.15, w: 1.4, d: 0.7, h: 0.74, proposalState: "pending" } },
      { id: "scan-shelf", label: "Storage shelf · 4 levels", kind: "container", confidence: 0.78, decision: "pending", object: { id: "scan-shelf", label: "Shelf candidate", kind: "furniture", x: 3.65, z: 1.15, w: 0.45, d: 1.05, h: 1.75, proposalState: "pending" } },
      { id: "scan-bottle", label: "Water bottle · desk surface", kind: "item", confidence: 0.86, decision: "pending", object: { id: "scan-bottle", label: "Water bottle", kind: "box", x: 3.35, z: 0.38, w: 0.12, d: 0.12, h: 0.28, proposalState: "pending" } },
      { id: "scan-card", label: "Gym card · entry tray", kind: "item", confidence: 0.61, decision: "pending", object: { id: "scan-card", label: "Gym card", kind: "box", x: 4.82, z: 2.65, w: 0.12, d: 0.08, h: 0.02, proposalState: "pending" } }
    ]
  };
}

function spatialSceneData(includeScanDraft: boolean): SpatialSceneData {
  const rooms = [...store.state.rooms.values()].map((room) => ({
    id: room.id, name: room.name, x: room.plan.x, z: room.plan.y, w: room.plan.w, d: room.plan.h
  }));
  const heightFor = (name: string): number => {
    const value = name.toLowerCase();
    if (value.includes("wardrobe")) return 2.05;
    if (value.includes("shelf")) return 1.72;
    if (value.includes("bed")) return 0.48;
    if (value.includes("desk")) return 0.74;
    if (value.includes("rack")) return 0.52;
    return 0.68;
  };
  const objects: SpatialObject[] = store.catalog.furniture.map((f) => ({
    id: f.id, name: f.name, roomId: f.room, kind: "furniture", x: f.plan.x, z: f.plan.y,
    w: f.plan.w, d: f.plan.h, h: heightFor(f.name)
  }));
  store.containersView().filter((c) => c.kind === "box").forEach((box, index) => {
    const room = store.state.rooms.get(box.parent.id) ?? [...store.state.rooms.values()][0];
    if (!room) return;
    objects.push({
      id: box.id, name: box.name, roomId: room.id, kind: "box", h: 0.46, w: 0.42, d: 0.42,
      x: room.plan.x + room.plan.w - 0.58 - (index % 3) * 0.48,
      z: room.plan.y + room.plan.h - 0.55 - Math.floor(index / 3) * 0.48
    });
  });
  const answer = ui.lastAnswer;
  return {
    rooms,
    objects,
    proposals: includeScanDraft ? ui.scanDraft?.proposals.map((p) => p.object) ?? [] : [],
    pin: answer?.ok && answer.planPin ? {
      x: answer.planPin.x, z: answer.planPin.y, y: 0.82,
      radius: 0.14 + (1 - answer.confidence) * 0.28
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

function toast(msg: string): void {
  const root = must<HTMLDivElement>("toast-root");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function act<T>(fn: () => T, okMsg: string | null): T | null {
  try {
    const out = fn();
    // A write that could not be saved must not be confirmed as if it had been. While
    // saving is blocked the store keeps changes in memory only — real for this session,
    // then gone — so the toast says that instead of "Room added".
    if (okMsg) toast(store.storageRecovery()?.savingBlocked ? `⚠ ${okMsg} — but NOT saved. See the notice above.` : okMsg);
    return out;
  } catch (err) {
    toast(`⚠ ${err instanceof Error ? err.message : String(err)}`);
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

function render(): void {
  spatialCleanup.forEach((dispose) => dispose());
  spatialCleanup = [];
  renderSidebar();
  renderTopbar();
  if (mode === null) {
    // The welcome chooser is reachable WITH an unreadable ledger in storage: whenever the
    // records key survives but the mode key does not (selective site-data clearing, a
    // profile migration, a partial write). Without the notice here the person is invited
    // to pick a fresh home while their unread record sits in storage — the same failure
    // the shell-level notice fixed one level down.
    must<HTMLElement>("view").innerHTML = renderRecoveryNotice() + renderWelcome();
    decorateUi();
    return;
  }
  const renderer: Record<ViewId, () => string> = {
    home: renderHome, ask: renderAsk, capture: renderCapture, setup: renderSetup, spaces: renderSpaces, belongings: renderBelongings,
    operations: renderOperations, review: renderReview, plan: renderPlan, ledger: renderLedger
  };
  // The saved-state recovery notice belongs to the SHELL, not to one view. A recovered
  // boot can land anywhere — in "own" mode an unreadable ledger derives an empty home,
  // so the app opens on `setup` and would otherwise invite the person to build a home
  // from scratch while their real record sits unread in storage. Rendering it here means
  // no view can be reached without the disclosure.
  must<HTMLElement>("view").innerHTML = renderRecoveryNotice() + renderer[ui.view]() + renderModal();
  decorateUi();
}

function decorateUi(): void {
  decorateIcons();
  requestAnimationFrame(() => {
    document.querySelectorAll<HTMLElement>("[data-spatial-scene]").forEach((el) => {
      spatialCleanup.push(mountSpatialScene(el, spatialSceneData(el.dataset.spatialScene === "scan")));
    });
  });
}

function renderSidebar(): void {
  const brand = `<div class="brand"><span class="name">Nestory</span><span class="tag">home memory</span></div>`;
  if (mode === null) {
    must<HTMLElement>("sidebar").innerHTML = brand;
    return;
  }
  const pending = store.proposals("pending").length;
  must<HTMLElement>("sidebar").innerHTML = `
    ${brand}
    ${visibleViews().map((v) => `
      <button class="nav-btn ${ui.view === v.id ? "active" : ""}" data-action="nav" data-view="${v.id}" data-testid="nav-${v.id}">
        <span class="icon"><i data-lucide="${v.icon}"></i></span><span class="label">${v.label}</span>
        ${v.id === "review" && pending ? `<span class="badge" data-testid="review-badge">${pending}</span>` : ""}
      </button>`).join("")}
    <div class="sidebar-foot">${mode === "own" ? "Your home" : "Demo home"} · Place Graph is the source of truth. Nothing uncertain writes without review.</div>`;
}

function renderTopbar(): void {
  if (mode === null) {
    must<HTMLElement>("topbar").innerHTML = `<h1>Welcome</h1>`;
    return;
  }
  const title = VIEWS.find((v) => v.id === ui.view)?.label ?? "Home";
  must<HTMLElement>("topbar").innerHTML = `
    <h1>${esc(title)}</h1>
    <div class="top-search">
      <input type="text" id="top-search-input" placeholder="Where is my…?" data-enter="top-locate">
      <button class="primary icon-label" data-action="top-locate"><i data-lucide="search"></i><span>Locate</span></button>
    </div>
    <button class="icon-button" data-action="nav" data-view="capture" title="Capture home memory" aria-label="Capture home memory"><i data-lucide="scan-line"></i></button>`;
}

// ---------------------------------------------------------------- welcome

function renderWelcome(): string {
  return `<section data-testid="view-welcome">
    <div class="hero">
      <h2>Nestory — a memory system for your home</h2>
      <div class="muted">It remembers what you own, where it lives, what state it is in, and what you need for real operations like moving, unpacking, and preparing kits. Every answer carries evidence and confidence; nothing uncertain becomes truth without your review.</div>
    </div>
    <div class="grid-2">
      <div class="card op-card" data-action="choose-mode" data-mode="demo" data-testid="btn-mode-demo">
        <h3>Explore the demo home</h3>
        <div class="sub">A furnished rental bedroom mid-move: packed boxes, a fitness kit, a review inbox with real decisions to make. The fastest way to feel the product.</div>
      </div>
      <div class="card op-card" data-action="choose-mode" data-mode="own" data-testid="btn-mode-own">
        <h3>Start with my own home</h3>
        <div class="sub">Begin from nothing. A guided setup gets you to a searchable home memory — rooms, containers, first ten belongings, first operation — in under ten minutes.</div>
      </div>
    </div>
    <div class="card" style="margin-top:14px"><div class="sub">You can switch between the two at any time from the Ledger tab. Each keeps its own records.</div></div>
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
    return `<section data-testid="view-setup"><div class="card muted">Setup belongs to your own home. Switch modes from the Ledger tab.</div></section>`;
  }
  const rooms = [...store.state.rooms.values()];
  const containers = store.containersView().filter((c) => c.kind !== "box");
  const belongings = store.searchBelongings("");
  const a = store.activation();
  const remainingTemplates = ROOM_TEMPLATES.filter((t) => !rooms.some((r) => r.name.toLowerCase() === t.toLowerCase()));

  return `<section data-testid="view-setup">
    <div class="hero">
      <h2>Set up your home memory</h2>
      <div class="muted">Four small steps. Every action below is an ordinary ledger commit — you can inspect all of it later.</div>
      <div style="margin-top:10px">${activationChecklist()}</div>
    </div>

    <div class="card">
      <h3>1 · Rooms</h3>
      <div class="sub">Add the rooms you actually use. Plan positions are auto-assigned.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
        ${remainingTemplates.map((t) => `<button class="small" data-action="setup-add-room" data-name="${esc(t)}">＋ ${esc(t)}</button>`).join("")}
        <input type="text" id="setup-room-name" placeholder="Custom room…" style="max-width:180px" data-enter="setup-add-room-custom">
        <button class="small" data-action="setup-add-room-custom">Add room</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${rooms.map((r) => `<span class="chip neutral">${esc(r.name)}</span>`).join("") || '<span class="faint">No rooms yet.</span>'}</div>
    </div>

    <div class="card">
      <h3>2 · Containers</h3>
      <div class="sub">Drawers, shelves, bags, boxes — the places things live in.</div>
      ${rooms.length ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;align-items:center">
          <select id="setup-container-room">${rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select>
          <select id="setup-container-kind">${CONTAINER_KIND_OPTIONS.map((k) => `<option value="${k}">${k}</option>`).join("")}</select>
          <input type="text" id="setup-container-name" placeholder="e.g. Top drawer" style="max-width:200px" data-enter="setup-add-container">
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
          <input type="text" id="setup-item-name" placeholder="Belonging name" style="max-width:190px" data-enter="setup-add-belonging">
          <input type="text" id="setup-item-tags" placeholder="tags (comma)" style="max-width:160px" data-enter="setup-add-belonging">
          <select id="setup-item-container">${containers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
          <select id="setup-item-importance"><option value="normal">normal</option><option value="high">high</option><option value="essential">essential</option></select>
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
  const calls = reply?.toolCalls.map((c) => `<span class="op-badge">→ ${esc(c.name)} ${esc(JSON.stringify(c.input))}</span>`).join("") ?? "";
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
    ${calls ? `<div class="cops" style="margin-bottom:6px">${calls}</div>` : ""}
    <div>${esc(entry.text)}</div>
    ${extra}
  </div></div>`;
}

function renderAsk(): string {
  return `<section data-testid="view-ask">
    <div class="card" style="border-left:4px solid var(--accent)">
      <h3>Ask your home memory</h3>
      <div class="sub">Every reply is a visible tool call — the same ${agent.tools.length} tools an LLM binds to via <span class="mono">src/agent-cli.ts</span>. Deterministic router in the browser; the contract stays identical with a real model.</div>
    </div>
    <div class="card ask-log" data-testid="ask-log">
      ${ui.askLog.map(askBubble).join("") || `<div class="muted">Try: “where is my water bottle?” · “which box has the winter jacket?” · “what's in the entry tray?” · “prepare my gym kit” · “what should I unpack first?” · “what needs attention?”</div>`}
    </div>
    <div class="card">
      <div style="display:flex;gap:8px">
        <input type="text" id="ask-input" data-enter="ask-send" placeholder="Ask about belongings, boxes, kits, or what needs attention…">
        <button class="primary" data-action="ask-send" data-testid="btn-ask">Ask</button>
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
  return reply;
}

// --------------------------------------------------------------- capture

function captureTabs(): string {
  const tabs: Array<[CaptureMode, string, string]> = [
    ["room", "scan-line", "Room scan"],
    ["container", "camera", "Container"],
    ["product", "barcode", "Product"]
  ];
  return `<div class="segmented" role="tablist" aria-label="Capture method">
    ${tabs.map(([id, icon, label]) => `<button role="tab" aria-selected="${ui.captureMode === id}" class="${ui.captureMode === id ? "active" : ""}" data-action="capture-mode" data-mode="${id}"><i data-lucide="${icon}"></i>${label}</button>`).join("")}
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
      <p class="muted">Use a wide photo for this working prototype. The production path accepts a 20–40 second phone video and corner stills.</p>
      <label class="upload-zone ${ui.scanMedia ? "has-media" : ""}">
        <input type="file" accept="image/*" capture="environment" data-role="room-scan-media">
        ${ui.scanMedia ? `<img src="${esc(ui.scanMedia.dataUrl)}" alt="Room capture preview"><span><strong>Capture ready</strong><small>${ui.scanMedia.width} × ${ui.scanMedia.height}px</small></span>` : `<i data-lucide="camera"></i><span><strong>Add a room photo</strong><small>Camera or photo library</small></span>`}
      </label>
      <div class="field-row">
        <label><span>Known measurement</span><input type="number" id="scan-anchor" min="20" max="500" value="${draft?.anchorCm ?? 140}"><small>Desk width, cm</small></label>
        <label><span>Scan scope</span><select id="scan-scope"><option>Bedroom</option><option>Living room</option><option>Entryway</option></select><small>One room per pass</small></label>
      </div>
      <button class="primary wide icon-label" data-action="run-room-scan" data-testid="btn-run-room-scan"><i data-lucide="scan-line"></i><span>${draft ? "Rebuild visual draft" : "Build visual draft"}</span></button>
      <div class="honesty-note"><i data-lucide="info"></i><span>This demo runs a deterministic sample scene, not a vision model. It proves the review and mapping interaction while keeping the boundary honest.</span></div>
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
          <button class="icon-button ${p.decision === "accepted" ? "selected good" : ""}" data-action="scan-decision" data-id="${p.id}" data-decision="accepted" aria-label="Accept ${esc(p.label)}" title="Accept"><i data-lucide="check"></i></button>
          <button class="icon-button ${p.decision === "rejected" ? "selected bad" : ""}" data-action="scan-decision" data-id="${p.id}" data-decision="rejected" aria-label="Reject ${esc(p.label)}" title="Reject"><i data-lucide="x"></i></button>
        </div>
      </div>`).join("")}
    </div>
    <div class="scan-commit-bar">
      <div><strong>${accepted.length} accepted</strong><span>Accepted furniture stays in the layout draft. Accepted item labels become a container snapshot proposal.</span></div>
      <select id="scan-target-container" aria-label="Target container">${containers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
      <button class="primary" data-action="scan-send-review" ${accepted.some((p) => p.kind === "item") && containers.length ? "" : "disabled"}>Send items to Review</button>
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
      <label><span>Container</span><select id="capture-container">${containers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.kind)}</option>`).join("")}</select></label>
      <label><span>What can you see?</span><textarea id="capture-container-text" placeholder="charger, gym card, coins"></textarea><small>Comma-separated labels are matched to existing belongings.</small></label>
      <label class="upload-zone compact ${ui.scanMedia ? "has-media" : ""}">
        <input type="file" accept="image/*" capture="environment" data-role="capture-photo">
        ${ui.scanMedia ? `<img src="${esc(ui.scanMedia.dataUrl)}" alt="Container photo preview"><span><strong>Photo attached</strong><small>Stored as evidence</small></span>` : `<i data-lucide="camera"></i><span><strong>Add photo evidence</strong><small>Optional, never auto-committed</small></span>`}
      </label>
      <button class="primary wide" data-action="capture-container-submit" ${containers.length ? "" : "disabled"}>Create review proposal</button>
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
      <div class="field-row"><label><span>Product name</span><input id="product-name" type="text" placeholder="IKEA RÅSKOG trolley"></label><label><span>Category / tags</span><input id="product-tags" type="text" placeholder="storage, trolley, metal"></label></div>
      <div class="field-row dimensions">
        <label><span>Width</span><input id="product-width" type="number" min="1" placeholder="35"><small>cm</small></label>
        <label><span>Depth</span><input id="product-depth" type="number" min="1" placeholder="45"><small>cm</small></label>
        <label><span>Height</span><input id="product-height" type="number" min="1" placeholder="78"><small>cm</small></label>
      </div>
      <label><span>Default home</span><select id="product-home">${containers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>
      <label><span>Source</span><select id="product-source"><option value="product">Product page / packaging</option><option value="manual">Measured manually</option><option value="scan">Visual estimate</option></select></label>
      <button class="primary wide" data-action="product-create" ${containers.length ? "" : "disabled"}>Add product to home memory</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------------- home

function renderAnswerCard(a: LocateAnswer | null): string {
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

// Saved-state recovery notice — rendered by the SHELL above every view, because a
// recovered boot can land on any of them. If the ledger in storage could not be read,
// the store started from the seed so the app is usable, but the person must be told, or
// the interface would silently claim a home memory that is not theirs.
//
// This is a DISCLOSURE, not a decision: nothing was deleted, the original is still in
// storage, and the notice names exactly where the unreadable copy was kept. It offers no
// "clear my data" button on purpose — destroying the evidence is the one repair this
// slice refuses to make easy.
function renderRecoveryNotice(): string {
  const recovery = store.storageRecovery();
  if (!recovery) return "";
  // The reason comes from the validator and can quote a value the person typed, so it is
  // escaped and BOUNDED — an unbounded message would push the rest of the notice, which
  // is the part that matters, off the screen.
  const reason = recovery.reason.length > 240 ? `${recovery.reason.slice(0, 240)}…` : recovery.reason;
  // Say only what is true. The saved bytes are kept, but they are kept BECAUSE this build
  // could not read them — and Import runs the same two checks, so it will refuse them too.
  // Claiming "it can be recovered" would promise a route the product does not have.
  const whereItIsKept = recovery.preservedAt
    ? `Your original data is untouched: the unreadable copy is kept under <code>${esc(recovery.originalKey)}</code> and a second copy under <code>${esc(recovery.preservedAt)}</code> (${recovery.originalBytes} bytes).`
    : `Your original data is untouched under <code>${esc(recovery.originalKey)}</code> (${recovery.originalBytes} bytes). No second copy could be made, so this is the only copy and nothing will be written over it.`;
  // Saying nothing here would be the worst outcome available: the person keeps working,
  // sees each change confirmed, and loses all of it on reload. If writes are being
  // refused to protect their only copy, that is the fact they need first.
  // Two different reasons a write can be refused, and the notice must not give the wrong
  // one. When no copy could be made, writing really would overwrite the only copy — that
  // is the reason. When a copy DOES exist (`preservedAt` non-null), nothing is at risk of
  // being overwritten and the write was simply rejected by storage; saying "the only copy"
  // there both states a false cause and contradicts the sentence above it, which has just
  // named the second copy. The part that is true either way leads in both.
  const blockedWarning = recovery.savingBlocked
    ? `<p class="muted" style="margin:6px 0"><strong>Changes you make now are not being saved.</strong> ${recovery.preservedAt
        ? "Your browser refused to save them — its storage is full or restricted. Nothing already saved is at risk; this session is kept in memory only and will be lost when you close or reload this page."
        : "Writing would overwrite the only copy of your original data, so this session is kept in memory only and will be lost when you close or reload this page."}</p>`
    : "";
  return `<div class="card" style="border-left:4px solid var(--amber);margin-bottom:14px" data-testid="storage-recovery-banner" role="status">
    <div class="op-head"><h3>Your saved home memory could not be read</h3></div>
    <p class="muted" style="margin:6px 0">${esc(reason)}</p>
    <p class="muted" style="margin:6px 0">Nothing was deleted. ${whereItIsKept}</p>
    ${blockedWarning}
    <p class="muted" style="margin:6px 0">This app cannot repair it for you yet: Import runs the same checks that rejected it, so it would refuse the file too. The data is preserved so it can be repaired later or by hand — it is not restorable from inside the app today.</p>
    ${recovery.seededThisBoot
      ? `<p class="muted" style="margin:6px 0">Meanwhile this session starts from ${mode === "own" ? "an empty home" : "the demo home"}, so what you see here is not your own record.</p>`
      : `<p class="muted" style="margin:6px 0">Your current records loaded normally — this notice is about the earlier copy that is still kept aside.</p>`}
  </div>`;
}

function renderHome(): string {
  const attention = store.attention();
  const activationState = store.activation();
  const ops = store.operationsView().filter((o) => o.status === "active");
  const commits = store.commitsView(5);
  const pending = store.proposals("pending");
  const itemCount = store.searchBelongings("").length;
  const roomsCount = store.state.rooms.size;
  const freshContainers = store.containersView().filter((c) => !c.stale).length;

  const setupBanner = mode === "own" && !activationState.complete ? `
    <div class="card" style="border-left:4px solid var(--amber);margin-bottom:14px" data-testid="activation-banner">
      <div class="op-head"><h3>Finish setting up your home memory</h3><button data-action="nav" data-view="setup">Continue setup</button></div>
      ${activationChecklist()}
    </div>` : "";

  return `<section data-testid="view-home">
    ${setupBanner}
    <div class="memory-stage">
      <div class="memory-stage-copy">
        <div class="eyebrow">A memory system for your home</div>
        <h2>Your home, remembered.</h2>
        <p>Find a belonging, rebuild a kit, or inspect the evidence behind where something lives.</p>
        <div class="hero-search">
          <i data-lucide="search"></i>
          <input type="text" id="hero-search-input" placeholder="Try water bottle, passport, gym card…" data-enter="hero-locate" aria-label="Find a belonging">
          <button class="primary" data-action="hero-locate" data-testid="btn-hero-locate">Locate</button>
        </div>
        <div class="quick-actions">
          <button data-action="nav" data-view="capture"><i data-lucide="scan-line"></i> Scan a space</button>
          <button data-action="start-op" data-template="gym"><i data-lucide="dumbbell"></i> Prepare gym kit</button>
          <button data-action="nav" data-view="plan"><i data-lucide="cuboid"></i> Open 3D home</button>
        </div>
        <div class="memory-stats" aria-label="Home memory summary">
          <span><strong>${itemCount}</strong> belongings</span>
          <span><strong>${roomsCount}</strong> rooms</span>
          <span><strong>${freshContainers}</strong> fresh containers</span>
        </div>
      </div>
      <div class="memory-stage-visual" data-spatial-scene="home" aria-label="Interactive 3D home preview">
        <div class="scene-label"><span class="live-dot"></span> Place Graph · live</div>
        <button class="scene-open" data-action="nav" data-view="plan" aria-label="Open full spatial view" title="Open full spatial view"><i data-lucide="maximize-2"></i></button>
      </div>
    </div>
    ${renderAnswerCard(ui.lastAnswer)}

    <div class="dashboard-grid">
      <div>
        <div class="section-title">Active operations</div>
        ${ops.length ? ops.map(opCard).join("") : `<div class="card muted">No active operations. Start one from the Operations tab.</div>`}

        <div class="section-title">Review inbox</div>
        <div class="card">
          ${pending.length ? `
            <h3>${pending.length} pending proposal${pending.length > 1 ? "s" : ""}</h3>
            ${pending.slice(0, 2).map((p) => `<div class="attention-row"><span class="chip amber">${esc(p.type.replace(/_/g, " "))}</span><span class="grow">${esc(p.summary)}</span></div>`).join("")}
            <div style="margin-top:10px"><button data-action="nav" data-view="review">Review now</button></div>
          ` : `<div class="muted">Inbox clear — nothing waiting for review.</div>`}
        </div>
      </div>
      <div>
        <div class="section-title">Needs attention</div>
        <div class="card" data-testid="attention-card">
          ${attention.staleContainers.slice(0, 4).map((c) => `
            <div class="attention-row">
              <span class="chip amber">stale</span>
              <span class="grow">${esc(c.name)} <span class="faint">confirmed ${daysLabel(c.daysSinceConfirmed)}</span></span>
              <button class="small" data-action="confirm-container" data-id="${esc(c.id)}">Confirm</button>
              <button class="small ghost" data-action="open-container" data-id="${esc(c.id)}">Open</button>
            </div>`).join("")}
          ${attention.uncertainItems.slice(0, 3).map((v) => `
            <div class="attention-row">
              <span class="chip red">uncertain</span>
              <span class="grow">${esc(v.name)} <span class="faint">${esc(v.chainText || "no trusted place")}</span></span>
              <button class="small ghost" data-action="open-item" data-id="${esc(v.id)}">Open</button>
            </div>`).join("")}
          ${!attention.staleContainers.length && !attention.uncertainItems.length ? `<div class="muted">Everything fresh and confident.</div>` : ""}
        </div>

        <div class="section-title">Recent activity</div>
        <div class="card">
          ${commits.map((c) => `<div class="attention-row"><span class="faint">${daysLabel(daysBetween(c.at))}</span><span class="grow">${esc(c.summary)}</span></div>`).join("") || `<div class="muted">No activity yet.</div>`}
        </div>
      </div>
    </div>
  </section>`;
}

function opCard(op: OperationView): string {
  const chip = op.type === "move"
    ? `<span class="chip ${op.readiness.status === "ready" ? "sage" : "accent"}">${op.readiness.status === "ready" ? "all unpacked" : `${op.readiness.openBoxes ?? 0} open boxes`}</span>`
    : `<span class="chip ${op.readiness.status === "ready" ? "sage" : op.readiness.status === "missing_items" ? "red" : "amber"}">${op.readiness.status === "ready" ? "ready" : op.readiness.status === "missing_items" ? `missing ${op.readiness.missing}` : `review ${op.readiness.unresolved}`}</span>`;
  const sub = op.type === "move"
    ? `${op.boxes.length} boxes · ${op.packedCount} items packed`
    : `${op.rows.length} checklist rows`;
  return `<div class="card op-card" data-action="open-op" data-id="${esc(op.id)}" data-testid="op-card">
    <div class="op-head"><h3>${esc(op.name)}</h3>${chip}</div>
    <div class="sub">${esc(sub)}</div>
  </div>`;
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
    return `<div class="section-title">${esc(room.name)}</div>${content || `<div class="card muted">No containers recorded here yet.</div>`}`;
  }).join("");

  return `<section data-testid="view-spaces">
    ${roomSections}
    <div class="section-title">Moving boxes</div>
    <div class="grid-cards">${boxes.map(containerCard).join("") || `<div class="card muted">No boxes yet.</div>`}</div>
  </section>`;
}

function containerCard(c: ContainerView): string {
  const fresh = c.stale
    ? `<span class="chip amber">stale · ${daysLabel(c.daysSinceConfirmed)}</span>`
    : `<span class="chip sage">confirmed ${daysLabel(c.daysSinceConfirmed)}</span>`;
  const boxChip = c.kind === "box" && c.boxStatus ? `<span class="chip accent">${esc(c.boxStatus)}</span>` : "";
  return `<div class="card container-card" data-action="open-container" data-id="${esc(c.id)}" data-testid="container-card">
    <div class="kind">${esc(c.kind)}</div>
    <div class="cname">${esc(c.name)}</div>
    <div class="meta"><span class="chip neutral">${c.itemCount} item${c.itemCount === 1 ? "" : "s"}</span>${fresh}${boxChip}</div>
  </div>`;
}

// ------------------------------------------------------------- belongings

function renderBelongings(): string {
  const rows = store.searchBelongings(ui.belongingsQuery)
    .filter((v) => !ui.stateFilter || v.state === ui.stateFilter);
  const filters: Array<LifecycleState | ""> = ["", "at_home", "packed", "laundry", "with_me", "missing"];
  return `<section data-testid="view-belongings">
    <div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input type="text" id="belongings-search" style="max-width:300px" placeholder="Filter belongings…" value="${esc(ui.belongingsQuery)}" data-input="belongings-query">
        ${filters.map((f) => `<button class="small ${ui.stateFilter === f ? "primary" : ""}" data-action="belongings-filter" data-state="${f}">${f ? STATE_CHIP[f][1] : "all"}</button>`).join("")}
        <span style="flex:1"></span>
        <button class="primary" data-action="open-add-belonging" data-testid="btn-add-belonging">+ Add belonging</button>
      </div>
    </div>
    <div class="card">
      <div class="row-list" id="belongings-list" data-testid="belongings-list">
        ${rows.map((v) => `
          <div class="row clickable" data-action="open-item" data-id="${esc(v.id)}">
            <div class="grow">
              <div class="name">${esc(v.name)} ${v.group ? '<span class="chip neutral">group</span>' : ""} ${v.importance === "essential" ? '<span class="chip red">essential</span>' : ""}</div>
              <div class="place">${esc(v.chainText || "no trusted place")}</div>
            </div>
            ${stateChip(v.state)}
            <span title="confidence">${confDot(v.confidence)}<span class="faint">${v.confidence.toFixed(2)}</span></span>
            <span class="faint">${daysLabel(v.daysSinceUpdate)}</span>
          </div>`).join("") || `<div class="muted">Nothing matches${mode === "own" ? " — add belongings in Setup" : ""}.</div>`}
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

  return `<section data-testid="view-operations">
    <div class="card">
      <h3>Start an operation</h3>
      <div class="sub" style="margin-bottom:10px">Operations are why the memory stays alive: they use it, and they feed it.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${store.catalog.operationTemplates.filter((t) => t.id !== "cleaning").map((t) => `<button data-action="start-op" data-template="${esc(t.id)}" data-testid="start-op-${esc(t.id)}">＋ ${esc(t.name)}</button>`).join("")}
      </div>
    </div>
    <div class="section-title">Active</div>
    ${active.map(opCard).join("") || `<div class="card muted">No active operations.</div>`}
    ${open ? renderOpDetail(open) : ""}
    ${done.length ? `<div class="section-title">Closed</div>${done.map((o) => `<div class="card muted">${esc(o.name)} · ${esc(o.status)}</div>`).join("")}` : ""}
  </section>`;
}

function renderOpDetail(op: OperationView): string {
  return op.type === "move" ? renderMoveDetail(op) : renderKitDetail(op);
}

function renderKitDetail(op: Extract<OperationView, { type: "kit" }>): string {
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
          <select data-action="row-status" data-op="${esc(op.id)}" data-row="${esc(row.id)}">
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

function renderMoveDetail(op: Extract<OperationView, { type: "move" }>): string {
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
      <input type="text" id="new-box-label" placeholder="New box label…" style="max-width:200px">
      <input type="text" id="new-box-dest" placeholder="Destination (e.g. New home · kitchen)" style="max-width:260px">
      <button class="primary" data-action="create-box" data-op="${esc(op.id)}" data-testid="btn-create-box">Create box</button>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
      <input type="text" id="box-search-input" placeholder="Which box has…?" style="max-width:260px" value="${esc(ui.boxQuery)}" data-enter="box-search">
      <button data-action="box-search" data-testid="btn-box-search">Search boxes</button>
    </div>
    ${boxResults ? `<div class="card" style="box-shadow:none" data-testid="box-search-results">
      ${boxResults.length ? boxResults.map((r) => `<div class="attention-row"><span class="grow"><strong>${esc(r.item)}</strong> → ${esc(r.container.name)} <span class="faint">(${esc(r.container.box?.destination ?? "")}, ${esc(r.boxStatus ?? "")})</span></span></div>`).join("") : `<div class="muted">No packed belonging matches “${esc(ui.boxQuery)}”.</div>`}
    </div>` : ""}

    <div class="grid-cards" style="margin-top:10px">
      ${op.boxes.map((box) => `
        <div class="card box-card" data-testid="box-card">
          <div class="box-head"><strong>${esc(box.box?.label ?? box.name)}</strong>
            <select data-action="box-status" data-box="${esc(box.id)}">
              ${BOX_STATUSES.map((s) => `<option value="${s}" ${s === box.boxStatus ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
          <div class="dest">→ ${esc(box.box?.destination ?? "unassigned")}</div>
          <ul>${box.contents.map((i) => `<li>${esc(i.name)} ${i.importance === "essential" ? '<span class="chip red">essential</span>' : ""} <button class="small ghost" data-action="unpack-item" data-item="${esc(i.id)}">unpack</button></li>`).join("") || "<li class='faint'>empty</li>"}</ul>
          <div class="box-actions">
            <select data-role="assign-select" data-box="${esc(box.id)}">
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

function renderReview(): string {
  const pending = store.proposals("pending");
  const resolved = store.proposals(null).filter((p) => p.status !== "pending");
  return `<section data-testid="view-review">
    <div class="card" style="border-left:4px solid var(--accent)">
      <h3>Review inbox</h3>
      <div class="sub">Uncertain observations become proposals here. Only what you accept mutates the Place Graph — and every decision is ledgered.</div>
    </div>
    ${pending.map((p) => {
      const sourceObs = p.sourceObservationIds
        .map((oid) => store.state.observations.find((o) => o.id === oid))
        .find((o) => o?.photo);
      return `
      <div class="card proposal-card" data-testid="proposal-card" data-proposal="${esc(p.id)}">
        <div class="ptype">${esc(p.type.replace(/_/g, " "))}</div>
        <div class="psummary">${esc(p.summary)}</div>
        ${sourceObs?.photo ? `<img src="${esc(sourceObs.photo.dataUrl)}" alt="snapshot photo" data-testid="proposal-photo" style="max-height:96px;border-radius:8px;border:1px solid var(--line);margin:4px 0">` : ""}
        <ul class="proposal-ops">
          ${p.suggestedOps.map((op) => `<li>${esc(describeOp(op))}</li>`).join("")}
        </ul>
        <div class="faint">source: ${esc(p.sourceObservationIds.join(", ") || "manual")}</div>
        <div class="proposal-actions">
          ${p.needsPlace ? `<select data-role="proposal-place" data-proposal="${esc(p.id)}">${containerOptions()}</select>` : ""}
          <button class="primary" data-action="accept-proposal" data-id="${esc(p.id)}" data-testid="btn-accept">Accept</button>
          <button data-action="reject-proposal" data-id="${esc(p.id)}" data-testid="btn-reject">Reject</button>
        </div>
      </div>`;
    }).join("") || `<div class="card muted" data-testid="review-empty">Inbox clear. Snapshots, “not there” reports, and merge suggestions will land here.</div>`}
    ${resolved.length ? `<div class="section-title">Resolved</div>${resolved.slice(-5).reverse().map((p) => `<div class="card muted">${p.status === "accepted" ? "✓" : "✕"} ${esc(p.summary)} <span class="faint">${esc(p.status)}</span></div>`).join("")}` : ""}
  </section>`;
}

function describeOp(op: CommitOp): string {
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
    // Named explicitly rather than falling through: the default rendered a bare
    // "create operation" with no id and no name, so a Review card gave the person nothing
    // to judge before pressing Accept.
    case "create_operation": return `Start operation: ${op.operation.name}`;
    case "create_room": return `Add room: ${op.room.name}`;
    case "create_container": return `Add container: ${op.container.name}`;
    case "create_belonging": return `Add belonging: ${op.belonging.name}`;
    default: return op.type.replace(/_/g, " ");
  }
}

// ------------------------------------------------------------------- plan

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

  const furniture = store.catalog.furniture.map((f) => `
    <rect class="plan-furniture" x="${px(f.plan.x)}" y="${px(f.plan.y)}" width="${f.plan.w * S}" height="${f.plan.h * S}" rx="6"/>
    <text class="plan-furniture-label" x="${px(f.plan.x + 0.05)}" y="${px(f.plan.y + f.plan.h / 2 + 0.04)}">${esc(f.name)}</text>`).join("");

  // Room labels render after furniture (with a paper halo) so they stay legible.
  const roomLabels = rooms.map((r) => `
    <text class="plan-room-label" x="${px(r.plan.x + 0.12)}" y="${px(r.plan.y + 0.3)}">${esc(r.name)}</text>`).join("");

  const boxes = store.containersView().filter((c) => c.kind === "box").map((c, i) => {
    const room = store.state.rooms.get(c.parent.id) ?? rooms[0];
    if (!room) return "";
    const bx = room.plan.x + room.plan.w - 0.55 - (i % 3) * 0.45;
    const by = room.plan.y + room.plan.h - 0.5 - Math.floor(i / 3) * 0.45;
    const labelY = i % 2 === 0 ? by + 0.38 + 0.16 : by - 0.08; // alternate to avoid overlap
    return `<g data-action="open-container" data-id="${esc(c.id)}" style="cursor:pointer">
      <rect class="plan-box" x="${px(bx)}" y="${px(by)}" width="${0.38 * S}" height="${0.38 * S}" rx="4"/>
      <text class="plan-furniture-label" x="${px(bx + 0.02)}" y="${px(labelY)}">${esc((c.box?.label ?? c.name).slice(0, 12))}</text>
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
  return `<section data-testid="view-plan">
    <div class="spatial-head">
      <div><div class="eyebrow">One coordinate model · two ways to inspect it</div><h2>Spatial memory</h2><p>Use 3D to understand the room and 2D to inspect exact footprints. Both are projections of the Place Graph, not separate sources of truth.</p></div>
      <div class="segmented compact" role="tablist" aria-label="Spatial view">
        <button role="tab" aria-selected="${ui.planMode === "2d"}" class="${ui.planMode === "2d" ? "active" : ""}" data-action="plan-mode" data-mode="2d"><i data-lucide="map"></i>2D plan</button>
        <button role="tab" aria-selected="${ui.planMode === "3d"}" class="${ui.planMode === "3d" ? "active" : ""}" data-action="plan-mode" data-mode="3d"><i data-lucide="cuboid"></i>3D home</button>
      </div>
    </div>
    ${ui.planMode === "3d" ? `<div class="spatial-workspace">
      <div class="spatial-canvas" data-spatial-scene="home" data-testid="plan-3d" aria-label="Interactive 3D home">
        <div class="scene-label"><span class="live-dot"></span> Orbit · zoom · inspect</div>
      </div>
      <aside class="spatial-inspector">
        <div class="step-kicker">Home model</div>
        <h3>${rooms.length} rooms · ${store.catalog.furniture.length} anchors</h3>
        <div class="metric-stack"><div><strong>${roomArea.toFixed(1)} m²</strong><span>mapped footprint</span></div><div><strong>${store.containersView().length}</strong><span>containers</span></div><div><strong>${store.searchBelongings("").length}</strong><span>belongings</span></div></div>
        ${a?.ok ? `<div class="located-summary"><i data-lucide="map-pin"></i><span><strong>${esc(a.item)}</strong><small>${esc(a.chainText)} · confidence ${a.confidence.toFixed(2)}</small></span></div>` : `<div class="located-summary muted"><i data-lucide="search"></i><span>Locate an item to reveal its confidence halo.</span></div>`}
        <div class="layer-list"><span><i class="layer furniture"></i>Confirmed furniture</span><span><i class="layer box"></i>Moving boxes</span><span><i class="layer memory"></i>Located memory</span></div>
        <button data-action="nav" data-view="capture"><i data-lucide="scan-line"></i> Start a visual scan</button>
      </aside>
    </div>` : `<div class="plan-wrap">
      <svg class="plan-svg" viewBox="0 0 ${W} ${H}" data-testid="plan-svg" role="img" aria-label="2D floor plan">
        ${roomRects}${furniture}${roomLabels}${boxes}${pin}
      </svg>
      <div class="plan-legend">
        <span>▭ room</span><span>▤ furniture</span><span class="accent-text">▣ moving box</span>
        ${a?.ok ? `<span class="accent-text">● ${esc(a.item)} — ring size shows uncertainty</span>` : `<span>Locate something to drop a pin.</span>`}
      </div>
    </div>`}
    <div class="trust-note"><i data-lucide="shield-check"></i><span><strong>Semantic truth stays separate from geometry.</strong> A scan can propose a position or size, but only Review can commit a belonging or container relationship.</span></div>
  </section>`;
}

// ----------------------------------------------------------------- ledger

function renderLedger(): string {
  const commits = store.commitsView();
  return `<section data-testid="view-ledger">
    <div class="card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <h3 style="margin:0">Commit ledger</h3>
        <span class="chip neutral">${commits.length} commits</span>
        <span class="chip ${mode === "own" ? "accent" : "neutral"}">${mode === "own" ? "your home" : "demo home"}</span>
        <span style="flex:1"></span>
        <button data-action="ledger-export" data-testid="btn-export">Export JSON</button>
        <button data-action="ledger-import">Import JSON</button>
        <input type="file" id="import-file" accept="application/json" style="display:none">
        <button class="danger" data-action="ledger-reset" data-testid="btn-reset">Reset this home</button>
        ${mode === "own"
          ? `<button data-action="mode-switch" data-mode="demo" data-testid="btn-switch-demo">Switch to demo home</button>`
          : `<button data-action="mode-switch" data-mode="own" data-testid="btn-switch-own">Start my own home</button>`}
      </div>
      <div class="sub" style="margin-top:6px">Append-only history. Corrections contradict old records; nothing is silently overwritten. Each home mode keeps its own records.</div>
    </div>
    <div class="card">
      ${commits.map((c) => `
        <div class="commit-row" data-testid="commit-row">
          <div class="csummary">${esc(c.summary)}</div>
          <div class="faint">${esc(new Date(c.at).toLocaleString())} · ${esc(c.id)}${c.sourceProposalId ? ` · from ${esc(c.sourceProposalId)}` : ""}</div>
          <div class="cops">${c.ops.map((op) => `<span class="op-badge">${esc(op.type)}</span>`).join("")}</div>
        </div>`).join("") || `<div class="muted">No commits yet — everything you do lands here.</div>`}
    </div>
  </section>`;
}

// ----------------------------------------------------------------- modals

function renderModal(): string {
  if (!ui.modal) return "";
  if (ui.modal.type === "container") return containerModal(ui.modal.id);
  if (ui.modal.type === "item") return itemModal(ui.modal.id);
  return addBelongingModal();
}

function containerModal(id: string): string {
  const cc = store.containerContents(id);
  if (!cc) { ui.modal = null; return ""; }
  const c = cc.container;
  const isBox = c.kind === "box";
  const boxStatus = c.boxStatus;
  return `<div class="modal-overlay" data-action="close-modal-overlay">
    <div class="modal" data-testid="container-modal">
      <div class="modal-head">
        <div>
          <h3>${esc(c.name)}</h3>
          <div class="muted">${esc(c.kind)}${isBox && c.box?.destination ? ` → ${esc(c.box.destination)}` : ""} · ${cc.stale ? `<span class="chip amber">stale · confirmed ${daysLabel(cc.daysSinceConfirmed)}</span>` : `<span class="chip sage">confirmed ${daysLabel(cc.daysSinceConfirmed)}</span>`}</div>
        </div>
        <button class="close" data-action="close-modal">✕</button>
      </div>
      ${cc.unknownNote ? `<div class="card" style="box-shadow:none;border-color:var(--amber);background:var(--amber-soft);margin-bottom:10px"><span class="muted" style="color:var(--amber)">${esc(cc.unknownNote)}</span></div>` : ""}
      <div class="row-list">
        ${cc.items.map((v) => `
          <div class="row">
            <div class="grow"><div class="name">${esc(v.name)}</div><div class="place">default: ${esc(v.defaultHomeText)}</div></div>
            ${stateChip(v.state)}
            <button class="small ghost" data-action="locate-item" data-id="${esc(v.id)}">Locate</button>
            ${isBox ? `<button class="small" data-action="unpack-item" data-item="${esc(v.id)}">Unpack</button>` : ""}
          </div>`).join("") || `<div class="muted">No recorded contents.</div>`}
      </div>
      <div style="margin-top:14px">
        <label class="faint" style="display:block;margin-bottom:4px">Container snapshot — type what you can see (comma-separated). It becomes a reviewable proposal, not truth.</label>
        <textarea id="snapshot-text" placeholder="e.g. charger, gym card, coins" data-testid="snapshot-input"></textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
          <input type="file" id="snapshot-photo" accept="image/*" data-role="snapshot-photo" style="max-width:230px">
          ${ui.pendingSnapshotPhoto
            ? `<img src="${esc(ui.pendingSnapshotPhoto.dataUrl)}" alt="snapshot preview" data-testid="snapshot-photo-preview" style="height:48px;border-radius:8px;border:1px solid var(--line)"><button class="small ghost" data-action="clear-snapshot-photo">remove photo</button>`
            : `<span class="faint">optional photo — stored as evidence, never auto-recognized</span>`}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="primary" data-action="snapshot-submit" data-id="${esc(c.id)}" data-testid="btn-snapshot">Create snapshot proposal</button>
          <button data-action="confirm-container" data-id="${esc(c.id)}">Contents match — confirm</button>
          ${isBox ? `<select data-action="box-status" data-box="${esc(c.id)}">${BOX_STATUSES.map((s) => `<option value="${s}" ${s === boxStatus ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}
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
    <div class="modal" data-testid="item-modal">
      <div class="modal-head">
        <div><h3>${esc(v.name)}</h3><div class="muted">${v.kinds.map((k) => `<span class="chip neutral">${esc(k)}</span>`).join(" ")}</div></div>
        <button class="close" data-action="close-modal">✕</button>
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
        <select data-role="move-select" data-item="${esc(v.id)}">${containerOptions(v.placement?.placeRef.id ?? null)}</select>
        <button data-action="item-move" data-id="${esc(v.id)}" data-testid="btn-move-item">Move here</button>
        <select data-action="item-state" data-id="${esc(v.id)}">${LIFECYCLE_STATES.map((s) => `<option value="${s}" ${s === v.state ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`).join("")}</select>
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
    <div class="modal" data-testid="add-belonging-modal">
      <div class="modal-head"><h3>Add belonging</h3><button class="close" data-action="close-modal">✕</button></div>
      <div class="form-grid">
        <div class="full"><label>Name</label><input type="text" id="nb-name" placeholder="e.g. Kindle"></div>
        <div><label>Kinds / tags (comma)</label><input type="text" id="nb-kinds" placeholder="e-reader, electronics"></div>
        <div><label>Importance</label><select id="nb-importance" style="width:100%"><option value="normal">normal</option><option value="high">high</option><option value="essential">essential</option></select></div>
        <div><label>Default home</label><select id="nb-default" style="width:100%">${containerOptions(null, { includeBoxes: false })}</select></div>
        <div><label>Current place</label><select id="nb-current" style="width:100%"><option value="">same as default</option>${containerOptions(null)}</select></div>
        <div class="full"><label>Dimensions in cm (optional)</label><div class="field-row dimensions"><input type="number" id="nb-width" min="1" placeholder="width"><input type="number" id="nb-depth" min="1" placeholder="depth"><input type="number" id="nb-height" min="1" placeholder="height"></div></div>
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

function doLocate(query: string): void {
  if (!query.trim()) return;
  ui.lastAnswer = store.locate(query.trim());
  if (ui.view !== "home" && ui.view !== "plan") ui.view = "home";
  render();
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
    case "nav": if (isViewId(t.dataset.view)) { ui.view = t.dataset.view; ui.modal = null; render(); } break;
    case "capture-mode": {
      const next = t.dataset.mode;
      if (next === "room" || next === "container" || next === "product") { ui.captureMode = next; render(); }
      break;
    }
    case "plan-mode": {
      const next = t.dataset.mode;
      if (next === "2d" || next === "3d") { ui.planMode = next; render(); }
      break;
    }
    case "run-room-scan": {
      ui.scanDraft = buildScanDraft(Math.max(20, inputNumber("scan-anchor") || 140));
      toast("Visual draft ready — inspect every candidate before Review.");
      render();
      break;
    }
    case "scan-decision": {
      const decision = t.dataset.decision;
      const proposal = ui.scanDraft?.proposals.find((p) => p.id === t.dataset.id);
      if (proposal && (decision === "accepted" || decision === "rejected")) {
        proposal.decision = proposal.decision === decision ? "pending" : decision;
        proposal.object.proposalState = proposal.decision;
        render();
      }
      break;
    }
    case "scan-send-review": {
      const containerId = inputValue("scan-target-container");
      const labels = ui.scanDraft?.proposals.filter((p) => p.kind === "item" && p.decision === "accepted").map((p) => p.label.split(" · ")[0]) ?? [];
      if (!containerId || !labels.length) { toast("Accept at least one item candidate first."); break; }
      const out = act(() => store.snapshotContainer(containerId, labels.join(", "), ui.scanMedia), "Scan observations sent to Review — memory is unchanged until acceptance.");
      if (out) { ui.view = "review"; ui.scanMedia = null; render(); }
      break;
    }
    case "capture-container-submit": {
      const containerId = inputValue("capture-container");
      const seen = inputValue("capture-container-text").trim();
      if (!seen) { toast("Describe what is visible so the photo has a reviewable claim."); break; }
      const out = act(() => store.snapshotContainer(containerId, seen, ui.scanMedia), "Container snapshot created as a Review proposal.");
      if (out) { ui.scanMedia = null; ui.view = "review"; render(); }
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
      }), "Product added with normalized dimensions.");
      if (out) { ui.view = "belongings"; render(); }
      break;
    }
    case "top-locate": doLocate(inputValue("top-search-input")); break;
    case "hero-locate": doLocate(inputValue("hero-search-input")); break;
    case "ask-send": doAsk(inputValue("ask-input")); break;
    case "answer-not-there": {
      const itemId = t.dataset.item;
      if (!itemId) break;
      const out = act(() => store.markNotThere(itemId), "Correction opened in Review — nothing was silently overwritten.");
      if (out) { ui.lastAnswer = store.locateById(itemId); ui.view = "review"; ui.modal = null; render(); }
      break;
    }
    case "answer-show-plan": ui.view = "plan"; render(); break;
    case "open-container": if (t.dataset.id) { ui.modal = { type: "container", id: t.dataset.id }; ui.pendingSnapshotPhoto = null; render(); } break;
    case "open-item": if (t.dataset.id) { ui.modal = { type: "item", id: t.dataset.id }; render(); } break;
    case "open-add-belonging": ui.modal = { type: "add-belonging" }; render(); break;
    case "close-modal": ui.modal = null; ui.pendingSnapshotPhoto = null; render(); break;
    case "close-modal-overlay": if (e.target === t) { ui.modal = null; ui.pendingSnapshotPhoto = null; render(); } break;
    case "clear-snapshot-photo": ui.pendingSnapshotPhoto = null; render(); break;
    case "confirm-container": if (t.dataset.id) act(() => store.confirmContainer(t.dataset.id as string), "Container confirmed — freshness updated."); break;
    case "snapshot-submit": {
      const containerId = t.dataset.id;
      const text = inputValue("snapshot-text").trim();
      if (containerId && text) {
        const photo = ui.pendingSnapshotPhoto;
        act(() => store.snapshotContainer(containerId, text, photo), "Snapshot recorded as a proposal — review it in the inbox.");
        ui.pendingSnapshotPhoto = null;
        ui.modal = null;
        render();
      } else if (!text) {
        toast("Type what you can see first — the photo alone is evidence, not recognition.");
      }
      break;
    }
    case "item-move": {
      const itemId = t.dataset.id;
      if (!itemId) break;
      const sel = document.querySelector<HTMLSelectElement>(`select[data-role="move-select"][data-item="${itemId}"]`);
      if (sel?.value) act(() => store.correctPlacement(itemId, { type: "container", id: sel.value }), "Placement corrected — old record kept in history.");
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
      if (out) { ui.modal = null; render(); }
      break;
    }
    case "setup-add-room": {
      const name = t.dataset.name;
      if (name) act(() => store.createRoom({ name }), `Room added: ${name}`);
      break;
    }
    case "setup-add-room-custom": {
      const name = inputValue("setup-room-name").trim();
      if (name) act(() => store.createRoom({ name }), `Room added: ${name}`);
      break;
    }
    case "setup-add-container": {
      const roomId = inputValue("setup-container-room");
      const kindRaw = inputValue("setup-container-kind");
      const kind = (CONTAINER_KIND_OPTIONS as readonly string[]).includes(kindRaw) ? kindRaw as (typeof CONTAINER_KIND_OPTIONS)[number] : "box";
      const name = inputValue("setup-container-name").trim() || `${kind[0]?.toUpperCase()}${kind.slice(1)}`;
      if (roomId) act(() => store.createContainer({ name, kind, roomId }), `Container added: ${name}`);
      break;
    }
    case "setup-add-belonging": {
      const name = inputValue("setup-item-name").trim();
      const kinds = inputValue("setup-item-tags").split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
      const containerId = inputValue("setup-item-container");
      const importanceRaw = inputValue("setup-item-importance");
      const importance = importanceRaw === "essential" || importanceRaw === "high" ? importanceRaw : "normal";
      if (name && containerId) {
        act(() => store.createBelonging({ name, kinds, importance, defaultHome: { type: "container", id: containerId } }), `Added ${name}.`);
      }
      break;
    }
    case "start-op": {
      const template = t.dataset.template;
      if (!template) break;
      const opId = act(() => store.startOperation(template), "Operation started.");
      if (opId) { ui.openOpId = opId; ui.view = "operations"; render(); }
      break;
    }
    case "open-op": if (t.dataset.id) { ui.openOpId = t.dataset.id; ui.view = "operations"; render(); } break;
    case "close-op-detail": ui.openOpId = null; render(); break;
    case "finish-op": if (t.dataset.id) { act(() => store.setOperationStatus(t.dataset.id as string, "done"), "Operation finished."); ui.openOpId = null; } break;
    case "create-box": {
      const label = inputValue("new-box-label");
      const dest = inputValue("new-box-dest");
      act(() => store.createBox({ label, destination: dest, operationId: t.dataset.op ?? null }), "Box created.");
      break;
    }
    case "assign-box": {
      const boxId = t.dataset.box;
      if (!boxId) break;
      const sel = document.querySelector<HTMLSelectElement>(`select[data-role="assign-select"][data-box="${boxId}"]`);
      if (sel?.value) act(() => store.assignToBox(sel.value, boxId), "Packed — placement and state ledgered.");
      break;
    }
    case "unpack-item": if (t.dataset.item) act(() => store.unpackItem(t.dataset.item as string), "Unpacked to default home."); break;
    case "box-search": ui.boxQuery = inputValue("box-search-input"); render(); break;
    case "locate-item": if (t.dataset.id) { ui.lastAnswer = store.locateById(t.dataset.id); ui.view = "home"; ui.modal = null; render(); } break;
    case "accept-proposal": {
      const pid = t.dataset.id;
      if (!pid) break;
      const sel = document.querySelector<HTMLSelectElement>(`select[data-role="proposal-place"][data-proposal="${pid}"]`);
      const extra = sel?.value ? { placeRef: { type: "container" as const, id: sel.value } } : {};
      act(() => store.acceptProposal(pid, extra), "Accepted — committed to the Place Graph.");
      break;
    }
    case "reject-proposal": if (t.dataset.id) act(() => store.rejectProposal(t.dataset.id as string), "Rejected — decision ledgered."); break;
    case "belongings-filter": {
      const f = t.dataset.state ?? "";
      ui.stateFilter = (LIFECYCLE_STATES as readonly string[]).includes(f) ? (f as LifecycleState) : "";
      render();
      break;
    }
    case "ledger-export": {
      const blob = new Blob([JSON.stringify(store.exportJson(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nestory-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      break;
    }
    case "ledger-import": document.getElementById("import-file")?.click(); break;
    case "ledger-reset": {
      if (window.confirm("Reset this home's memory? Current records will be replaced with its starting state.")) {
        act(() => store.reset(), "Reset done.");
      }
      break;
    }
    default: break;
  }
});

document.addEventListener("change", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const t = target?.closest<HTMLElement>("[data-action]");
  if (t instanceof HTMLSelectElement) {
    switch (t.dataset.action) {
      case "row-status":
        if (t.dataset.op && t.dataset.row && (ROW_STATUSES as readonly string[]).includes(t.value)) {
          act(() => store.setRowStatus(t.dataset.op as string, t.dataset.row as string, t.value as RowStatus), null);
        }
        break;
      case "box-status":
        if (t.dataset.box && (BOX_STATUSES as readonly string[]).includes(t.value)) {
          act(() => store.setBoxStatus(t.dataset.box as string, t.value as BoxStatus), null);
        }
        break;
      case "item-state":
        if (t.dataset.id && (LIFECYCLE_STATES as readonly string[]).includes(t.value)) {
          act(() => store.setItemState(t.dataset.id as string, t.value as LifecycleState), null);
        }
        break;
      default: break;
    }
  }
  if (target instanceof HTMLInputElement && target.dataset.role === "snapshot-photo") {
    const file = target.files?.[0];
    if (!file) return;
    void downscalePhoto(file)
      .then((photo) => { ui.pendingSnapshotPhoto = photo; render(); })
      .catch(() => toast("⚠ Could not read that image."));
    return;
  }
  if (target instanceof HTMLInputElement && (target.dataset.role === "room-scan-media" || target.dataset.role === "capture-photo")) {
    const file = target.files?.[0];
    if (!file) return;
    void downscalePhoto(file, 960)
      .then((photo) => { ui.scanMedia = photo; ui.scanDraft = null; render(); })
      .catch(() => toast("Could not read that image."));
    return;
  }
  if (target instanceof HTMLInputElement && target.id === "import-file") {
    const file = target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        store.importJson(JSON.parse(String(reader.result)));
        toast("Imported.");
      } catch (err) {
        toast(`⚠ ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
  }
});

document.addEventListener("input", (e) => {
  const target = e.target instanceof HTMLInputElement ? e.target : null;
  if (target?.dataset.input === "belongings-query") {
    ui.belongingsQuery = target.value;
    const pos = target.selectionStart ?? target.value.length;
    render();
    const again = document.getElementById("belongings-search");
    if (again instanceof HTMLInputElement) { again.focus(); again.setSelectionRange(pos, pos); }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const target = e.target instanceof HTMLInputElement ? e.target : null;
  if (!target) return;
  const enter = target.dataset.enter;
  if (enter === "top-locate" || enter === "hero-locate") doLocate(target.value);
  if (enter === "ask-send") doAsk(target.value);
  if (enter === "box-search") { ui.boxQuery = target.value; render(); }
  if (enter === "setup-add-room-custom" || enter === "setup-add-container" || enter === "setup-add-belonging") {
    const btn = document.querySelector<HTMLElement>(`[data-action="${enter}"]`);
    btn?.click();
  }
});

store.subscribe(() => render());

// ------------------------------------------------- verification interface

export interface NestoryHooks {
  store: Store;
  ui: UIState;
  agent: AgentToolkit;
  mode: HomeMode | null;
  chooseMode(m: HomeMode): void;
  setView(v: ViewId): void;
  locate(q: string): LocateAnswer;
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
  setView(v) { ui.view = v; ui.modal = null; render(); },
  locate(q) { ui.lastAnswer = store.locate(q); render(); return ui.lastAnswer; },
  ask(q) { ui.view = "ask"; ui.modal = null; return doAsk(q); },
  openContainer(id) { ui.modal = { type: "container", id }; render(); },
  openItem(id) { ui.modal = { type: "item", id }; render(); },
  openOperation(id) { ui.openOpId = id; ui.view = "operations"; render(); },
  render,
  version: "v2.5-ts"
};

render();
