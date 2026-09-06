// Nestory V2 store: an event-sourced Place Graph.
// Catalog (data.ts) + append-only records -> derived current state.
// The only mutation path is appending records; commits carry typed ops.
// Runs in the browser and in Node (verify.ts imports it directly).
// The public surface implements the Store interface in types.ts.

import type {
  ActivationSummary, AnyRecord, AttentionSummary, BelongingEntity, BelongingView, BoxStatus, Catalog,
  CommitOp, CommitRecord, ContainerContentsView, ContainerEntity, ContainerView,
  ContainerWithContentsView, CreateBelongingInput, CreateBoxInput, CreateContainerInput,
  CreateRoomInput, DerivedState, Dimensions3D,
  EvidenceKind, EvidenceRecord, ExportDump, Kit, KitReadiness, KitRow, KitRowView,
  LifecycleState, LocateAnswer, LocateSuccess, MoveReadiness, ObservationRecord,
  OperationData, OperationStatus, OperationView, PhotoMedia, PlaceNode, PlacementSlot, PlacementView, PlaceRef,
  PlanPin, PlanRect, ProposalRecord, ProposalStatus, ProposalView, Relation, RetrievalPlanGroup,
  RetrievalPlanItem, Room, RowStatus,
  ScoredBelongingView, StorageLike, StorageRecovery, Store, StoreOptions, UnpackPriorityEntry,
  WhichContainerHit
} from "./types.ts";
import { BOX_STATUSES, IMPORTANCE_SCORE, LIFECYCLE_STATES, OPERATION_STATUSES, ROW_STATUSES } from "./types.ts";
import { validatedLedgerRecords, validateLedgerSemantics } from "./ledger-validation.ts";

const DAY = 24 * 60 * 60 * 1000;

const RELATION_PHRASE: Record<Relation, string> = {
  inside: "in", on_surface: "on", under: "under", attached_to: "attached to", near: "near"
};

const UNAVAILABLE_STATES: readonly LifecycleState[] = ["laundry", "drying", "lent_out", "missing", "in_transit"];

export function createStore(options: StoreOptions): Store {
  const {
    catalog,
    seedFactory,
    now = () => Date.now(),
    storage = defaultStorage(),
    persistKey = "nestory-v2"
  } = options;

  const quarantineKey = `${persistKey}-unreadable`;
  // Set by loadRecords BEFORE the first `records` assignment below, so it is already
  // accurate by the time anything can observe it.
  let recovery: StorageRecovery | null = null;

  let records: AnyRecord[] = loadRecords();
  let seq = records.length;
  const listeners = new Set<(state: DerivedState) => void>();
  let state: DerivedState = derive();

  function seedRecords(): AnyRecord[] {
    return seedFactory ? seedFactory() : [];
  }

  // Stored state is UNTRUSTED input, exactly like an imported file: the bytes in
  // localStorage can be stale, hand-edited, or written by an older build. Before this
  // gate they were replayed unchecked, and `derive()` runs AFTER loadRecords returns,
  // so loadRecords' own try/catch could not contain the damage. Two failure modes were
  // reproduced on the shipped build: an unreadable record threw during derive and left
  // the app permanently unbootable (the bad bytes stay in storage, so every reload
  // crashes again), and a shape-perfect record naming a place that does not exist
  // booted fine and then answered "Passport is probably in the ." — fabricating a
  // location, which the product contract forbids.
  //
  // So the same two passes that guard `importJson` guard this boundary. What differs is
  // the FAILURE BEHAVIOUR. An import is a deliberate act that can be refused and
  // retried; a boot cannot. Refusing here would replace a crash with a different
  // unbootable state, so an unreadable ledger degrades to a usable home instead:
  //
  //   - the raw bytes are COPIED to a quarantine key, never deleted or rewritten;
  //   - the original key is left exactly as found (nothing persists until the person
  //     makes their own first write), so the evidence survives this boot;
  //   - the store starts from the seed so the app is usable;
  //   - `storageRecovery()` reports what happened, so the interface can disclose it
  //     rather than pretending a fresh home was always there.
  //
  // This never repairs by deletion: no `reset()`, no `removeItem`, no rewrite of the
  // unreadable value. Recovering the original data stays possible after the fact.
  function loadRecords(): AnyRecord[] {
    // A quarantine copy from an EARLIER boot must still be disclosed. Once the person
    // writes anything the live key becomes readable again, so every later boot would
    // look ordinary while their unreadable original sat in storage unmentioned by any
    // surface and unreclaimable. Noted first, then overwritten below if THIS boot also
    // fails — the current failure is the more useful thing to report.
    if (storage) {
      let held: string | null = null;
      try { held = storage.getItem(quarantineKey); } catch { held = null; }
      if (held !== null) {
        recovery = {
          reason: "An earlier saved home memory could not be read, and was kept aside.",
          originalKey: persistKey,
          preservedAt: quarantineKey,
          originalBytes: held.length,
          recoveredAt: new Date(now()).toISOString(),
          seededThisBoot: false,
          savingBlocked: false
        };
        recovery = { ...recovery, savingBlocked: !savingIsPossible() };
      }
    }
    if (storage) {
      let raw: string | null = null;
      try { raw = storage.getItem(persistKey); } catch { return seedRecords(); }
      if (raw) {
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch {
          return quarantine(raw, "Your saved home memory could not be read (it is not valid JSON).");
        }
        const storedRecords = parsed && typeof parsed === "object"
          ? (parsed as { records?: unknown }).records : undefined;
        // An empty or absent array falls through to the seed exactly as before this
        // gate: that is a separate, already-recorded question about what an empty
        // ledger should mean, and it is deliberately not decided here.
        if (Array.isArray(storedRecords) && storedRecords.length) {
          try {
            const valid = validatedLedgerRecords(parsed, "Saved home memory");
            validateLedgerSemantics(valid, catalog);
            return valid;
          } catch (err) {
            return quarantine(raw, err instanceof Error ? err.message : String(err));
          }
        }
      }
    }
    return seedRecords();
  }

  // Copy the unreadable value aside and record why. Purely additive: the original key
  // is not touched here. If the copy itself fails (quota, private mode) the original is
  // still in place, so the notice says so rather than claiming a copy that does not exist.
  //
  // An existing quarantine copy is NEVER overwritten. Once a boot has recovered, the live
  // key fills with seed-derived writes as the person carries on using the app, so a LATER
  // corruption would otherwise clobber the only surviving copy of their real data with
  // something worthless — silent, permanent loss, and exactly what this slice exists to
  // prevent. First copy wins; later ones report the one already held.
  function quarantine(raw: string, reason: string): AnyRecord[] {
    let preservedAt: string | null = null;
    let preservedBytes = 0;
    try {
      // Two slots, in order. An earlier copy is NEVER overwritten — it is the more
      // likely to hold real work — but this original still needs somewhere to go, or
      // writes would be blocked forever to protect it. If both slots are taken by
      // different originals, no copy is claimed: the notice must not point the person
      // at bytes that are not theirs.
      for (const slot of [quarantineKey, `${quarantineKey}-2`]) {
        const held = storage?.getItem(slot) ?? null;
        if (held === raw) { preservedAt = slot; preservedBytes = raw.length; break; }
        if (held === null) {
          storage?.setItem(slot, raw);
          preservedAt = slot;
          preservedBytes = raw.length;
          break;
        }
      }
    } catch { preservedAt = null; preservedBytes = 0; }
    recovery = {
      reason,
      originalKey: persistKey,
      preservedAt,
      // Describes whatever is actually AT preservedAt, not the value that failed.
      originalBytes: preservedAt ? preservedBytes : raw.length,
      recoveredAt: new Date(now()).toISOString(),
      seededThisBoot: true,
      savingBlocked: false
    };
    // Answer honestly from the start: if saving is already impossible, say so now
    // rather than after the person's first write has been silently discarded.
    recovery = { ...recovery, savingBlocked: !savingIsPossible() };
    return seedRecords();
  }

  // Persisting after a recovery must not destroy the ledger the recovery preserved.
  // The person's next ordinary write would otherwise overwrite `persistKey` — and when
  // the quarantine copy failed (quota, the likeliest cause of a truncated ledger in the
  // first place) that key holds their ONLY copy. The banner would be promising
  // recoverability while the product deleted the thing to be recovered.
  //
  // So while a recovery is unresolved, the last-resort copy is secured BEFORE the live
  // key is overwritten. If it cannot be secured, the live key is left alone and the
  // session's writes stay in memory: losing this session's edits is recoverable, losing
  // the person's whole home memory is not.
  function persist(): void {
    if (!storage) return;
    if (recovery && !securedBeforeOverwrite()) {
      // Refusing to write is right — overwriting `persistKey` here would destroy the
      // person's only copy — but it must never look like success. Recorded so the
      // interface can say plainly that changes are not being saved.
      recovery = { ...recovery, savingBlocked: true };
      return;
    }
    try {
      storage.setItem(persistKey, JSON.stringify({ version: 2, records }));
      if (recovery?.savingBlocked) recovery = { ...recovery, savingBlocked: false };
    } catch {
      // The write was rejected — quota, private mode, a full disk. Previously ignored,
      // which meant the session went on reporting success while nothing was saved. When
      // a recovery is already being disclosed, correct that disclosure rather than let
      // it claim saving works. (Outside a recovery there is no notice to correct; that
      // is a separate gap, deliberately not widened here.)
      if (recovery) recovery = { ...recovery, savingBlocked: true };
    }
  }

  // True once the unreadable original is safely held somewhere other than `persistKey`.
  // Retries the copy each time, because the quota that blocked it may have since eased.
  // If the quarantine key is already occupied by an EARLIER, different original, this
  // one has nowhere safe to go: a second key would be a second thing to explain, and
  // overwriting the older copy is the data loss this whole path exists to prevent. So it
  // reports failure, and `persist()` leaves the live key alone — this session's edits stay
  // in memory. Losing a session's edits is recoverable; losing a home memory is not.
  function securedBeforeOverwrite(): boolean {
    if (!storage || !recovery) return true;
    if (recovery.preservedAt) return true;
    let original: string | null = null;
    try { original = storage.getItem(persistKey); } catch { return false; }
    if (original === null) return true;          // nothing left to protect
    try {
      // The primary slot may hold an EARLIER original, which must not be overwritten.
      // A single secondary slot breaks what would otherwise be a permanent deadlock:
      // writes blocked forever, so the live key never becomes readable, so the block
      // never lifts. Two slots is the bound — more would be unexplainable to the person.
      for (const slot of [quarantineKey, `${quarantineKey}-2`]) {
        const held = storage.getItem(slot);
        if (held === original) { recovery = { ...recovery, preservedAt: slot, originalBytes: original.length }; return true; }
        if (held === null) {
          storage.setItem(slot, original);
          recovery = { ...recovery, preservedAt: slot, originalBytes: original.length };
          return true;
        }
      }
      return false;
    } catch { return false; }                    // still no room: keep the original
  }

  // Whether saving is possible RIGHT NOW, asked without writing anything. `persist()`
  // learns this by trying and failing, which is one write too late: the person had
  // already been told "Room added" for work that was never saved. This asks the same
  // question read-only, so the warning can be shown at boot, before the first write.
  //
  // It is a pure probe on purpose. It must not create the quarantine copy as a side
  // effect — that is `persist()`'s decision at the moment of an actual write, and
  // copying here would change storage merely because the app was opened.
  //
  // KNOWN LIMIT, and the reason this is a prediction rather than a guarantee: a
  // read-only probe cannot know that `setItem` will throw. If storage is out of quota
  // the slot looks free, this returns true, and the refusal is only discovered by
  // `persist()` — which then sets `savingBlocked` and the notice appears, exactly as it
  // did before this change. So the boot answer is exact for storage that accepts writes
  // and degrades to the previous on-write warning for storage that does not; it is never
  // worse than what it replaced. Locked below with a throwing-`setItem` fixture so the
  // boundary is visible rather than discovered later.
  function savingIsPossible(): boolean {
    if (!storage || !recovery) return true;
    if (recovery.preservedAt) return true;       // the original is already safe elsewhere
    let original: string | null = null;
    try { original = storage.getItem(persistKey); } catch { return false; }
    if (original === null) return true;          // nothing left to protect
    try {
      // Free or already-ours counts as room; the same two-slot bound as the writer. Both
      // slots are load-bearing here: `quarantine()`'s copy can itself FAIL (a throwing
      // `setItem`), which leaves `preservedAt` null with a slot still free, and this loop
      // is then the only thing that finds it.
      for (const slot of [quarantineKey, `${quarantineKey}-2`]) {
        const held = storage.getItem(slot);
        if (held === null || held === original) return true;
      }
    } catch { return false; }
    return false;                                // both slots hold other originals
  }

  function notify(): void {
    state = derive();
    for (const fn of listeners) fn(state);
  }

  function id(prefix: string): string {
    seq += 1;
    return `${prefix}-${seq.toString(36)}-${Math.floor(Math.random() * 46655).toString(36)}`;
  }

  function nowIso(): string { return new Date(now()).toISOString(); }

  function append<T extends AnyRecord>(record: T): T {
    records.push(record);
    return record;
  }

  function appendEvidence(kind: EvidenceKind, summary: string): EvidenceRecord {
    return append({ recordType: "evidence", id: id("ev"), kind, summary, at: nowIso() });
  }

  function appendCommit(input: { summary: string; ops: CommitOp[]; sourceProposalId?: string | null; sourceObservationIds?: string[] }): CommitRecord {
    const commit = append<CommitRecord>({
      recordType: "commit", id: id("commit"), at: nowIso(),
      summary: input.summary, ops: input.ops,
      sourceProposalId: input.sourceProposalId ?? null,
      sourceObservationIds: input.sourceObservationIds ?? []
    });
    persist();
    notify();
    return commit;
  }

  // ---------------------------------------------------------------- derive

  function derive(): DerivedState {
    const rooms = new Map<string, Room>();
    const belongings = new Map<string, BelongingEntity>();
    const containers = new Map<string, ContainerEntity>();
    const evidence = new Map<string, EvidenceRecord>();
    const observations: ObservationRecord[] = [];
    const proposalMap = new Map<string, ProposalView>();
    const operations = new Map<string, OperationData>();
    const commits: CommitRecord[] = [];
    const placements = new Map<string, PlacementSlot>();
    const states = new Map<string, { state: LifecycleState; at: string }>();
    const negatives = new Map<string, string>();

    for (const r of catalog.rooms) rooms.set(r.id, { ...r });
    for (const b of catalog.belongings) belongings.set(b.id, { ...b, createdBySeed: true });
    for (const c of catalog.containers) containers.set(c.id, { ...c, boxStatus: null, lastConfirmedAt: null, createdBySeed: true });

    const ensurePlacement = (itemId: string): PlacementSlot => {
      let slot = placements.get(itemId);
      if (!slot) { slot = { active: null, history: [] }; placements.set(itemId, slot); }
      return slot;
    };

    for (const rec of records) {
      if (rec.recordType === "evidence") { evidence.set(rec.id, rec); continue; }
      if (rec.recordType === "observation") {
        observations.push(rec);
        if (rec.type === "not_there_report" && rec.itemId) negatives.set(rec.itemId, rec.at);
        continue;
      }
      if (rec.recordType === "proposal") {
        proposalMap.set(rec.id, { ...rec, status: "pending", resolvedBy: null });
        continue;
      }

      commits.push(rec);
      for (const op of rec.ops) {
        switch (op.type) {
          case "create_belonging": {
            belongings.set(op.belonging.id, { ...op.belonging, createdAt: rec.at });
            break;
          }
          case "create_room": {
            rooms.set(op.room.id, { ...op.room });
            break;
          }
          case "create_container": {
            containers.set(op.container.id, {
              ...op.container,
              boxStatus: op.container.kind === "box" ? "empty" : null,
              lastConfirmedAt: rec.at,
              createdAt: rec.at
            });
            break;
          }
          case "create_placement": {
            if (!op.placeRef) break; // proposal placeholder; commits are validated upstream
            const slot = ensurePlacement(op.itemId);
            const view: PlacementView = {
              id: `${rec.id}#${op.itemId}`,
              itemId: op.itemId,
              placeRef: op.placeRef,
              relation: op.relation,
              confidence: op.confidence,
              at: rec.at,
              evidenceIds: op.evidenceIds ?? [],
              commitId: rec.id,
              contradictedAt: null,
              contradictedReason: null
            };
            if (slot.active) {
              // A newer placement implicitly supersedes without erasing history.
              slot.active.supersededAt = rec.at;
            }
            slot.history.push(view);
            slot.active = view;
            break;
          }
          case "contradict_placement": {
            const slot = ensurePlacement(op.itemId);
            if (slot.active) {
              slot.active.contradictedAt = rec.at;
              slot.active.contradictedReason = op.reason ?? "contradicted";
              slot.active = null;
            }
            break;
          }
          case "set_state": {
            states.set(op.itemId, { state: op.state, at: rec.at });
            break;
          }
          case "set_box_status": {
            const box = containers.get(op.boxId);
            if (box) { box.boxStatus = op.status; box.boxStatusAt = rec.at; }
            break;
          }
          case "confirm_container": {
            const c = containers.get(op.containerId);
            if (c) c.lastConfirmedAt = rec.at;
            break;
          }
          case "create_operation": {
            operations.set(op.operation.id, { ...op.operation, rows: (op.operation.rows ?? []).map((r) => ({ ...r })) });
            break;
          }
          case "set_op_row_status": {
            const oper = operations.get(op.opId);
            const row = oper?.rows?.find((r) => r.id === op.rowId);
            if (row) {
              row.status = op.status;
              if (op.note !== undefined) row.note = op.note;
              row.updatedAt = rec.at;
            }
            break;
          }
          case "set_op_status": {
            const oper = operations.get(op.opId);
            if (oper) oper.status = op.status;
            break;
          }
          case "merge_belongings": {
            const merged = belongings.get(op.mergeId);
            const keep = belongings.get(op.keepId);
            if (merged) { merged.mergedInto = op.keepId; merged.mergedAt = rec.at; }
            if (keep && merged) {
              keep.kinds = Array.from(new Set([...keep.kinds, ...merged.kinds]));
            }
            break;
          }
          case "accept_proposal": {
            const p = proposalMap.get(op.proposalId);
            if (p) { p.status = "accepted"; p.resolvedBy = rec.id; p.resolvedAt = rec.at; }
            break;
          }
          case "reject_proposal": {
            const p = proposalMap.get(op.proposalId);
            if (p) { p.status = "rejected"; p.resolvedBy = rec.id; p.resolvedAt = rec.at; p.rejectReason = op.reason ?? null; }
            break;
          }
          case "reset_to_seed":
            break;
        }
      }
    }

    // Shared-item flags across active kit operations.
    const activeKitOps = [...operations.values()].filter((o) => o.type === "kit" && o.status === "active");
    const itemUse = new Map<string, string[]>();
    for (const op of activeKitOps) {
      for (const row of op.rows ?? []) {
        if (!row.itemId) continue;
        const users = itemUse.get(row.itemId) ?? [];
        users.push(op.id);
        itemUse.set(row.itemId, users);
      }
    }
    for (const op of activeKitOps) {
      for (const row of op.rows ?? []) {
        const users = row.itemId ? itemUse.get(row.itemId) : undefined;
        row.sharedWith = users && users.length > 1 ? users.filter((u) => u !== op.id) : [];
      }
    }

    return { rooms, belongings, containers, evidence, observations, proposals: [...proposalMap.values()], operations, commits, placements, states, negatives };
  }

  // ------------------------------------------------------------- resolvers

  function roomOf(roomId: string): Room | null { return state.rooms.get(roomId) ?? null; }
  function furnitureOf(furnitureId: string) { return catalog.furniture.find((f) => f.id === furnitureId) ?? null; }
  function containerOf(containerId: string): ContainerEntity | null { return state.containers.get(containerId) ?? null; }
  function belongingOf(itemId: string): BelongingEntity | null { return state.belongings.get(itemId) ?? null; }

  function placeNode(ref: PlaceRef): PlaceNode | null {
    if (ref.type === "room") {
      const r = roomOf(ref.id);
      return r ? { type: "room", id: r.id, name: r.name } : null;
    }
    if (ref.type === "furniture") {
      const f = furnitureOf(ref.id);
      return f ? { type: "furniture", id: f.id, name: f.name } : null;
    }
    if (ref.type === "container") {
      const c = containerOf(ref.id);
      return c ? { type: "container", id: c.id, name: c.name, kind: c.kind, box: c.box ?? null } : null;
    }
    return { type: "state", id: ref.id, name: ref.id };
  }

  /** Refuse a place the Place Graph does not contain. Writing an unresolvable reference
   *  produced a confident answer naming an empty place ("... is probably in the ."), and
   *  it also made the resulting export unreadable once imports check references. The
   *  cheapest honest place to stop it is where it enters. */
  function requirePlace(ref: PlaceRef, what: string): PlaceRef {
    // A `state` ref resolves through `placeNode` unconditionally — it synthesises a node
    // from the id itself — so existence alone cannot judge it. The import pass checks
    // state ids against LIFECYCLE_STATES; this must agree, or the writer accepts a place
    // the reader refuses and the resulting export cannot be restored.
    if (ref.type === "state" && !LIFECYCLE_STATES.includes(ref.id as LifecycleState)) {
      throw new Error(`${what} names an unknown lifecycle state: ${ref.id}`);
    }
    if (!placeNode(ref)) throw new Error(`${what} names a place that does not exist: ${ref.type}:${ref.id}`);
    return ref;
  }

  function findNode<T extends PlaceNode["type"]>(chain: PlaceNode[], type: T): Extract<PlaceNode, { type: T }> | null {
    for (const node of chain) {
      if (node.type === type) return node as Extract<PlaceNode, { type: T }>;
    }
    return null;
  }

  // item -> container -> furniture -> room chain (typed containment).
  function chainFor(ref: PlaceRef | null): PlaceNode[] {
    const chain: PlaceNode[] = [];
    let cursor: PlaceRef | null = ref;
    let guard = 0;
    while (cursor && guard < 6) {
      guard += 1;
      const node = placeNode(cursor);
      if (!node) break;
      chain.push(node);
      if (node.type === "container") cursor = containerOf(node.id)?.parent ?? null;
      else if (node.type === "furniture") {
        const f = furnitureOf(node.id);
        cursor = f ? { type: "room", id: f.room } : null;
      } else cursor = null;
    }
    return chain;
  }

  function chainText(chain: PlaceNode[]): string { return chain.map((n) => n.name).join(" · "); }

  function planPinFor(ref: PlaceRef): PlanPin | null {
    const chain = chainFor(ref);
    const container = findNode(chain, "container");
    const furniture = findNode(chain, "furniture");
    const room = findNode(chain, "room");
    if (furniture) {
      const f = furnitureOf(furniture.id);
      if (f) return { roomId: room?.id ?? f.room, x: f.plan.x + f.plan.w / 2, y: f.plan.y + f.plan.h / 2 };
    }
    if (room) {
      const r = roomOf(room.id);
      if (r) {
        // Boxes cluster toward the room's lower-right corner so pins do not stack.
        const offset = container?.kind === "box" ? 0.72 : 0.5;
        return { roomId: r.id, x: r.plan.x + r.plan.w * offset, y: r.plan.y + r.plan.h * offset };
      }
    }
    return null;
  }

  function sameRef(a: PlaceRef | null | undefined, b: PlaceRef | null | undefined): boolean {
    return !!a && !!b && a.type === b.type && a.id === b.id;
  }

  function lifecycleOf(itemId: string): LifecycleState { return state.states.get(itemId)?.state ?? "at_home"; }

  function daysAgo(iso: string): number { return Math.max(0, Math.floor((now() - new Date(iso).getTime()) / DAY)); }

  function answerConfidence(itemId: string, placement: PlacementView | null): number {
    if (!placement) return 0.1;
    let c = placement.confidence;
    c -= Math.min(0.25, daysAgo(placement.at) * 0.005);
    const neg = state.negatives.get(itemId);
    if (neg && new Date(neg) > new Date(placement.at)) c -= 0.35;
    return Math.min(0.98, Math.max(0.05, Number(c.toFixed(2))));
  }

  // ------------------------------------------------------------------ read

  function searchBelongings(query = ""): ScoredBelongingView[] {
    const q = query.trim().toLowerCase();
    const rows: ScoredBelongingView[] = [];
    for (const b of state.belongings.values()) {
      if (b.mergedInto) continue;
      const score = q ? matchScore(b, q) : 1;
      if (q && score <= 0) continue;
      const view = belongingView(b.id);
      if (view) rows.push({ ...view, score });
    }
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return rows;
  }

  function matchScore(b: BelongingEntity, q: string): number {
    const name = b.name.toLowerCase();
    if (name === q) return 100;
    if (name.includes(q)) return 80;
    const qTokens = q.split(/\s+/).filter(Boolean);
    const nameTokens = name.split(/\s+/);
    const overlap = qTokens.filter((t) => nameTokens.some((n) => n.startsWith(t))).length;
    if (overlap && overlap === qTokens.length) return 70;
    if (b.kinds.some((k) => k.includes(q.replace(/\s+/g, "-")) || q.includes(k.replace(/-/g, " ")))) return 55;
    if (overlap) return 30 + overlap;
    return 0;
  }

  function belongingView(itemId: string): BelongingView | null {
    const b = belongingOf(itemId);
    if (!b) return null;
    const slot = state.placements.get(itemId) ?? { active: null, history: [] };
    const active = slot.active;
    const chain = active ? chainFor(active.placeRef) : [];
    return {
      id: b.id,
      name: b.name,
      kinds: b.kinds,
      importance: b.importance,
      group: !!b.group,
      mergedInto: b.mergedInto ?? null,
      state: lifecycleOf(itemId),
      defaultHome: b.defaultHome,
      defaultHomeText: chainText(chainFor(b.defaultHome)),
      placement: active,
      chain,
      chainText: chainText(chain),
      atDefaultHome: active ? sameRef(active.placeRef, b.defaultHome) : false,
      confidence: answerConfidence(itemId, active),
      updatedAt: active?.at ?? null,
      daysSinceUpdate: active ? daysAgo(active.at) : null,
      history: slot.history,
      ...(b.dimensions ? { dimensions: b.dimensions } : {}),
      ...(b.source ? { source: b.source } : {})
    };
  }

  function locate(query: string): LocateAnswer {
    const matches = searchBelongings(query);
    const best = matches[0];
    if (!best) {
      return { ok: false, query, sentence: `I have no memory of “${query}”. Add it as a belonging or run a container snapshot.`, nextAction: "add_belonging" };
    }
    return locateById(best.id, { query, alternates: matches.slice(1, 4) });
  }

  function locateById(itemId: string, ctx: { query?: string | null; alternates?: ScoredBelongingView[] } = {}): LocateAnswer {
    const view = belongingView(itemId);
    if (!view) return { ok: false, query: ctx.query ?? null, sentence: "Unknown belonging.", nextAction: "add_belonging" };
    const evidenceViews = (view.placement?.evidenceIds ?? [])
      .map((eid) => state.evidence.get(eid))
      .filter((e): e is EvidenceRecord => !!e)
      .map((e) => ({ kind: e.kind, summary: e.summary, at: e.at, ...(e.media ? { media: e.media } : {}) }));
    const stale = view.daysSinceUpdate !== null && view.daysSinceUpdate > 30;
    const uncertain = !view.placement || view.confidence < 0.45 || stale;
    const draft: Omit<LocateSuccess, "sentence" | "hint"> = {
      ok: true,
      query: ctx.query ?? null,
      itemId: view.id,
      item: view.name,
      state: view.state,
      placement: view.placement,
      chain: view.chain,
      chainText: view.chainText,
      defaultHomeText: view.defaultHomeText,
      atDefaultHome: view.atDefaultHome,
      evidence: evidenceViews,
      confidence: view.confidence,
      lastUpdatedAt: view.updatedAt,
      daysSinceUpdate: view.daysSinceUpdate,
      stale,
      uncertain,
      alternates: ctx.alternates ?? [],
      planPin: view.placement ? planPinFor(view.placement.placeRef) : null,
      nextAction: "mark_not_there"
    };
    return {
      ...draft,
      sentence: buildSentence(draft, view),
      hint: view.placement
        ? "If it is not there, mark “not there” and I will open a correction."
        : "Record a placement or run a container snapshot to teach me."
    };
  }

  function buildSentence(answer: Omit<LocateSuccess, "sentence" | "hint">, view: BelongingView): string {
    const name = view.name;
    const box = view.chain.find((n): n is Extract<PlaceNode, { type: "container" }> => n.type === "container" && n.kind === "box");
    if (view.state === "packed" && box) {
      const dest = box.box?.destination ? ` (destination: ${box.box.destination})` : "";
      const room = findNode(view.chain, "room");
      return `${name} is packed in ${box.name}${dest}, currently in the ${room?.name ?? "home"}.`;
    }
    if (view.state === "with_me") return `${name} should be with you right now. It normally lives in ${view.defaultHomeText}.`;
    if (view.state === "laundry" || view.state === "drying") return `${name} is in the laundry cycle. It normally lives in ${view.defaultHomeText}.`;
    if (view.state === "lent_out") return `${name} is lent out. Last trusted place: ${view.chainText || "unknown"}.`;
    if (view.state === "missing") return `${name} is marked missing. Last trusted place: ${view.chainText || "unknown"}.`;
    if (!view.placement) return `I do not have a trusted place for ${name} yet.`;
    const rel = RELATION_PHRASE[view.placement.relation];
    const qualifier = answer.uncertain ? "might be" : "is probably";
    let s = `${name} ${qualifier} ${rel} the ${view.chainText}.`;
    if (answer.stale) s += ` That placement is ${view.daysSinceUpdate} days old and has not been reconfirmed.`;
    else if (answer.uncertain) s += " I am not confident about this one.";
    return s;
  }

  function containerContents(containerId: string): ContainerContentsView | null {
    const c = containerOf(containerId);
    if (!c) return null;
    const items: BelongingView[] = [];
    for (const [itemId, slot] of state.placements) {
      if (!slot.active) continue;
      const b = belongingOf(itemId);
      if (!b || b.mergedInto) continue;
      if (slot.active.placeRef.type === "container" && slot.active.placeRef.id === containerId) {
        const view = belongingView(itemId);
        if (view) items.push(view);
      }
    }
    items.sort((a, b) => IMPORTANCE_SCORE[b.importance] - IMPORTANCE_SCORE[a.importance] || a.name.localeCompare(b.name));
    const lastConfirmedAt = c.lastConfirmedAt;
    const staleDays = lastConfirmedAt ? daysAgo(lastConfirmedAt) : null;
    const stale = staleDays === null || staleDays > 30;
    return {
      container: c,
      items,
      lastConfirmedAt,
      daysSinceConfirmed: staleDays,
      stale,
      unknownNote: stale
        ? "Not confirmed recently — there may be unrecorded things inside. Unknown is not empty."
        : null
    };
  }

  function containersView(): ContainerView[] {
    const views: ContainerView[] = [];
    for (const c of state.containers.values()) {
      const contents = containerContents(c.id);
      if (!contents) continue;
      views.push({ ...c, itemCount: contents.items.length, stale: contents.stale, daysSinceConfirmed: contents.daysSinceConfirmed });
    }
    return views;
  }

  function staleContainers(): ContainerView[] {
    return containersView()
      .filter((c) => c.kind !== "box" && c.stale)
      .sort((a, b) => (b.daysSinceConfirmed ?? 9999) - (a.daysSinceConfirmed ?? 9999));
  }

  function whichContainerHas(query: string): WhichContainerHit[] {
    const hits: WhichContainerHit[] = [];
    for (const m of searchBelongings(query)) {
      if (m.placement?.placeRef.type !== "container") continue;
      const container = containerOf(m.placement.placeRef.id);
      if (!container) continue;
      hits.push({
        item: m.name,
        itemId: m.id,
        container,
        chainText: m.chainText,
        isBox: container.kind === "box",
        boxStatus: container.boxStatus
      });
    }
    return hits;
  }

  function attention(): AttentionSummary {
    const all = searchBelongings("");
    return {
      staleContainers: staleContainers(),
      uncertainItems: all.filter((v) => v.placement && (v.confidence < 0.45 || (v.daysSinceUpdate ?? 0) > 30)),
      missingItems: all.filter((v) => v.state === "missing"),
      pendingProposals: state.proposals.filter((p) => p.status === "pending").length
    };
  }

  // PRD §8 activation metric, derived live from the graph.
  function activation(): ActivationSummary {
    const belongingCount = [...state.belongings.values()].filter((b) => !b.mergedInto).length;
    const summary = {
      rooms: state.rooms.size,
      containers: state.containers.size,
      belongings: belongingCount,
      operations: state.operations.size
    };
    return { ...summary, complete: summary.rooms >= 1 && summary.containers >= 1 && summary.belongings >= 10 && summary.operations >= 1 };
  }

  function operationView(opId: string): OperationView | null {
    const op = state.operations.get(opId);
    if (!op) return null;
    const base = { id: op.id, name: op.name, startedAt: op.startedAt, status: op.status, kitId: op.kitId ?? null };
    if (op.type === "move") {
      const boxes: ContainerWithContentsView[] = containersView()
        .filter((c) => c.kind === "box" && c.box?.operationId === opId)
        .map((c) => ({ ...c, contents: containerContents(c.id)?.items ?? [] }));
      const packedCount = boxes.reduce((sum, b) => sum + b.contents.length, 0);
      return { ...base, type: "move", boxes, packedCount, readiness: moveReadiness(boxes) };
    }
    const rows: KitRowView[] = (op.rows ?? []).map((r) => ({ ...r, item: r.itemId ? belongingView(r.itemId) : null }));
    return { ...base, type: "kit", rows, readiness: kitReadiness(rows) };
  }

  function kitReadiness(rows: KitRowView[]): KitReadiness {
    const required = rows.filter((r) => r.level === "required");
    const missing = required.filter((r) => r.status === "missing").length;
    const unresolved = required.filter((r) => r.status === "to_get" || r.status === "uncertain").length;
    if (missing) return { status: "missing_items", missing, unresolved };
    if (unresolved) return { status: "needs_review", missing: 0, unresolved };
    return { status: "ready", missing: 0, unresolved: 0 };
  }

  function moveReadiness(boxes: ContainerWithContentsView[]): MoveReadiness {
    if (!boxes.length) return { status: "needs_review", note: "No boxes yet." };
    const open = boxes.filter((b) => b.boxStatus !== "unpacked").length;
    return open ? { status: "in_progress", openBoxes: open } : { status: "ready", openBoxes: 0 };
  }

  function operationsView(): OperationView[] {
    const views: OperationView[] = [];
    for (const key of state.operations.keys()) {
      const view = operationView(key);
      if (view) views.push(view);
    }
    return views;
  }

  // Kit checklist compiled into pickup stops, grouped by furniture (or room).
  function retrievalPlan(opId: string): RetrievalPlanGroup[] {
    const op = operationView(opId);
    if (!op || op.type !== "kit") return [];
    const groups = new Map<string, RetrievalPlanGroup>();
    const push = (key: string, label: string, roomName: string | null, needsReview: boolean, item: RetrievalPlanItem): void => {
      let group = groups.get(key);
      if (!group) { group = { key, label, roomName, needsReview, items: [] }; groups.set(key, group); }
      group.items.push(item);
    };
    for (const row of op.rows) {
      const item: RetrievalPlanItem = {
        rowId: row.id,
        itemId: row.itemId,
        name: row.item?.name ?? row.reqLabels.join(" + "),
        status: row.status,
        note: row.note
      };
      const chain = row.item?.chain ?? [];
      const furniture = findNode(chain, "furniture");
      const room = findNode(chain, "room");
      if (!row.item || !row.item.placement || row.status === "missing" || row.status === "uncertain") {
        push("needs-review", "Needs review", null, true, item);
      } else if (furniture) {
        push(`furniture:${furniture.id}`, `${furniture.name}${room ? ` · ${room.name}` : ""}`, room?.name ?? null, false, item);
      } else if (room) {
        push(`room:${room.id}`, room.name, room.name, false, item);
      } else {
        push("needs-review", "Needs review", null, true, item);
      }
    }
    const ordered = [...groups.values()].sort((a, b) => {
      if (a.needsReview !== b.needsReview) return a.needsReview ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
    return ordered;
  }

  function unpackPriority(opId: string | null = null): UnpackPriorityEntry[] {
    const entries: UnpackPriorityEntry[] = containersView()
      .filter((c) => c.kind === "box" && (!opId || c.box?.operationId === opId))
      .filter((c) => c.boxStatus !== null && ["packed", "moved", "opened", "packing"].includes(c.boxStatus))
      .map((c) => {
        const contents = containerContents(c.id)?.items ?? [];
        return {
          box: c,
          contents,
          score: contents.reduce((s, item) => Math.max(s, IMPORTANCE_SCORE[item.importance]), 0),
          essentials: contents.filter((i) => i.importance === "essential").map((i) => i.name)
        };
      });
    entries.sort((a, b) => b.score - a.score || b.contents.length - a.contents.length);
    return entries;
  }

  function proposals(statusFilter: ProposalStatus | null = "pending"): ProposalView[] {
    return state.proposals.filter((p) => !statusFilter || p.status === statusFilter);
  }

  function commitsView(limit: number | null = null): CommitRecord[] {
    const list = [...state.commits].reverse();
    return limit ? list.slice(0, limit) : list;
  }

  function exportJson(): ExportDump {
    return { version: 2, exportedAt: nowIso(), records: [...records] };
  }

  // ----------------------------------------------------------------- write

  function slugId(prefix: string, name: string, taken: (candidate: string) => boolean): string {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || prefix;
    if (!taken(base)) return base;
    let n = 2;
    while (taken(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  function rectsOverlap(a: PlanRect, b: PlanRect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  // Auto-assigned floor-plan slot so runtime rooms work in the Plan view
  // without a drawing step (PRD P0.9).
  function nextRoomSlot(): PlanRect {
    const existing = [...state.rooms.values()].map((r) => r.plan);
    const i = existing.length;
    const grid: PlanRect = { x: (i % 3) * 2.4, y: Math.floor(i / 3) * 2.2, w: 2.2, h: 2.0 };
    if (!existing.some((p) => rectsOverlap(grid, p))) return grid;
    const maxX = Math.max(...existing.map((p) => p.x + p.w));
    return { x: maxX + 0.2, y: 0, w: 2.2, h: 2.0 };
  }

  // Geometry the ledger validator will refuse must not be written in the first place.
  // The writer used to accept a negative or zero dimension straight from `inputNumber()`
  // (which only guards `Number.isFinite`), and that was survivable while only `importJson`
  // enforced the rule. Once the BOOT gate enforces it too, a reader stricter than its own
  // writer means an ordinary typo in the product's own form silently discards the person's
  // work on the next reload — the inverse of the defect this slice exists to fix. So the
  // rule is enforced at the earliest owner, at the moment of the write, where it can still
  // be reported to the person instead of losing their record later.
  function requireDimensions(d: Dimensions3D): Dimensions3D {
    for (const [axis, value] of [["Width", d.width], ["Depth", d.depth], ["Height", d.height]] as const) {
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${axis} must be a positive number.`);
    }
    return d;
  }

  function requirePlan(plan: PlanRect): PlanRect {
    for (const [axis, value] of [["width", plan.w], ["height", plan.h]] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Room ${axis} must be a positive number.`);
      }
    }
    if (!Number.isFinite(plan.x) || !Number.isFinite(plan.y)) throw new Error("Room position must be a finite number.");
    return plan;
  }

  function createRoom(input: CreateRoomInput): string {
    const name = input.name?.trim();
    if (!name) throw new Error("Room needs a name.");
    const roomId = slugId("room", name, (candidate) => state.rooms.has(candidate));
    const room: Room = { id: roomId, name, plan: input.plan ? requirePlan(input.plan) : nextRoomSlot() };
    appendCommit({ summary: `Add room: ${name}`, ops: [{ type: "create_room", room }] });
    return roomId;
  }

  function createContainer(input: CreateContainerInput): string {
    const name = input.name?.trim();
    if (!name) throw new Error("Container needs a name.");
    if (!state.rooms.has(input.roomId)) throw new Error("Unknown room — create the room first.");
    const containerId = slugId("container", name, (candidate) => state.containers.has(candidate));
    appendCommit({
      summary: `Add container: ${name}`,
      ops: [{
        type: "create_container",
        container: { id: containerId, name, kind: input.kind, parent: { type: "room", id: input.roomId } }
      }]
    });
    return containerId;
  }

  function createBelonging(input: CreateBelongingInput): string {
    const name = input.name?.trim();
    if (!name) throw new Error("Belonging needs a name.");
    if (input.defaultHome) requirePlace(input.defaultHome, "Default home");
    if (input.currentPlace) requirePlace(input.currentPlace, "Current place");
    // Validated with the other preconditions, BEFORE anything is appended: checking it
    // at the op-construction site left an orphan evidence record behind on refusal.
    const dimensions = input.dimensions ? requireDimensions(input.dimensions) : undefined;
    const itemId = id("item");
    const ev = appendEvidence("user_confirmation", `Created belonging ${name}`);
    const ops: CommitOp[] = [{
      type: "create_belonging",
      belonging: {
        id: itemId,
        name,
        kinds: input.kinds ?? [],
        importance: input.importance ?? "normal",
        defaultHome: input.defaultHome,
        ...(dimensions ? { dimensions } : {}),
        ...(input.source ? { source: input.source } : {})
      }
    }];
    const placeRef = input.currentPlace ?? input.defaultHome;
    if (placeRef) {
      ops.push({ type: "create_placement", itemId, placeRef, relation: input.relation ?? "inside", confidence: 0.9, evidenceIds: [ev.id] });
    }
    appendCommit({ summary: `Add belonging: ${name}`, ops });
    return itemId;
  }

  function setItemState(itemId: string, lifecycle: LifecycleState): void {
    if (!LIFECYCLE_STATES.includes(lifecycle)) throw new Error(`Unknown state ${lifecycle}`);
    // The item must exist. `setRowStatus` and `setOperationStatus` already check their
    // references; omitting it here let a caller-supplied id commit and then made the
    // store's own export unreadable — the writer/reader disagreement this change removes.
    if (!belongingOf(itemId)) throw new Error(`Unknown belonging ${itemId}`);
    appendCommit({
      summary: `Set ${belongingOf(itemId)?.name ?? itemId} state: ${lifecycle}`,
      ops: [{ type: "set_state", itemId, state: lifecycle }]
    });
  }

  // Direct trusted correction: the user explicitly places the item.
  function correctPlacement(itemId: string, placeRef: PlaceRef, opts: { relation?: Relation; note?: string | null } = {}): CommitRecord {
    const b = belongingOf(itemId);
    if (!b) throw new Error("Unknown belonging");
    requirePlace(placeRef, "Placement");
    const ev = appendEvidence("user_confirmation", opts.note ?? `You placed ${b.name} here`);
    const ops: CommitOp[] = [];
    if (state.placements.get(itemId)?.active) {
      ops.push({ type: "contradict_placement", itemId, reason: "user_correction", evidenceIds: [ev.id] });
    }
    ops.push({ type: "create_placement", itemId, placeRef, relation: opts.relation ?? "inside", confidence: 0.92, evidenceIds: [ev.id] });
    const lifecycle = lifecycleOf(itemId);
    if (["packed", "with_me", "laundry", "missing", "in_transit"].includes(lifecycle)) {
      ops.push({ type: "set_state", itemId, state: "at_home" });
    }
    return appendCommit({ summary: `Correct placement: ${b.name} -> ${chainText(chainFor(placeRef))}`, ops });
  }

  function markNotThere(itemId: string): { observationId: string; proposalId: string } {
    const b = belongingOf(itemId);
    if (!b) throw new Error("Unknown belonging");
    const obs = append<ObservationRecord>({ recordType: "observation", id: id("obs"), type: "not_there_report", at: nowIso(), itemId });
    appendEvidence("negative_report", `You reported ${b.name} was not at its recorded place`);
    const proposal = append<ProposalRecord>({
      recordType: "proposal", id: id("proposal"), type: "placement_correction", at: nowIso(),
      sourceObservationIds: [obs.id],
      summary: `${b.name} was not where I said. Where is it actually?`,
      needsPlace: true,
      suggestedOps: [
        { type: "contradict_placement", itemId, reason: "not_there_report" },
        { type: "create_placement", itemId, placeRef: null, relation: "inside", confidence: 0.85 }
      ]
    });
    persist();
    notify();
    return { observationId: obs.id, proposalId: proposal.id };
  }

  function snapshotContainer(containerId: string, seenText: string, photo: PhotoMedia | null = null): string {
    const c = containerOf(containerId);
    if (!c) throw new Error("Unknown container");
    const obs = append<ObservationRecord>({
      recordType: "observation", id: id("obs"), type: "container_snapshot", at: nowIso(),
      containerId, ...(photo ? { photo } : {}), payload: { seenText }
    });
    // Photo is evidence, never recognition: it rides along with the snapshot
    // and gets cited by any placement the user later accepts from it.
    const snapshotEvidence = append<EvidenceRecord>({
      recordType: "evidence", id: id("ev"),
      kind: photo ? "photo_note" : "snapshot_text",
      summary: `Snapshot of ${c.name}: ${seenText}`,
      at: nowIso(),
      ...(photo ? { media: photo } : {})
    });
    const tokens = seenText.split(/[,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const moves: CommitOp[] = [];
    for (const token of tokens) {
      const match = searchBelongings(token)[0];
      if (!match || match.score < 55) continue;
      const already = match.placement?.placeRef.type === "container" && match.placement.placeRef.id === containerId;
      if (!already) {
        moves.push(
          { type: "contradict_placement", itemId: match.id, reason: "seen_in_snapshot" },
          { type: "create_placement", itemId: match.id, placeRef: { type: "container", id: containerId }, relation: "inside", confidence: 0.7, evidenceIds: [snapshotEvidence.id] }
        );
      }
    }
    const proposal = append<ProposalRecord>({
      recordType: "proposal", id: id("proposal"), type: "contents_update", at: nowIso(),
      sourceObservationIds: [obs.id],
      summary: moves.length
        ? `Snapshot of ${c.name} suggests ${moves.length / 2} placement change(s).`
        : `Snapshot of ${c.name}: contents match memory. Confirm freshness?`,
      suggestedOps: [...moves, { type: "confirm_container", containerId }]
    });
    persist();
    notify();
    return proposal.id;
  }

  function acceptProposal(proposalId: string, extra: { placeRef?: PlaceRef } = {}): CommitRecord {
    const p = state.proposals.find((x) => x.id === proposalId && x.status === "pending");
    if (!p) throw new Error("No pending proposal with that id");
    const ops: CommitOp[] = [];
    for (const op of p.suggestedOps) {
      // A proposal's ops were coherent when it was made, not necessarily now. Accepting a
      // suggested `create_*` whose id has since been taken REPLACES the real record in
      // place (`derive()` overwrites), silently changing the answer a person reads and
      // leaving an export that cannot be restored. Apply the same id-freeness rule the
      // import pass applies, rather than trusting a stale suggestion.
      if (op.type === "create_room" && state.rooms.has(op.room.id)) {
        throw new Error(`This proposal would replace the existing Room ${op.room.id}`);
      }
      if (op.type === "create_container" && state.containers.has(op.container.id)) {
        throw new Error(`This proposal would replace the existing Container ${op.container.id}`);
      }
      if (op.type === "create_belonging" && state.belongings.has(op.belonging.id)) {
        throw new Error(`This proposal would replace the existing Belonging ${op.belonging.id}`);
      }
      if (op.type === "create_operation" && state.operations.has(op.operation.id)) {
        throw new Error(`This proposal would replace the existing Operation ${op.operation.id}`);
      }
      if (op.type === "create_placement") {
        // A proposal is a suggestion, never authority, so the target is re-checked at
        // accept time whether it came from Review or was stored in the suggestion. Only
        // the Review branch was guarded, so accepting a proposal whose stored placeRef had
        // become unresolvable MINTED a new fabricating commit — "... is probably in the ."
        // — through this very writer.
        const target = op.placeRef ?? extra.placeRef;
        if (!target) throw new Error("This correction needs a target place (extra.placeRef).");
        ops.push({ ...op, placeRef: requirePlace(target, op.placeRef ? "Suggested place" : "Review target place") });
      } else {
        ops.push({ ...op });
      }
    }
    const ev = appendEvidence(p.type === "placement_correction" ? "correction" : "user_confirmation", `Accepted proposal: ${p.summary}`);
    for (const op of ops) {
      if (op.type === "create_placement") op.evidenceIds = [...(op.evidenceIds ?? []), ev.id];
    }
    if (p.type === "duplicate_merge") {
      const mergeOp = p.suggestedOps.find((o): o is Extract<CommitOp, { type: "merge_belongings" }> => o.type === "merge_belongings");
      if (mergeOp && state.placements.get(mergeOp.mergeId)?.active) {
        ops.push({ type: "contradict_placement", itemId: mergeOp.mergeId, reason: "merged_duplicate" });
      }
    }
    ops.push({ type: "accept_proposal", proposalId });
    return appendCommit({ summary: `Accept: ${p.summary}`, ops, sourceProposalId: proposalId, sourceObservationIds: p.sourceObservationIds });
  }

  function rejectProposal(proposalId: string, reason = "rejected by user"): CommitRecord {
    const p = state.proposals.find((x) => x.id === proposalId && x.status === "pending");
    if (!p) throw new Error("No pending proposal with that id");
    return appendCommit({ summary: `Reject: ${p.summary}`, ops: [{ type: "reject_proposal", proposalId, reason }], sourceProposalId: proposalId });
  }

  function confirmContainer(containerId: string): CommitRecord {
    const c = containerOf(containerId);
    if (!c) throw new Error("Unknown container");
    appendEvidence("user_confirmation", `Confirmed contents of ${c.name}`);
    return appendCommit({ summary: `Confirm container: ${c.name}`, ops: [{ type: "confirm_container", containerId }] });
  }

  // ------------------------------------------------------------ operations

  function startOperation(templateId: string): string {
    const template = catalog.operationTemplates.find((t) => t.id === templateId);
    if (!template) throw new Error("Unknown operation template");
    const opId = id("op");
    if (template.type === "move") {
      appendCommit({
        summary: `Start operation: ${template.name}`,
        ops: [{ type: "create_operation", operation: { id: opId, type: "move", name: template.name, startedAt: nowIso(), status: "active" } }]
      });
      return opId;
    }
    const kit = catalog.kits.find((k) => k.id === template.kitId);
    const rows = kit ? resolveKit(kit) : [];
    appendCommit({
      summary: `Start operation: ${template.name}`,
      ops: [{
        type: "create_operation",
        operation: { id: opId, type: "kit", kitId: template.kitId ?? null, name: template.name, startedAt: nowIso(), status: "active", rows }
      }]
    });
    return opId;
  }

  function resolveKit(kit: Kit): KitRow[] {
    const rows: KitRow[] = [];
    const used = new Map<string, KitRow>();
    for (const req of kit.requirements) {
      const candidates: Array<{ b: BelongingEntity; lifecycle: LifecycleState }> = [];
      for (const b of state.belongings.values()) {
        if (b.mergedInto) continue;
        const lifecycle = lifecycleOf(b.id);
        if (lifecycle === "retired" || lifecycle === "consumed") continue;
        if (b.kinds.some((k) => req.kindsAny.includes(k))) candidates.push({ b, lifecycle });
      }
      const available = candidates.filter((c) => !UNAVAILABLE_STATES.includes(c.lifecycle));
      const pick = available[0] ?? null;
      const first = candidates[0] ?? null;
      const substituted = !!pick && !!req.substituteGroup && candidates.length > 1 && first !== null && first.b.id !== pick.b.id;

      if (pick) {
        const existing = used.get(pick.b.id);
        if (existing) {
          // Duplicate requirement resolving to the same belonging: merge into one row.
          existing.reqLabels.push(req.label);
          existing.mergedRequirement = true;
          continue;
        }
      }

      const row: KitRow = {
        id: `row-${kit.id}-${req.id}`,
        reqId: req.id,
        reqLabels: [req.label],
        level: req.level,
        itemId: pick ? pick.b.id : null,
        status: !pick
          ? (candidates.length ? "uncertain" : "missing")
          : (substituted ? "substituted" : "to_get"),
        note: !pick && first
          ? `${first.b.name} is ${first.lifecycle.replace("_", " ")}`
          : (substituted && first ? `Substituting for ${first.b.name} (${first.lifecycle.replace("_", " ")})` : null),
        mergedRequirement: false
      };
      rows.push(row);
      if (pick) used.set(pick.b.id, row);
    }
    return rows;
  }

  function setRowStatus(opId: string, rowId: string, status: RowStatus, note?: string | null): CommitRecord {
    if (!ROW_STATUSES.includes(status)) throw new Error(`Unknown row status ${status}`);
    // The op and row must exist. An id that resolves to nothing — a hallucinated row id
    // from the agent surface, say — committed silently and then made the export
    // unreadable.
    const target = state.operations.get(opId);
    if (!target) throw new Error(`Unknown operation ${opId}`);
    if (!(target.rows ?? []).some((row) => row.id === rowId)) throw new Error(`Unknown row ${rowId} on operation ${opId}`);
    const op: CommitOp = note !== undefined
      ? { type: "set_op_row_status", opId, rowId, status, note }
      : { type: "set_op_row_status", opId, rowId, status };
    return appendCommit({ summary: `Kit row ${rowId}: ${status}`, ops: [op] });
  }

  function setOperationStatus(opId: string, status: OperationStatus): CommitRecord {
    // Both halves, matching `setRowStatus` and `setBoxStatus`: the operation must exist AND
    // the status must be in its domain. The existence half alone left the writer accepting
    // a value the reader refuses, which is the same disagreement that makes an export
    // unrestorable — one enum short rather than one reference short.
    if (!OPERATION_STATUSES.includes(status)) throw new Error(`Unknown operation status ${status}`);
    if (!state.operations.has(opId)) throw new Error(`Unknown operation ${opId}`);
    return appendCommit({ summary: `Operation ${opId}: ${status}`, ops: [{ type: "set_op_status", opId, status }] });
  }

  function createBox(input: CreateBoxInput): string {
    const label = input.label?.trim();
    if (!label) throw new Error("Box needs a label.");
    const roomId = input.roomId ?? state.rooms.keys().next().value;
    if (!roomId || !state.rooms.has(roomId)) throw new Error("Create a room first — boxes live in rooms.");
    const boxId = id("box");
    appendCommit({
      summary: `Create box: ${label}`,
      ops: [{
        type: "create_container",
        container: {
          id: boxId,
          name: `Box · ${label}`,
          kind: "box",
          parent: { type: "room", id: roomId },
          box: { label, destination: input.destination?.trim() || "New home", operationId: input.operationId ?? null }
        }
      }]
    });
    return boxId;
  }

  function assignToBox(itemId: string, boxId: string): CommitRecord {
    const b = belongingOf(itemId);
    const box = containerOf(boxId);
    if (!b || !box || box.kind !== "box") throw new Error("Need a belonging and a box");
    const ev = appendEvidence("user_confirmation", `Packed ${b.name} into ${box.name}`);
    const ops: CommitOp[] = [];
    if (state.placements.get(itemId)?.active) {
      ops.push({ type: "contradict_placement", itemId, reason: "packed_into_box", evidenceIds: [ev.id] });
    }
    ops.push({ type: "create_placement", itemId, placeRef: { type: "container", id: boxId }, relation: "inside", confidence: 0.95, evidenceIds: [ev.id] });
    ops.push({ type: "set_state", itemId, state: "packed" });
    if (!box.boxStatus || box.boxStatus === "empty") ops.push({ type: "set_box_status", boxId, status: "packing" });
    return appendCommit({ summary: `Pack ${b.name} into ${box.name}`, ops });
  }

  function setBoxStatus(boxId: string, status: BoxStatus): CommitRecord {
    if (!BOX_STATUSES.includes(status)) throw new Error(`Unknown box status ${status}`);
    const box = containerOf(boxId);
    if (!box) throw new Error("Unknown box");
    return appendCommit({ summary: `${box.name}: ${status}`, ops: [{ type: "set_box_status", boxId, status }] });
  }

  function unpackItem(itemId: string, placeRef: PlaceRef | null = null): CommitRecord {
    const b = belongingOf(itemId);
    if (!b) throw new Error("Unknown belonging");
    const target = requirePlace(placeRef ?? b.defaultHome, "Unpack target");
    // Only a BOX can take a box status. The previous placement may be a room, a piece
    // of furniture or a non-box container, and emitting `set_box_status` against one of
    // those wrote an op that refers to no box at all — making the store's own export
    // unimportable once references are checked.
    const previousRef = state.placements.get(itemId)?.active?.placeRef ?? null;
    const fromBoxId = previousRef?.type === "container" && containerOf(previousRef.id)?.kind === "box"
      ? previousRef.id
      : null;
    const ev = appendEvidence("user_confirmation", `Unpacked ${b.name} to ${chainText(chainFor(target))}`);
    const ops: CommitOp[] = [
      { type: "contradict_placement", itemId, reason: "unpacked", evidenceIds: [ev.id] },
      { type: "create_placement", itemId, placeRef: target, relation: "inside", confidence: 0.92, evidenceIds: [ev.id] },
      { type: "set_state", itemId, state: "at_home" }
    ];
    if (fromBoxId) {
      const remaining = (containerContents(fromBoxId)?.items ?? []).filter((i) => i.id !== itemId).length;
      if (remaining === 0) ops.push({ type: "set_box_status", boxId: fromBoxId, status: "unpacked" });
    }
    return appendCommit({ summary: `Unpack ${b.name}`, ops });
  }

  function reset(): void {
    records = seedRecords();
    seq = records.length;
    append<CommitRecord>({ recordType: "commit", id: id("commit"), at: nowIso(), summary: "Reset home memory to seed", ops: [{ type: "reset_to_seed" }] });
    persist();
    notify();
  }

  function importJson(data: unknown): void {
    // Validate the WHOLE dump before touching any state. A bad dump used to be
    // assigned first and only fail later while deriving — by which point the old
    // records were gone and the replacement had already been persisted. Building
    // the validated array first means a validation failure leaves records, seq and
    // storage exactly as they were. The validator owns the whole boundary, including
    // the top-level shape, so there is no separate pre-check to disagree with it.
    const imported = validatedLedgerRecords(data, "Import");
    // Shape is not authority for meaning. A structurally perfect dump can still point
    // at a room, item or proposal that does not exist; deriving from it produced a
    // confident answer naming an empty place. Both passes must succeed before any
    // state changes, so a semantic refusal is as clean as a shape refusal.
    validateLedgerSemantics(imported, catalog);
    records = imported;
    seq = records.length;
    persist();
    notify();
  }

  // ------------------------------------------------------------------- api

  const api: Store = {
    get state() { return state; },
    catalog,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // read
    searchBelongings, belongingView, locate, locateById,
    containerContents, containersView, staleContainers, whichContainerHas,
    attention, activation, operationsView, operationView, retrievalPlan, unpackPriority,
    proposals, commitsView, exportJson, planPinFor, chainFor, chainText,
    lifecycleOf,
    storageRecovery: () => recovery,
    // write
    createRoom, createContainer,
    createBelonging, setItemState, correctPlacement, markNotThere,
    snapshotContainer, acceptProposal, rejectProposal, confirmContainer,
    startOperation, setRowStatus, setOperationStatus,
    createBox, assignToBox, setBoxStatus, unpackItem,
    reset, importJson
  };
  return api;
}

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}
