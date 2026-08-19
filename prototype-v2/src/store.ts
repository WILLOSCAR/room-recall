// Nestory V2 store: an event-sourced Place Graph.
// Catalog (data.ts) + append-only records -> derived current state.
// The only mutation path is appending records; commits carry typed ops.
// Runs in the browser and in Node (verify.ts imports it directly).
// The public surface implements the Store interface in types.ts.

import type {
  ActivationSummary, AnyRecord, AttentionSummary, BelongingEntity, BelongingSearchPage, BelongingView, BoxStatus, Catalog,
  CommitOp, CommitRecord, ContainerContentsView, ContainerEntity, ContainerKind, ContainerView,
  ContainerWithContentsView, CreateBelongingInput, CreateBoxInput, CreateContainerInput,
  CreateRoomInput, DerivedState, ReadonlyDerivedState,
  EvidenceKind, EvidenceRecord, ExportDump, Kit, KitReadiness, KitRow, KitRowView,
  LifecycleState, LocateAnswer, LocateSuccess, MoveReadiness, ObservationRecord,
  OperationData, OperationStatus, OperationView, OwnershipRecallAnswer, OwnershipMatch, DeclutterReviewResult, DeclutterCandidate, DeclutterReason, DeclutterOption, PhotoMedia, PlaceNode, PlacementSlot, PlacementView, PlaceRef,
  PlanPin, PlanRect, ProposalRecord, ProposalStatus, ProposalView, Relation, RetrievalPlanGroup,
  RetrievalPlanItem, Room, RowStatus,
  ScoredBelongingView, StorageLike, Store, StoreOptions, UnpackPriorityEntry,
  WhichContainerHit
} from "./types.ts";
import { BOX_STATUSES, CONTAINER_KINDS, IMPORTANCE_SCORE, LIFECYCLE_STATES, OPERATION_STATUSES as OPERATION_STATUS_VALUES, ROW_STATUSES } from "./types.ts";
import { validateLedgerSemantics, validatedLedgerRecords } from "./ledger-validation.ts";

const DAY = 24 * 60 * 60 * 1000;

const RELATION_PHRASE: Record<Relation, string> = {
  inside: "in", on_surface: "on", under: "under", attached_to: "attached to", near: "near"
};

const UNAVAILABLE_STATES: readonly LifecycleState[] = ["laundry", "drying", "lent_out", "missing", "in_transit"];
const OPERATION_STATUSES = new Set<OperationStatus>(OPERATION_STATUS_VALUES);
const SEARCH_CACHE_LIMIT = 32;
const SEARCH_MATCH_CACHE_LIMIT = 8;
const LOCATE_CACHE_LIMIT = 256;

export class StoreConflictError extends Error {}
export class ReentrantStoreCommandError extends Error {}
export class DomainInputError extends Error {}

const CONTAINER_KIND_VALUES = new Set<ContainerKind>(CONTAINER_KINDS);

function boundedInput(value: string | null | undefined, label: string, maxLength: number): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new DomainInputError(`${label} must not be empty.`);
  if (normalized.length > maxLength) throw new DomainInputError(`${label} must be at most ${maxLength} characters.`);
  return normalized;
}

interface BelongingSearchEntry {
  belonging: BelongingEntity;
  normalizedName: string;
  nameTokens: string[];
  ordinal: number;
  nameRank: number;
}

interface BelongingSearchIndex {
  entries: BelongingSearchEntry[];
  nameGrams: Map<string, number[]>;
  kinds: Array<{ kind: string; phrase: string; ordinals: number[] }>;
  scratch: {
    generation: number;
    seen: Uint32Array;
    overlaps: Uint32Array;
    flags: Uint8Array;
    touched: number[];
  };
}

interface BelongingSearchMatch {
  entry: BelongingSearchEntry;
  score: number;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function readonlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  for (const value of source.values()) deepFreeze(value);
  let facade: ReadonlyMap<K, V>;
  const view = {
    get size(): number { return source.size; },
    get(key: K): V | undefined { return source.get(key); },
    has(key: K): boolean { return source.has(key); },
    entries(): MapIterator<[K, V]> { return source.entries(); },
    keys(): MapIterator<K> { return source.keys(); },
    values(): MapIterator<V> { return source.values(); },
    forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
      source.forEach((value, key) => callback.call(thisArg, value, key, facade));
    },
    [Symbol.iterator](): MapIterator<[K, V]> { return source[Symbol.iterator](); }
  };
  facade = Object.freeze(view);
  return facade;
}

function readonlyState(source: DerivedState): ReadonlyDerivedState {
  return Object.freeze({
    rooms: readonlyMap(source.rooms),
    belongings: readonlyMap(source.belongings),
    containers: readonlyMap(source.containers),
    evidence: readonlyMap(source.evidence),
    observations: deepFreeze([...source.observations]),
    proposals: deepFreeze([...source.proposals]),
    operations: readonlyMap(source.operations),
    commits: deepFreeze([...source.commits]),
    placements: readonlyMap(source.placements),
    states: readonlyMap(source.states),
    negatives: readonlyMap(source.negatives)
  });
}

function lruGet<K, V>(cache: Map<K, V>, key: K): V | undefined {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key) as V;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function lruSet<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function createStore(options: StoreOptions): Store {
  const {
    catalog: inputCatalog,
    seedFactory,
    now = () => Date.now(),
    storage = defaultStorage(),
    persistKey = "nestory-v2"
  } = options;

  // Own an immutable catalog snapshot. Neither a caller nor a cached query may
  // become a second, unledgered source of Place Graph truth.
  const catalog = deepFreeze(structuredClone(inputCatalog));
  const generatedBaselineRecords: AnyRecord[] = structuredClone(validatedLedgerRecords({
    version: 2,
    records: seedFactory ? seedFactory() : []
  }, "Generated baseline"));
  validateResetBaseline(generatedBaselineRecords, "Generated baseline");
  validateLedgerSemantics(generatedBaselineRecords, catalog, []);
  const loaded = loadLedger();
  let baselineRecords: AnyRecord[] = loaded?.baselineRecords ?? generatedBaselineRecords;
  let records: AnyRecord[] = loaded?.records ?? structuredClone(baselineRecords);
  let seq = records.length;
  let revision = 0;
  const listeners = new Set<(state: ReadonlyDerivedState) => void>();
  let publishing = false;
  let state: DerivedState = derive();
  let exposedState: ReadonlyDerivedState = readonlyState(state);
  let allocatedIds = collectAllocatedIds();
  let stagedAllocatedIds: string[] | null = null;
  let rebuildAllocatedIds = false;
  let staging = false;
  let belongingSearchIndex: BelongingSearchIndex | null = null;
  const furnitureById = new Map(catalog.furniture.map((furniture) => [furniture.id, furniture]));
  const belongingViewCache = new Map<string, BelongingView | null>();
  const searchCache = new Map<string, ScoredBelongingView[]>();
  const searchMatchCache = new Map<string, BelongingSearchMatch[]>();
  const locateCache = new Map<string, LocateAnswer>();
  const containerContentsCache = new Map<string, ContainerContentsView | null>();
  let containersCache: ContainerView[] | null = null;
  let attentionCache: AttentionSummary | null = null;
  let activeItemsByContainerCache: Map<string, string[]> | null = null;
  let temporalCacheObservedAt: number | null = null;
  let temporalCacheExpiresAt = 0;

  function clearQueryCaches(resetTemporal = true): void {
    belongingViewCache.clear();
    searchCache.clear();
    searchMatchCache.clear();
    locateCache.clear();
    containerContentsCache.clear();
    containersCache = null;
    attentionCache = null;
    activeItemsByContainerCache = null;
    if (resetTemporal) {
      temporalCacheObservedAt = null;
      temporalCacheExpiresAt = 0;
    }
  }

  function nextTemporalBoundary(current: number): number {
    let next = Number.POSITIVE_INFINITY;
    const consider = (iso: string | null | undefined): void => {
      if (!iso) return;
      const at = Date.parse(iso);
      if (!Number.isFinite(at)) return;
      const elapsed = Math.max(0, current - at);
      next = Math.min(next, at + (Math.floor(elapsed / DAY) + 1) * DAY);
    };
    for (const slot of state.placements.values()) consider(slot.active?.at);
    for (const container of state.containers.values()) consider(container.lastConfirmedAt);
    return next;
  }

  function ensureTemporalCacheFresh(): void {
    const current = now();
    if (temporalCacheObservedAt === null || current < temporalCacheObservedAt || current >= temporalCacheExpiresAt) {
      clearQueryCaches(false);
      temporalCacheExpiresAt = nextTemporalBoundary(current);
    }
    temporalCacheObservedAt = current;
  }

  function baselineFromDump(data: unknown, ledger: readonly AnyRecord[], source: string, fallback: readonly AnyRecord[]): AnyRecord[] {
    if (data && typeof data === "object" && "baselineRecords" in data && (data as { baselineRecords?: unknown }).baselineRecords !== undefined) {
      return structuredClone(validatedLedgerRecords(
        { version: 2, records: (data as { baselineRecords: unknown }).baselineRecords },
        `${source} baseline`
      ));
    }
    if (generatedBaselineRecords.length > 0) {
      const prefix = ledger.slice(0, generatedBaselineRecords.length);
      const matchesSeedIdentity = prefix.length === generatedBaselineRecords.length
        && prefix.every((record, index) => record.id === generatedBaselineRecords[index]?.id && record.recordType === generatedBaselineRecords[index]?.recordType);
      if (matchesSeedIdentity) return structuredClone(prefix);
    }
    return structuredClone(Array.from(fallback));
  }

  function validateResetBaseline(baseline: readonly AnyRecord[], source: string): void {
    const reset = baseline.find((record) => record.recordType === "commit" && record.ops.some((op) => op.type === "reset_to_seed"));
    if (reset) throw new Error(`${source} cannot contain reset_to_seed; the baseline is already the immutable reset target.`);
  }

  function loadLedger(): { records: AnyRecord[]; baselineRecords: AnyRecord[] } | null {
    if (storage) {
      const raw = storage.getItem(persistKey);
      if (raw !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error("Corrupt persisted home memory: invalid JSON", { cause: error });
        }
        try {
          // JSON.parse already gives this Store an unaliased object graph. Keep
          // validation, but avoid cloning a household-sized ledger a second
          // time on the first-render critical path.
          const stored = validatedLedgerRecords(parsed, "Corrupt persisted home memory");
          const storedBaseline = baselineFromDump(parsed, stored, "Corrupt persisted home memory", generatedBaselineRecords);
          validateResetBaseline(storedBaseline, "Corrupt persisted home memory baseline");
          validateLedgerSemantics(storedBaseline, catalog, []);
          validateLedgerSemantics(stored, catalog, storedBaseline);
          return { records: stored, baselineRecords: storedBaseline };
        } catch (error) {
          if (error instanceof Error && /^Corrupt persisted home memory/.test(error.message)) throw error;
          throw new Error(`Corrupt persisted home memory: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
      }
    }
    return null;
  }

  function persistNow(): void {
    if (!storage) return;
    storage.setItem(persistKey, JSON.stringify({ version: 2, records, baselineRecords }));
  }

  function publish(nextState: DerivedState): void {
    state = nextState;
    exposedState = readonlyState(nextState);
    if (rebuildAllocatedIds) {
      allocatedIds = collectAllocatedIds();
      rebuildAllocatedIds = false;
    }
    revision += 1;
    belongingSearchIndex = null;
    clearQueryCaches();
    publishing = true;
    try {
      for (const fn of [...listeners]) {
        try {
          fn(exposedState);
        } catch (error) {
          console.error("Nestory Store subscriber failed", error);
        }
      }
    } finally {
      publishing = false;
    }
  }

  function transact<T>(command: () => T): T {
    if (staging || publishing) {
      throw new ReentrantStoreCommandError("Store commands cannot run during another command or inside a subscriber callback; schedule the command after the current transaction is delivered.");
    }

    const previousRecords = records;
    const previousBaselineRecords = baselineRecords;
    const previousSeq = seq;
    const previousState = state;
    const previousRebuildAllocatedIds = rebuildAllocatedIds;
    records = [...records];
    staging = true;
    stagedAllocatedIds = [];
    try {
      const result = command();
      // Keep command emitters and reload/import validation in lockstep without
      // replaying the entire ledger on every household-scale write.
      if (records.length > previousRecords.length) {
        validatedLedgerRecords({ version: 2, records: records.slice(previousRecords.length) }, "Command output");
      }
      const nextState = derive();
      persistNow();
      staging = false;
      publish(nextState);
      stagedAllocatedIds = null;
      return result;
    } catch (error) {
      for (const allocatedId of stagedAllocatedIds ?? []) allocatedIds.delete(allocatedId);
      records = previousRecords;
      baselineRecords = previousBaselineRecords;
      seq = previousSeq;
      state = previousState;
      rebuildAllocatedIds = previousRebuildAllocatedIds;
      throw error;
    } finally {
      staging = false;
      stagedAllocatedIds = null;
    }
  }

  function reserveId(candidate: string): void {
    if (allocatedIds.has(candidate)) return;
    allocatedIds.add(candidate);
    stagedAllocatedIds?.push(candidate);
  }

  function id(prefix: string): string {
    for (let attempt = 0; attempt < 1_024; attempt += 1) {
      seq += 1;
      const candidate = `${prefix}-${seq.toString(36)}-${Math.floor(Math.random() * 46655).toString(36)}`;
      if (!allocatedIds.has(candidate)) {
        reserveId(candidate);
        return candidate;
      }
    }
    throw new Error(`Could not allocate a unique ${prefix} id`);
  }

  function collectAllocatedIds(): Set<string> {
    return new Set([
      ...baselineRecords.map((record) => record.id),
      ...records.map((record) => record.id),
      ...state.rooms.keys(),
      ...state.belongings.keys(),
      ...state.containers.keys(),
      ...state.operations.keys(),
      ...catalog.furniture.map((furniture) => furniture.id)
    ]);
  }

  function nowIso(): string { return new Date(now()).toISOString(); }

  function append<T extends AnyRecord>(record: T): T {
    reserveId(record.id);
    const ops = record.recordType === "commit" ? record.ops : record.recordType === "proposal" ? record.suggestedOps : [];
    for (const op of ops) {
      if (op.type === "create_room") reserveId(op.room.id);
      else if (op.type === "create_container") reserveId(op.container.id);
      else if (op.type === "create_belonging") reserveId(op.belonging.id);
      else if (op.type === "create_operation") reserveId(op.operation.id);
    }
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
    return commit;
  }

  // ---------------------------------------------------------------- derive

  function derive(): DerivedState {
    let lastResetIndex = -1;
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const candidate = records[index];
      if (candidate?.recordType === "commit" && candidate.ops.some((op) => op.type === "reset_to_seed")) {
        lastResetIndex = index;
        break;
      }
    }
    const projectionRecords = lastResetIndex >= 0
      ? [...baselineRecords, ...records.slice(lastResetIndex + 1)]
      : records;
    const rooms = new Map<string, Room>();
    const belongings = new Map<string, BelongingEntity>();
    const containers = new Map<string, ContainerEntity>();
    const evidence = new Map<string, EvidenceRecord>();
    const observations: ObservationRecord[] = [];
    const proposalMap = new Map<string, ProposalView>();
    const operations = new Map<string, OperationData>();
    const commits = records.filter((record): record is CommitRecord => record.recordType === "commit");
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

    for (const rec of projectionRecords) {
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
  function furnitureOf(furnitureId: string) { return furnitureById.get(furnitureId) ?? null; }
  function containerOf(containerId: string): ContainerEntity | null { return state.containers.get(containerId) ?? null; }
  function belongingOf(itemId: string): BelongingEntity | null { return state.belongings.get(itemId) ?? null; }

  function requirePlace(ref: PlaceRef): void {
    const exists = ref.type === "room" ? state.rooms.has(ref.id)
      : ref.type === "furniture" ? furnitureById.has(ref.id)
      : ref.type === "container" ? state.containers.has(ref.id)
      : (LIFECYCLE_STATES as readonly string[]).includes(ref.id);
    if (!exists) throw new DomainInputError(`Unknown Place Reference: ${ref.type}:${ref.id}`);
  }

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

  function addPosting(postings: Map<string, number[]>, key: string, ordinal: number): void {
    const existing = postings.get(key);
    if (existing) existing.push(ordinal);
    else postings.set(key, [ordinal]);
  }

  function addShortGrams(postings: Map<string, number[]>, text: string, ordinal: number): void {
    const grams = new Set<string>();
    for (let width = 1; width <= Math.min(3, text.length); width += 1) {
      for (let start = 0; start <= text.length - width; start += 1) {
        grams.add(text.slice(start, start + width));
      }
    }
    for (const gram of grams) addPosting(postings, gram, ordinal);
  }

  function buildBelongingSearchIndex(): BelongingSearchIndex {
    const entries: BelongingSearchEntry[] = [];
    const nameGrams = new Map<string, number[]>();
    const kindOrdinals = new Map<string, number[]>();

    for (const belonging of state.belongings.values()) {
      if (belonging.mergedInto) continue;
      const normalizedName = belonging.name.toLowerCase();
      const ordinal = entries.length;
      const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
      entries.push({ belonging, normalizedName, nameTokens, ordinal, nameRank: 0 });
      addShortGrams(nameGrams, normalizedName, ordinal);
      for (const kind of new Set(belonging.kinds)) addPosting(kindOrdinals, kind, ordinal);
    }

    const nameOrdered = [...entries].sort((a, b) =>
      a.belonging.name.localeCompare(b.belonging.name) || a.ordinal - b.ordinal
    );
    nameOrdered.forEach((entry, nameRank) => { entry.nameRank = nameRank; });
    const kinds = [...kindOrdinals].map(([kind, ordinals]) => ({ kind, phrase: kind.replace(/-/g, " "), ordinals }));
    return {
      entries,
      nameGrams,
      kinds,
      scratch: {
        generation: 0,
        seen: new Uint32Array(entries.length),
        overlaps: new Uint32Array(entries.length),
        flags: new Uint8Array(entries.length),
        touched: []
      }
    };
  }

  function currentBelongingSearchIndex(): BelongingSearchIndex {
    belongingSearchIndex ??= buildBelongingSearchIndex();
    return belongingSearchIndex;
  }

  function queryGramKeys(query: string): string[] {
    const width = Math.min(3, query.length);
    const keys = new Set<string>();
    for (let start = 0; start <= query.length - width; start += 1) {
      keys.add(query.slice(start, start + width));
    }
    return [...keys];
  }

  function rarestGramPosting(query: string, postings: Map<string, number[]>): number[] | null {
    let rarest: number[] | null = null;
    for (const key of queryGramKeys(query)) {
      const posting = postings.get(key);
      if (!posting) return null;
      if (!rarest || posting.length < rarest.length) rarest = posting;
    }
    return rarest;
  }

  /**
   * Produces the exact legacy match scores without walking every belonging's
   * strings. The postings are only candidate generators; the precedence is
   * intentionally identical to matchScore: exact, substring, all-token,
   * kind, then partial token overlap.
   */
  function indexedBelongingMatches(query: string, limit: number | null = null): BelongingSearchMatch[] {
    const index = currentBelongingSearchIndex();
    if (!query) {
      const all = index.entries.map((entry) => ({ entry, score: 1 }));
      if (limit === null) return all;
      return all.sort(compareBelongingMatches).slice(0, limit);
    }

    const { scratch } = index;
    scratch.generation += 1;
    if (scratch.generation >= 0xffff_ffff) {
      scratch.seen.fill(0);
      scratch.generation = 1;
    }
    const generation = scratch.generation;
    const { overlaps, flags, seen, touched } = scratch;
    touched.length = 0;
    const touch = (ordinal: number): void => {
      if (seen[ordinal] === generation) return;
      seen[ordinal] = generation;
      overlaps[ordinal] = 0;
      flags[ordinal] = 0;
      touched.push(ordinal);
    };

    // A string containing the query contains every 1/2/3-gram. The rarest
    // posting is therefore a complete candidate set, then includes() removes
    // gram collisions without changing semantics.
    const substringPosting = rarestGramPosting(query, index.nameGrams);
    for (const ordinal of substringPosting ?? []) {
      if (!index.entries[ordinal]?.normalizedName.includes(query)) continue;
      touch(ordinal);
      flags[ordinal] = (flags[ordinal] ?? 0) | 1;
    }

    const queryTokens = query.split(/\s+/).filter(Boolean);
    for (const token of queryTokens) {
      for (const ordinal of rarestGramPosting(token, index.nameGrams) ?? []) {
        const entry = index.entries[ordinal];
        if (!entry?.nameTokens.some((nameToken) => nameToken.startsWith(token))) continue;
        touch(ordinal);
        overlaps[ordinal] = (overlaps[ordinal] ?? 0) + 1;
      }
    }

    const markKind = (ordinal: number): void => {
      touch(ordinal);
      flags[ordinal] = (flags[ordinal] ?? 0) | 2;
    };
    const kindNeedle = query.replace(/\s+/g, "-");
    // Kinds are a small shared taxonomy in ordinary homes. A direct pass is
    // cheaper and far more memory-stable than building a second gram index for
    // adversarially high-cardinality user tags; this preserves both legacy
    // `kind includes query` and `query includes kind phrase` semantics.
    for (const { kind, phrase, ordinals } of index.kinds) {
      if (!kind.includes(kindNeedle) && !query.includes(phrase)) continue;
      for (const ordinal of ordinals) markKind(ordinal);
    }

    const matches: BelongingSearchMatch[] = [];
    for (const ordinal of touched) {
      const entry = index.entries[ordinal] as BelongingSearchEntry;
      const overlap = overlaps[ordinal] ?? 0;
      const flag = flags[ordinal] ?? 0;
      let score = 0;
      if ((flag & 1) !== 0) score = entry.normalizedName === query ? 100 : 80;
      else if (overlap > 0 && overlap === queryTokens.length) score = 70;
      else if ((flag & 2) !== 0) score = 55;
      else if (overlap > 0) score = 30 + overlap;
      if (score <= 0) continue;
      if (limit !== null && matches.length >= limit) {
        const last = matches[matches.length - 1] as BelongingSearchMatch;
        if (score < last.score || (score === last.score && entry.nameRank >= last.entry.nameRank)) continue;
      }
      const match = { entry, score };
      if (limit === null) {
        matches.push(match);
        continue;
      }
      let position = 0;
      while (position < matches.length && compareBelongingMatches(match, matches[position] as BelongingSearchMatch) >= 0) position += 1;
      if (position >= limit) continue;
      matches.splice(position, 0, match);
      if (matches.length > limit) matches.pop();
    }
    return matches;
  }

  function compareBelongingMatches(a: BelongingSearchMatch, b: BelongingSearchMatch): number {
    return b.score - a.score || a.entry.nameRank - b.entry.nameRank;
  }

  function scoredView(match: BelongingSearchMatch): ScoredBelongingView | null {
    const view = belongingView(match.entry.belonging.id);
    return view ? { ...view, score: match.score } : null;
  }

  function rankedBelongingMatches(query: string): BelongingSearchMatch[] {
    const cached = lruGet(searchMatchCache, query);
    if (cached) return cached;
    const matches = indexedBelongingMatches(query).sort(compareBelongingMatches);
    lruSet(searchMatchCache, query, matches, SEARCH_MATCH_CACHE_LIMIT);
    return matches;
  }

  function searchBelongingsTop(query: string, limit: number): ScoredBelongingView[] {
    ensureTemporalCacheFresh();
    const q = query.trim().toLowerCase();
    const top = indexedBelongingMatches(q, limit);
    return deepFreeze(top.map(scoredView).filter((view): view is ScoredBelongingView => !!view));
  }

  // ------------------------------------------------------------------ read

  function searchBelongings(query = ""): ScoredBelongingView[] {
    ensureTemporalCacheFresh();
    const q = query.trim().toLowerCase();
    const cacheKey = q;
    const cached = lruGet(searchCache, cacheKey);
    if (cached) return cached;
    const rows = rankedBelongingMatches(q)
      .map(scoredView)
      .filter((view): view is ScoredBelongingView => !!view);
    const frozenRows = deepFreeze(rows);
    lruSet(searchCache, cacheKey, frozenRows, SEARCH_CACHE_LIMIT);
    return frozenRows;
  }

  function searchBelongingsPage(query: string, offset: number, limit: number): BelongingSearchPage {
    ensureTemporalCacheFresh();
    if (!Number.isSafeInteger(offset) || offset < 0) throw new DomainInputError("Search offset must be a non-negative integer");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new DomainInputError("Search limit must be an integer from 1 to 200");
    const q = query.trim().toLowerCase();
    const cached = lruGet(searchCache, q);
    if (cached) {
      return deepFreeze({ items: cached.slice(offset, offset + limit), offset, limit, total: cached.length });
    }
    // Rank every match to preserve the established search order, but only
    // materialize the requested Belonging views. Broad HTTP searches therefore
    // avoid allocating evidence/history projections for thousands of rows.
    const matches = rankedBelongingMatches(q);
    const items = matches.slice(offset, offset + limit)
      .map(scoredView)
      .filter((view): view is ScoredBelongingView => !!view);
    return deepFreeze({ items, offset, limit, total: matches.length });
  }

  function belongingView(itemId: string): BelongingView | null {
    ensureTemporalCacheFresh();
    const cacheKey = itemId;
    if (belongingViewCache.has(cacheKey)) return belongingViewCache.get(cacheKey) ?? null;
    const b = belongingOf(itemId);
    if (!b) return null;
    const slot = state.placements.get(itemId) ?? { active: null, history: [] };
    const active = slot.active;
    const chain = active ? chainFor(active.placeRef) : [];
    const view: BelongingView = {
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
    const frozenView = deepFreeze(view);
    belongingViewCache.set(cacheKey, frozenView);
    return frozenView;
  }

  function locate(query: string): LocateAnswer {
    ensureTemporalCacheFresh();
    const cacheKey = query;
    const cached = lruGet(locateCache, cacheKey);
    if (cached) return cached;
    const matches = searchBelongingsTop(query, 4);
    const best = matches[0];
    if (!best) {
      const answer: LocateAnswer = { ok: false, query, sentence: `I have no memory of “${query}”. Add it as a belonging or run a container snapshot.`, nextAction: "add_belonging" };
      const frozenAnswer = deepFreeze(answer);
      lruSet(locateCache, cacheKey, frozenAnswer, LOCATE_CACHE_LIMIT);
      return frozenAnswer;
    }
    const answer = locateById(best.id, { query, alternates: matches.slice(1, 4) });
    const frozenAnswer = deepFreeze(answer);
    lruSet(locateCache, cacheKey, frozenAnswer, LOCATE_CACHE_LIMIT);
    return frozenAnswer;
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
    return deepFreeze({
      ...draft,
      sentence: buildSentence(draft, view),
      hint: view.placement
        ? "If it is not there, mark “not there” and I will open a correction."
        : "Record a placement or run a container snapshot to teach me."
    });
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
    ensureTemporalCacheFresh();
    const cacheKey = containerId;
    if (containerContentsCache.has(cacheKey)) return containerContentsCache.get(cacheKey) ?? null;
    const c = containerOf(containerId);
    if (!c) return null;
    const items: BelongingView[] = [];
    activeItemsByContainerCache ??= (() => {
      const index = new Map<string, string[]>();
      for (const [itemId, slot] of state.placements) {
        if (slot.active?.placeRef.type !== "container") continue;
        const current = index.get(slot.active.placeRef.id) ?? [];
        current.push(itemId);
        index.set(slot.active.placeRef.id, current);
      }
      return index;
    })();
    for (const itemId of activeItemsByContainerCache.get(containerId) ?? []) {
      const b = belongingOf(itemId);
      if (!b || b.mergedInto) continue;
      const view = belongingView(itemId);
      if (view) items.push(view);
    }
    items.sort((a, b) => IMPORTANCE_SCORE[b.importance] - IMPORTANCE_SCORE[a.importance] || a.name.localeCompare(b.name));
    const lastConfirmedAt = c.lastConfirmedAt;
    const staleDays = lastConfirmedAt ? daysAgo(lastConfirmedAt) : null;
    const stale = staleDays === null || staleDays > 30;
    const contents: ContainerContentsView = {
      container: c,
      items,
      lastConfirmedAt,
      daysSinceConfirmed: staleDays,
      stale,
      unknownNote: stale
        ? "Not confirmed recently — there may be unrecorded things inside. Unknown is not empty."
        : null
    };
    const frozenContents = deepFreeze(contents);
    containerContentsCache.set(cacheKey, frozenContents);
    return frozenContents;
  }

  function containersView(): ContainerView[] {
    ensureTemporalCacheFresh();
    if (containersCache) return containersCache;
    const views: ContainerView[] = [];
    for (const c of state.containers.values()) {
      const contents = containerContents(c.id);
      if (!contents) continue;
      views.push({ ...c, itemCount: contents.items.length, stale: contents.stale, daysSinceConfirmed: contents.daysSinceConfirmed });
    }
    containersCache = deepFreeze(views);
    return containersCache;
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

  // Ownership / pre-purchase recall — the durable retention loop. "Do I already
  // own <category>, or a usable substitute, before I buy another?" Category-level
  // over kinds (not one named item), following the same evidence/confidence/
  // freshness contract as locate, and staying honest: owned-but-place-unknown is
  // surfaced, gone items (consumed/retired) are excluded, and an empty result is
  // "no memory", never a fabricated "you don't own one".
  const GONE_STATES: readonly LifecycleState[] = ["consumed", "retired"];
  const NOT_HANDY_STATES: readonly LifecycleState[] = ["laundry", "drying", "lent_out", "missing", "in_transit", "packed"];
  function ownershipRecall(query: string): OwnershipRecallAnswer {
    const q = query.trim();
    const scored = searchBelongings(q);            // ranked over name + kinds
    const qTokens = q.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 1);
    const kindOf = (v: ScoredBelongingView): { matchedKind: string; exact: boolean } => {
      // exact = a kind or the name literally contains a query token; else substitute.
      const hay = [v.name, ...v.kinds].map((s) => s.toLowerCase());
      const exact = qTokens.length > 0 && qTokens.some((t) => hay.some((h) => h.includes(t)));
      const matchedKind = v.kinds[0] ?? v.name;
      return { matchedKind, exact };
    };
    const seen = new Set<string>();
    const matches: OwnershipMatch[] = [];
    for (const v of scored) {
      if (v.mergedInto || seen.has(v.id)) continue;
      if (GONE_STATES.includes(v.state)) continue;      // no longer owned
      seen.add(v.id);
      const { matchedKind, exact } = kindOf(v);
      const stale = v.daysSinceUpdate !== null && v.daysSinceUpdate > 30;
      matches.push({
        itemId: v.id,
        item: v.name,
        matchedKind,
        exact,
        state: v.state,
        available: !NOT_HANDY_STATES.includes(v.state),
        chainText: v.chainText,
        placeKnown: !!v.placement,
        confidence: v.confidence,
        daysSinceUpdate: v.daysSinceUpdate,
        stale
      });
    }
    // exact matches first, then substitutes; available before unavailable within each.
    matches.sort((a, b) => (Number(b.exact) - Number(a.exact)) || (Number(b.available) - Number(a.available)) || (b.confidence - a.confidence));
    const exacts = matches.filter((m) => m.exact);
    const substitutes = matches.filter((m) => !m.exact);
    const ownedCount = exacts.length;
    const substituteCount = substitutes.length;
    const availableCount = matches.filter((m) => m.available).length;

    let verdict: OwnershipRecallAnswer["verdict"];
    let sentence: string;
    let nextAction: OwnershipRecallAnswer["nextAction"];
    if (ownedCount > 0 && exacts.some((m) => m.available)) {
      verdict = "own_available";
      const top = exacts.find((m) => m.available)!;
      const where = top.placeKnown ? top.chainText : "somewhere in your home (place not confirmed)";
      sentence = `You already own ${ownedCount === 1 ? "one" : `${ownedCount}`} — ${top.item} is ${top.available ? "available" : "recorded"} in ${where}. Reuse it before buying${top.stale ? " (worth reconfirming — the record is a bit old)" : ""}.`;
      nextAction = "reuse";
    } else if (ownedCount > 0) {
      verdict = "own_unavailable";
      const top = exacts[0]!;
      sentence = `You own ${ownedCount === 1 ? "one" : `${ownedCount}`}, but ${ownedCount === 1 ? "it is" : "none are"} handy right now (${top.state.replace(/_/g, " ")}). Check before buying another.`;
      nextAction = "locate";
    } else if (substituteCount > 0) {
      verdict = "substitute_only";
      const top = substitutes[0]!;
      const where = top.placeKnown ? top.chainText : "somewhere in your home";
      sentence = `No exact match, but you have ${substituteCount} possible substitute${substituteCount === 1 ? "" : "s"} — e.g. ${top.item} in ${where}. See if one works before buying.`;
      nextAction = "reuse";
    } else {
      verdict = "none";
      sentence = `No memory of owning “${q}” or a substitute. If you're about to buy, you probably don't already have one — but I can only speak to what's been recorded.`;
      nextAction = "consider_buy";
    }
    return deepFreeze({
      ok: true, query: q, ownedCount, substituteCount, availableCount,
      matches: matches.slice(0, 8), verdict, sentence, nextAction
    });
  }

  function attention(): AttentionSummary {
    ensureTemporalCacheFresh();
    if (attentionCache) return attentionCache;
    const all = searchBelongings("");
    attentionCache = deepFreeze({
      staleContainers: staleContainers(),
      uncertainItems: all.filter((v) => v.placement && (v.confidence < 0.45 || (v.daysSinceUpdate ?? 0) > 30)),
      missingItems: all.filter((v) => v.state === "missing"),
      pendingProposals: state.proposals.filter((p) => p.status === "pending").length
    });
    return attentionCache;
  }

  // Declutter Review (Release) — decision SUPPORT only. Surfaces belongings worth
  // a fresh decision with an observed REASON; never infers "unused" from absence
  // of a usage record, never disposes, never shames.
  const DECLUTTER_GONE: readonly LifecycleState[] = ["consumed", "retired"];
  const FLAGGED_STATES: readonly LifecycleState[] = ["missing", "lent_out"];
  function declutterReview(): DeclutterReviewResult {
    ensureTemporalCacheFresh();
    const all = searchBelongings("").filter((v) => !v.mergedInto && !DECLUTTER_GONE.includes(v.state));
    // group by kind to detect duplicates (2+ sharing a primary kind)
    const byKind = new Map<string, typeof all>();
    for (const v of all) {
      const k = v.kinds[0];
      if (!k) continue;
      const bucket = byKind.get(k);
      if (bucket) bucket.push(v); else byKind.set(k, [v]);
    }
    const candidates: DeclutterCandidate[] = [];
    const seen = new Set<string>();
    const baseOptions: DeclutterOption[] = ["keep", "re_home", "reuse", "sell", "donate", "recycle", "discard", "defer"];
    const push = (v: (typeof all)[number], reason: DeclutterReason, because: string, duplicateOf: string[] = []) => {
      if (seen.has(v.id)) return;
      seen.add(v.id);
      candidates.push({
        itemId: v.id, item: v.name, reason, because,
        kind: v.kinds[0] ?? v.name, state: v.state, chainText: v.chainText,
        placeKnown: !!v.placement, daysSinceUpdate: v.daysSinceUpdate, importance: v.importance,
        duplicateOf,
        // essentials are never nudged toward disposal — only keep/re-home/defer.
        options: v.importance === "essential" ? ["keep", "re_home", "defer"] : baseOptions
      });
    };
    // 1) duplicate kinds — an observed fact (two things of the same kind), not a value judgment.
    for (const [kind, items] of byKind) {
      if (items.length < 2) continue;
      for (const v of items) push(v, "duplicate_kind", `You have ${items.length} of kind “${kind.replace(/-/g, " ")}”.`, items.filter((o) => o.id !== v.id).map((o) => o.name));
    }
    // 2) long-unconfirmed placements — the record is old; worth reconfirming or re-homing.
    for (const v of all) {
      if ((v.daysSinceUpdate ?? 0) > 45 && v.placement) push(v, "long_unconfirmed", `Its place hasn't been confirmed in ${v.daysSinceUpdate} days.`);
    }
    // 3) user-flagged lifecycle states (missing / lent out) — facts the user set, not inferred.
    for (const v of all) {
      if (FLAGGED_STATES.includes(v.state)) push(v, "flagged_state", `You marked it “${v.state.replace(/_/g, " ")}”.`);
    }
    const groupDefs: { reason: DeclutterReason; label: string }[] = [
      { reason: "duplicate_kind", label: "Possible duplicates" },
      { reason: "long_unconfirmed", label: "Not confirmed in a while" },
      { reason: "flagged_state", label: "You flagged these" }
    ];
    const groups = groupDefs
      .map((g) => ({ ...g, items: candidates.filter((c) => c.reason === g.reason) }))
      .filter((g) => g.items.length > 0);
    const sentence = candidates.length
      ? `${candidates.length} belonging${candidates.length === 1 ? "" : "s"} worth a fresh decision — you decide, I won't act on my own.`
      : "Nothing is flagged for review. I only surface an item when there's an observed reason.";
    return deepFreeze({
      ok: true, candidates, groups, sentence,
      note: "Decision support only: no item is discarded, hidden, or judged automatically. A blank usage history is never read as “unused”."
    });
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
    if (limit === null || limit === 0) return [...state.commits].reverse();
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Commit view limit must be a positive integer, null, or zero.");
    const start = Math.max(0, state.commits.length - limit);
    return state.commits.slice(start).reverse();
  }

  function exportJson(): ExportDump {
    // Export is a mutable transfer object by contract, never an alias into the
    // append-only in-memory ledger.
    return structuredClone({ version: 2, exportedAt: nowIso(), records, baselineRecords });
  }

  function exportJsonText(options: { pretty?: boolean } = {}): string {
    return JSON.stringify(
      { version: 2, exportedAt: nowIso(), records, baselineRecords },
      null,
      options.pretty ? 2 : undefined
    );
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

  function createRoom(input: CreateRoomInput): string {
    const name = boundedInput(input.name, "Room name", 100);
    const roomId = slugId("room", name, (candidate) => state.rooms.has(candidate) || allocatedIds.has(candidate));
    const room: Room = { id: roomId, name, plan: input.plan ?? nextRoomSlot() };
    appendCommit({ summary: `Add room: ${name}`, ops: [{ type: "create_room", room }] });
    return roomId;
  }

  function createContainer(input: CreateContainerInput): string {
    const name = boundedInput(input.name, "Container name", 120);
    if (!CONTAINER_KIND_VALUES.has(input.kind)) throw new DomainInputError("Unknown container kind.");
    if (!state.rooms.has(input.roomId)) throw new DomainInputError("Unknown room — create the room first.");
    const containerId = slugId("container", name, (candidate) => state.containers.has(candidate) || allocatedIds.has(candidate));
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
    const name = boundedInput(input.name, "Belonging name", 200);
    const kinds = input.kinds ?? [];
    if (kinds.length > 32) throw new DomainInputError("Belonging kinds must contain at most 32 values.");
    if (kinds.some((kind) => !kind.trim() || kind.length > 64)) throw new DomainInputError("Each belonging kind must be 1-64 characters.");
    requirePlace(input.defaultHome);
    if (input.currentPlace) requirePlace(input.currentPlace);
    const itemId = id("item");
    const ev = appendEvidence("user_confirmation", `Created belonging ${name}`);
    const ops: CommitOp[] = [{
      type: "create_belonging",
      belonging: {
        id: itemId,
        name,
        kinds,
        importance: input.importance ?? "normal",
        defaultHome: input.defaultHome,
        ...(input.dimensions ? { dimensions: input.dimensions } : {}),
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
    if (!LIFECYCLE_STATES.includes(lifecycle)) throw new DomainInputError(`Unknown state ${lifecycle}`);
    if (!belongingOf(itemId)) throw new DomainInputError("Unknown belonging");
    appendCommit({
      summary: `Set ${belongingOf(itemId)?.name ?? itemId} state: ${lifecycle}`,
      ops: [{ type: "set_state", itemId, state: lifecycle }]
    });
  }

  // Direct trusted correction: the user explicitly places the item.
  function correctPlacement(itemId: string, placeRef: PlaceRef, opts: { relation?: Relation; note?: string | null } = {}): CommitRecord {
    const b = belongingOf(itemId);
    if (!b) throw new DomainInputError("Unknown belonging");
    requirePlace(placeRef);
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
    if (!b) throw new DomainInputError("Unknown belonging");
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
    return { observationId: obs.id, proposalId: proposal.id };
  }

  function snapshotContainer(containerId: string, seenText: string, photo: PhotoMedia | null = null): string {
    const c = containerOf(containerId);
    if (!c) throw new DomainInputError("Unknown container");
    const normalizedSeenText = boundedInput(seenText, "Snapshot text", 4_000);
    const tokens = [...new Set(normalizedSeenText.split(/[,;]+/).map((token) => token.trim().toLowerCase()).filter(Boolean))];
    if (tokens.length > 100) throw new DomainInputError("Snapshot text must contain at most 100 distinct labels.");
    const obs = append<ObservationRecord>({
      recordType: "observation", id: id("obs"), type: "container_snapshot", at: nowIso(),
      containerId, ...(photo ? { photo } : {}), payload: { seenText: normalizedSeenText }
    });
    // Photo is evidence, never recognition: it rides along with the snapshot
    // and gets cited by any placement the user later accepts from it.
    const snapshotEvidence = append<EvidenceRecord>({
      recordType: "evidence", id: id("ev"),
      kind: photo ? "photo_note" : "snapshot_text",
      summary: `Snapshot of ${c.name}: ${normalizedSeenText}`,
      at: nowIso(),
      ...(photo ? { media: photo } : {})
    });
    const moves: CommitOp[] = [];
    const matchedItems = new Set<string>();
    for (const token of tokens) {
      const match = searchBelongingsTop(token, 1)[0];
      if (!match || match.score < 55 || matchedItems.has(match.id)) continue;
      matchedItems.add(match.id);
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
    return proposal.id;
  }

  function acceptProposal(
    proposalId: string,
    extra: { placeRef?: PlaceRef; placementOverrides?: Record<string, PlaceRef>; mergeKeepId?: string } = {}
  ): CommitRecord {
    const p = state.proposals.find((x) => x.id === proposalId && x.status === "pending");
    if (!p) throw new DomainInputError("No pending proposal with that id");
    const changesExistingRecord = p.suggestedOps.some((op) => op.type === "contradict_placement" || op.type === "merge_belongings");
    const hasInspectableSource = p.sourceObservationIds.some((observationId) => state.observations.some((observation) => observation.id === observationId));
    if (changesExistingRecord && !hasInspectableSource) {
      throw new DomainInputError("This proposal changes an existing record but has no inspectable source observation.");
    }
    const ops: CommitOp[] = [];
    let corrected = false;
    for (const op of p.suggestedOps) {
      if (op.type === "create_placement") {
        const override = extra.placementOverrides?.[op.itemId] ?? extra.placeRef;
        const placeRef = override ?? op.placeRef;
        if (!placeRef) throw new DomainInputError("This correction needs a target place (extra.placeRef).");
        requirePlace(placeRef);
        corrected ||= !!override && (!op.placeRef || op.placeRef.type !== override.type || op.placeRef.id !== override.id);
        ops.push({ ...op, placeRef });
      } else if (op.type === "merge_belongings" && extra.mergeKeepId) {
        const candidates = [op.keepId, op.mergeId];
        if (!candidates.includes(extra.mergeKeepId)) throw new DomainInputError("The survivor must be one of the proposed duplicate records.");
        const mergeId = candidates.find((id) => id !== extra.mergeKeepId);
        if (!mergeId) throw new DomainInputError("The duplicate proposal needs two distinct records.");
        corrected ||= extra.mergeKeepId !== op.keepId;
        ops.push({ ...op, keepId: extra.mergeKeepId, mergeId });
      } else {
        ops.push({ ...op });
      }
    }
    const ev = appendEvidence(
      p.type === "placement_correction" ? "correction" : "user_confirmation",
      `${corrected ? "Accepted corrected proposal" : "Accepted proposal"}: ${p.summary}`
    );
    for (const op of ops) {
      if (op.type === "create_placement") op.evidenceIds = [...(op.evidenceIds ?? []), ev.id];
    }
    if (p.type === "duplicate_merge") {
      const mergeOp = ops.find((o): o is Extract<CommitOp, { type: "merge_belongings" }> => o.type === "merge_belongings");
      if (mergeOp && state.placements.get(mergeOp.mergeId)?.active) {
        ops.push({ type: "contradict_placement", itemId: mergeOp.mergeId, reason: "merged_duplicate" });
      }
    }
    ops.push({ type: "accept_proposal", proposalId });
    const commit = appendCommit({ summary: `${corrected ? "Accept with correction" : "Accept"}: ${p.summary}`, ops, sourceProposalId: proposalId, sourceObservationIds: p.sourceObservationIds });
    try {
      // Proposals are long-lived drafts. Re-run the complete semantic fold only
      // at this low-frequency decision boundary so a once-valid suggestion
      // cannot overwrite an entity or reference that changed in the meantime.
      validateLedgerSemantics(records, catalog, baselineRecords);
    } catch (error) {
      throw new DomainInputError(`Proposal no longer applies cleanly: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    return commit;
  }

  function rejectProposal(proposalId: string, reason = "rejected by user"): CommitRecord {
    const p = state.proposals.find((x) => x.id === proposalId && x.status === "pending");
    if (!p) throw new DomainInputError("No pending proposal with that id");
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new DomainInputError("Proposal rejection reason must not be empty");
    return appendCommit({ summary: `Reject: ${p.summary}`, ops: [{ type: "reject_proposal", proposalId, reason: normalizedReason }], sourceProposalId: proposalId });
  }

  function confirmContainer(containerId: string): CommitRecord {
    const c = containerOf(containerId);
    if (!c) throw new DomainInputError("Unknown container");
    appendEvidence("user_confirmation", `Confirmed contents of ${c.name}`);
    return appendCommit({ summary: `Confirm container: ${c.name}`, ops: [{ type: "confirm_container", containerId }] });
  }

  // ------------------------------------------------------------ operations

  function startOperation(templateId: string): string {
    const template = catalog.operationTemplates.find((t) => t.id === templateId);
    if (!template) throw new DomainInputError("Unknown operation template");
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
    if (!ROW_STATUSES.includes(status)) throw new DomainInputError(`Unknown row status ${status}`);
    const operation = state.operations.get(opId);
    if (!operation || operation.type !== "kit") throw new DomainInputError("Unknown kit operation");
    if (!(operation.rows ?? []).some((row) => row.id === rowId)) throw new DomainInputError("Unknown kit row");
    const op: CommitOp = note !== undefined
      ? { type: "set_op_row_status", opId, rowId, status, note }
      : { type: "set_op_row_status", opId, rowId, status };
    return appendCommit({ summary: `Kit row ${rowId}: ${status}`, ops: [op] });
  }

  function setOperationStatus(opId: string, status: OperationStatus): CommitRecord {
    if (!OPERATION_STATUSES.has(status)) throw new DomainInputError(`Unknown operation status ${status}`);
    if (!state.operations.has(opId)) throw new DomainInputError("Unknown operation");
    return appendCommit({ summary: `Operation ${opId}: ${status}`, ops: [{ type: "set_op_status", opId, status }] });
  }

  function createBox(input: CreateBoxInput): string {
    const label = boundedInput(input.label, "Box label", 100);
    const destination = input.destination?.trim()
      ? boundedInput(input.destination, "Box destination", 200)
      : "New home";
    const roomId = input.roomId ?? state.rooms.keys().next().value;
    if (!roomId || !state.rooms.has(roomId)) throw new DomainInputError("Create a room first — boxes live in rooms.");
    if (input.operationId && !state.operations.has(input.operationId)) throw new DomainInputError("Unknown operation");
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
          box: { label, destination, operationId: input.operationId ?? null }
        }
      }]
    });
    return boxId;
  }

  function assignToBox(itemId: string, boxId: string): CommitRecord {
    const b = belongingOf(itemId);
    const box = containerOf(boxId);
    if (!b || !box || box.kind !== "box") throw new DomainInputError("Need a belonging and a box");
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
    if (!BOX_STATUSES.includes(status)) throw new DomainInputError(`Unknown box status ${status}`);
    const box = containerOf(boxId);
    if (!box || box.kind !== "box") throw new DomainInputError("Unknown box");
    return appendCommit({ summary: `${box.name}: ${status}`, ops: [{ type: "set_box_status", boxId, status }] });
  }

  function unpackItem(itemId: string, placeRef: PlaceRef | null = null): CommitRecord {
    const b = belongingOf(itemId);
    if (!b) throw new DomainInputError("Unknown belonging");
    const target = placeRef ?? b.defaultHome;
    requirePlace(target);
    const activePlace = state.placements.get(itemId)?.active?.placeRef ?? null;
    const fromBoxId = activePlace?.type === "container" && state.containers.get(activePlace.id)?.kind === "box"
      ? activePlace.id
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
    append<CommitRecord>({ recordType: "commit", id: id("commit"), at: nowIso(), summary: "Reset home memory to seed", ops: [{ type: "reset_to_seed" }] });
  }

  function importJson(data: unknown, expectedRevision?: number): void {
    if (expectedRevision !== undefined && expectedRevision !== revision) {
      throw new StoreConflictError("Import conflict: home memory changed while the file was being read.");
    }
    let imported: AnyRecord[];
    let importedBaseline: AnyRecord[];
    try {
      imported = structuredClone(validatedLedgerRecords(data, "Import"));
      importedBaseline = baselineFromDump(data, imported, "Import", baselineRecords);
      validateResetBaseline(importedBaseline, "Import baseline");
      validateLedgerSemantics(importedBaseline, catalog, []);
      validateLedgerSemantics(imported, catalog, importedBaseline);
    } catch (error) {
      if (error instanceof DomainInputError) throw error;
      throw new DomainInputError(error instanceof Error ? error.message : String(error), { cause: error });
    }
    records = imported;
    baselineRecords = importedBaseline;
    seq = records.length;
    rebuildAllocatedIds = true;
  }

  // ------------------------------------------------------------------- api

  const api: Store = {
    get state() { return exposedState; },
    catalog,
    get recordCount() { return records.length; },
    get revision() { return revision; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // read
    searchBelongings, searchBelongingsPage, belongingView, locate, locateById, ownershipRecall, declutterReview,
    containerContents, containersView, staleContainers, whichContainerHas,
    attention, activation, operationsView, operationView, retrievalPlan, unpackPriority,
    proposals, commitsView, exportJson, exportJsonText, planPinFor, chainFor, chainText,
    lifecycleOf,
    // write
    createRoom: (input) => transact(() => createRoom(input)),
    createContainer: (input) => transact(() => createContainer(input)),
    createBelonging: (input) => transact(() => createBelonging(input)),
    setItemState: (itemId, lifecycle) => transact(() => setItemState(itemId, lifecycle)),
    correctPlacement: (itemId, placeRef, opts) => transact(() => correctPlacement(itemId, placeRef, opts)),
    markNotThere: (itemId) => transact(() => markNotThere(itemId)),
    snapshotContainer: (containerId, seenText, photo) => transact(() => snapshotContainer(containerId, seenText, photo)),
    acceptProposal: (proposalId, extra) => transact(() => acceptProposal(proposalId, extra)),
    rejectProposal: (proposalId, reason) => transact(() => rejectProposal(proposalId, reason)),
    confirmContainer: (containerId) => transact(() => confirmContainer(containerId)),
    startOperation: (templateId) => transact(() => startOperation(templateId)),
    setRowStatus: (opId, rowId, status, note) => transact(() => setRowStatus(opId, rowId, status, note)),
    setOperationStatus: (opId, status) => transact(() => setOperationStatus(opId, status)),
    createBox: (input) => transact(() => createBox(input)),
    assignToBox: (itemId, boxId) => transact(() => assignToBox(itemId, boxId)),
    setBoxStatus: (boxId, status) => transact(() => setBoxStatus(boxId, status)),
    unpackItem: (itemId, placeRef) => transact(() => unpackItem(itemId, placeRef)),
    reset: () => transact(reset),
    importJson: (data, expectedRevision) => transact(() => importJson(data, expectedRevision))
  };
  return api;
}

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}
