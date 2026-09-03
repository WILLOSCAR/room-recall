// Nestory V2 domain types.
// This file is the typed contract of the Place Graph: catalog entities,
// append-only records, commit ops (the write model), and derived views
// (the read model). A future backend implements exactly these shapes.

// ------------------------------------------------------------------ places

export type PlaceRefType = "room" | "furniture" | "container" | "state";

export interface PlaceRef {
  type: PlaceRefType;
  id: string;
}

export type Relation = "inside" | "on_surface" | "under" | "attached_to" | "near";

export type LifecycleState =
  | "at_home" | "with_me" | "packed" | "in_transit" | "laundry"
  | "drying" | "lent_out" | "consumed" | "missing" | "retired";

export type BoxStatus = "empty" | "packing" | "packed" | "moved" | "opened" | "unpacked";

export type RowStatus = "to_get" | "found" | "packed" | "skipped" | "substituted" | "missing" | "uncertain";

export type Importance = "essential" | "high" | "normal";

// ----------------------------------------------------------------- catalog

export interface PlanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dimensions3D {
  width: number;
  depth: number;
  height: number;
  unit: "m";
  source: "manual" | "product" | "scan";
  verified: boolean;
}

export interface Room {
  id: string;
  name: string;
  plan: PlanRect;
}

export interface Furniture {
  id: string;
  name: string;
  room: string;
  plan: PlanRect;
}

export type ContainerKind =
  | "drawer" | "shelf" | "surface" | "basket" | "bag" | "suitcase" | "tray" | "box";

export interface BoxMeta {
  label: string;
  destination: string;
  operationId: string | null;
}

export interface Container {
  id: string;
  name: string;
  kind: ContainerKind;
  parent: PlaceRef;
  note?: string;
  box?: BoxMeta;
}

export interface Belonging {
  id: string;
  name: string;
  kinds: string[];
  importance: Importance;
  defaultHome: PlaceRef;
  group?: boolean;
  note?: string;
  dimensions?: Dimensions3D;
  source?: "manual" | "product" | "scan";
}

export type ReqLevel = "required" | "optional";

export interface KitRequirement {
  id: string;
  label: string;
  kindsAny: string[];
  level: ReqLevel;
  substituteGroup?: boolean;
}

export interface Kit {
  id: string;
  name: string;
  requirements: KitRequirement[];
}

export type OperationType = "move" | "kit";
export type OperationStatus = "active" | "done" | "abandoned";

export interface OperationTemplate {
  id: string;
  name: string;
  type: OperationType;
  kitId?: string | null;
  description: string;
}

export interface Catalog {
  rooms: Room[];
  furniture: Furniture[];
  containers: Container[];
  belongings: Belonging[];
  kits: Kit[];
  operationTemplates: OperationTemplate[];
}

// -------------------------------------------------------------- operations

export interface KitRow {
  id: string;
  reqId: string;
  reqLabels: string[];
  level: ReqLevel;
  itemId: string | null;
  status: RowStatus;
  note: string | null;
  mergedRequirement: boolean;
  sharedWith?: string[];
  updatedAt?: string;
}

export interface OperationData {
  id: string;
  type: OperationType;
  kitId?: string | null;
  name: string;
  startedAt: string;
  status: OperationStatus;
  rows?: KitRow[];
}

// --------------------------------------------------- append-only records

export type EvidenceKind =
  | "user_confirmation" | "seed_import" | "negative_report"
  | "correction" | "snapshot_text" | "photo_note";

/** A downscaled photo stored inline (data URL). Evidence, never recognition. */
export interface PhotoMedia {
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface EvidenceRecord {
  recordType: "evidence";
  id: string;
  kind: EvidenceKind;
  summary: string;
  at: string;
  media?: PhotoMedia;
}

export type ObservationType =
  | "container_snapshot" | "not_there_report" | "duplicate_suspected"
  | "stale_container_flag" | "manual_note";

export interface ObservationRecord {
  recordType: "observation";
  id: string;
  type: ObservationType;
  at: string;
  itemId?: string;
  containerId?: string;
  photo?: PhotoMedia;
  payload?: Record<string, unknown>;
}

export type ProposalType =
  | "placement_correction" | "contents_update" | "duplicate_merge" | "container_refresh";

export interface ProposalRecord {
  recordType: "proposal";
  id: string;
  type: ProposalType;
  at: string;
  sourceObservationIds: string[];
  summary: string;
  suggestedOps: CommitOp[];
  needsPlace?: boolean;
}

export interface CommitRecord {
  recordType: "commit";
  id: string;
  at: string;
  summary: string;
  ops: CommitOp[];
  sourceProposalId?: string | null;
  sourceObservationIds?: string[];
}

export type AnyRecord = EvidenceRecord | ObservationRecord | ProposalRecord | CommitRecord;

// ------------------------------------------------------------- commit ops
// The typed write model: every mutation of the Place Graph is one of these.
// `create_placement.placeRef` may be null only inside proposal suggestions
// ("you choose where"); the store rejects commits without a concrete place.

export type CommitOp =
  | { type: "create_placement"; itemId: string; placeRef: PlaceRef | null; relation: Relation; confidence: number; evidenceIds?: string[] }
  | { type: "contradict_placement"; itemId: string; reason?: string; evidenceIds?: string[] }
  | { type: "set_state"; itemId: string; state: LifecycleState }
  | { type: "create_belonging"; belonging: Belonging }
  | { type: "create_room"; room: Room }
  | { type: "create_container"; container: Container }
  | { type: "set_box_status"; boxId: string; status: BoxStatus }
  | { type: "confirm_container"; containerId: string }
  | { type: "create_operation"; operation: OperationData }
  | { type: "set_op_row_status"; opId: string; rowId: string; status: RowStatus; note?: string | null }
  | { type: "set_op_status"; opId: string; status: OperationStatus }
  | { type: "merge_belongings"; keepId: string; mergeId: string }
  | { type: "accept_proposal"; proposalId: string }
  | { type: "reject_proposal"; proposalId: string; reason?: string }
  | { type: "reset_to_seed" };

// -------------------------------------------------------- derived entities

export interface BelongingEntity extends Belonging {
  mergedInto?: string;
  mergedAt?: string;
  createdAt?: string;
  createdBySeed?: boolean;
}

export interface ContainerEntity extends Container {
  boxStatus: BoxStatus | null;
  lastConfirmedAt: string | null;
  boxStatusAt?: string;
  createdAt?: string;
  createdBySeed?: boolean;
}

export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface ProposalView extends ProposalRecord {
  status: ProposalStatus;
  resolvedBy: string | null;
  resolvedAt?: string;
  rejectReason?: string | null;
}

export interface PlacementView {
  id: string;
  itemId: string;
  placeRef: PlaceRef;
  relation: Relation;
  confidence: number;
  at: string;
  evidenceIds: string[];
  commitId: string;
  contradictedAt: string | null;
  contradictedReason: string | null;
  supersededAt?: string;
}

export interface PlacementSlot {
  active: PlacementView | null;
  history: PlacementView[];
}

export interface DerivedState {
  rooms: Map<string, Room>;
  belongings: Map<string, BelongingEntity>;
  containers: Map<string, ContainerEntity>;
  evidence: Map<string, EvidenceRecord>;
  observations: ObservationRecord[];
  proposals: ProposalView[];
  operations: Map<string, OperationData>;
  commits: CommitRecord[];
  placements: Map<string, PlacementSlot>;
  states: Map<string, { state: LifecycleState; at: string }>;
  negatives: Map<string, string>;
}

// ----------------------------------------------------------- derived views

export type PlaceNode =
  | { type: "room"; id: string; name: string }
  | { type: "furniture"; id: string; name: string }
  | { type: "container"; id: string; name: string; kind: ContainerKind; box: BoxMeta | null }
  | { type: "state"; id: string; name: string };

export interface EvidenceView {
  kind: EvidenceKind;
  summary: string;
  at: string;
  media?: PhotoMedia;
}

export interface PlanPin {
  roomId: string;
  x: number;
  y: number;
}

export interface BelongingView {
  id: string;
  name: string;
  kinds: string[];
  importance: Importance;
  group: boolean;
  mergedInto: string | null;
  state: LifecycleState;
  defaultHome: PlaceRef;
  defaultHomeText: string;
  placement: PlacementView | null;
  chain: PlaceNode[];
  chainText: string;
  atDefaultHome: boolean;
  confidence: number;
  updatedAt: string | null;
  daysSinceUpdate: number | null;
  history: PlacementView[];
  dimensions?: Dimensions3D;
  source?: "manual" | "product" | "scan";
}

export type ScoredBelongingView = BelongingView & { score: number };

export interface LocateSuccess {
  ok: true;
  query: string | null;
  itemId: string;
  item: string;
  state: LifecycleState;
  placement: PlacementView | null;
  chain: PlaceNode[];
  chainText: string;
  defaultHomeText: string;
  atDefaultHome: boolean;
  evidence: EvidenceView[];
  confidence: number;
  lastUpdatedAt: string | null;
  daysSinceUpdate: number | null;
  stale: boolean;
  uncertain: boolean;
  alternates: ScoredBelongingView[];
  planPin: PlanPin | null;
  nextAction: string;
  sentence: string;
  hint: string;
}

export interface LocateFailure {
  ok: false;
  query: string | null;
  sentence: string;
  nextAction: "add_belonging";
}

export type LocateAnswer = LocateSuccess | LocateFailure;

export interface ContainerContentsView {
  container: ContainerEntity;
  items: BelongingView[];
  lastConfirmedAt: string | null;
  daysSinceConfirmed: number | null;
  stale: boolean;
  unknownNote: string | null;
}

export interface ContainerView extends ContainerEntity {
  itemCount: number;
  stale: boolean;
  daysSinceConfirmed: number | null;
}

export interface ContainerWithContentsView extends ContainerView {
  contents: BelongingView[];
}

export interface KitRowView extends KitRow {
  item: BelongingView | null;
}

export interface KitReadiness {
  status: "ready" | "missing_items" | "needs_review";
  missing: number;
  unresolved: number;
}

export interface MoveReadiness {
  status: "ready" | "in_progress" | "needs_review";
  openBoxes?: number;
  note?: string;
}

export interface OperationViewBase {
  id: string;
  name: string;
  startedAt: string;
  status: OperationStatus;
  kitId?: string | null;
}

export interface MoveOperationView extends OperationViewBase {
  type: "move";
  boxes: ContainerWithContentsView[];
  packedCount: number;
  readiness: MoveReadiness;
}

export interface KitOperationView extends OperationViewBase {
  type: "kit";
  rows: KitRowView[];
  readiness: KitReadiness;
}

export type OperationView = MoveOperationView | KitOperationView;

export interface UnpackPriorityEntry {
  box: ContainerView;
  contents: BelongingView[];
  score: number;
  essentials: string[];
}

export interface WhichContainerHit {
  item: string;
  itemId: string;
  container: ContainerEntity;
  chainText: string;
  isBox: boolean;
  boxStatus: BoxStatus | null;
}

export interface AttentionSummary {
  staleContainers: ContainerView[];
  uncertainItems: ScoredBelongingView[];
  missingItems: ScoredBelongingView[];
  pendingProposals: number;
}

export interface RetrievalPlanItem {
  rowId: string;
  itemId: string | null;
  name: string;
  status: RowStatus;
  note: string | null;
}

/** Kit checklist compiled into pickup stops: one group per furniture (or room). */
export interface RetrievalPlanGroup {
  key: string;
  label: string;
  roomName: string | null;
  needsReview: boolean;
  items: RetrievalPlanItem[];
}

/** PRD §8 activation metric, derived live from the Place Graph. */
export interface ActivationSummary {
  rooms: number;
  containers: number;
  belongings: number;
  operations: number;
  complete: boolean;
}

export interface ExportDump {
  version: 2;
  exportedAt: string;
  records: AnyRecord[];
}

// ------------------------------------------------------------------ store

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoreOptions {
  catalog: Catalog;
  seedFactory?: () => AnyRecord[];
  now?: () => number;
  storage?: StorageLike | null;
  persistKey?: string;
}

export interface CreateBelongingInput {
  name: string;
  kinds?: string[];
  importance?: Importance;
  defaultHome: PlaceRef;
  currentPlace?: PlaceRef | null;
  relation?: Relation;
  dimensions?: Dimensions3D;
  source?: "manual" | "product" | "scan";
}

export interface CreateBoxInput {
  label: string;
  destination?: string;
  operationId?: string | null;
  roomId?: string;
}

export interface CreateRoomInput {
  name: string;
  plan?: PlanRect;
}

export interface CreateContainerInput {
  name: string;
  kind: ContainerKind;
  roomId: string;
}

export interface Store {
  readonly state: DerivedState;
  readonly catalog: Catalog;
  subscribe(fn: (state: DerivedState) => void): () => void;

  // read
  searchBelongings(query?: string): ScoredBelongingView[];
  belongingView(itemId: string): BelongingView | null;
  locate(query: string): LocateAnswer;
  locateById(itemId: string, ctx?: { query?: string | null; alternates?: ScoredBelongingView[] }): LocateAnswer;
  containerContents(containerId: string): ContainerContentsView | null;
  containersView(): ContainerView[];
  staleContainers(): ContainerView[];
  whichContainerHas(query: string): WhichContainerHit[];
  attention(): AttentionSummary;
  activation(): ActivationSummary;
  operationsView(): OperationView[];
  operationView(opId: string): OperationView | null;
  retrievalPlan(opId: string): RetrievalPlanGroup[];
  unpackPriority(opId?: string | null): UnpackPriorityEntry[];
  proposals(statusFilter?: ProposalStatus | null): ProposalView[];
  commitsView(limit?: number | null): CommitRecord[];
  exportJson(): ExportDump;
  planPinFor(ref: PlaceRef): PlanPin | null;
  chainFor(ref: PlaceRef | null): PlaceNode[];
  chainText(chain: PlaceNode[]): string;
  lifecycleOf(itemId: string): LifecycleState;

  // write
  createRoom(input: CreateRoomInput): string;
  createContainer(input: CreateContainerInput): string;
  createBelonging(input: CreateBelongingInput): string;
  setItemState(itemId: string, lifecycle: LifecycleState): void;
  correctPlacement(itemId: string, placeRef: PlaceRef, opts?: { relation?: Relation; note?: string | null }): CommitRecord;
  markNotThere(itemId: string): { observationId: string; proposalId: string };
  snapshotContainer(containerId: string, seenText: string, photo?: PhotoMedia | null): string;
  acceptProposal(proposalId: string, extra?: { placeRef?: PlaceRef }): CommitRecord;
  rejectProposal(proposalId: string, reason?: string): CommitRecord;
  confirmContainer(containerId: string): CommitRecord;
  startOperation(templateId: string): string;
  setRowStatus(opId: string, rowId: string, status: RowStatus, note?: string | null): CommitRecord;
  setOperationStatus(opId: string, status: OperationStatus): CommitRecord;
  createBox(input: CreateBoxInput): string;
  assignToBox(itemId: string, boxId: string): CommitRecord;
  setBoxStatus(boxId: string, status: BoxStatus): CommitRecord;
  unpackItem(itemId: string, placeRef?: PlaceRef | null): CommitRecord;
  reset(): void;
  importJson(data: unknown): void;
}

export const LIFECYCLE_STATES: readonly LifecycleState[] = [
  "at_home", "with_me", "packed", "in_transit", "laundry", "drying",
  "lent_out", "consumed", "missing", "retired"
];

export const BOX_STATUSES: readonly BoxStatus[] = ["empty", "packing", "packed", "moved", "opened", "unpacked"];

export const ROW_STATUSES: readonly RowStatus[] = ["to_get", "found", "packed", "skipped", "substituted", "missing", "uncertain"];

export const OPERATION_STATUSES: readonly OperationStatus[] = ["active", "done", "abandoned"];

export const CONTAINER_KINDS: readonly ContainerKind[] = ["drawer", "shelf", "surface", "basket", "bag", "suitcase", "tray", "box"];

export const IMPORTANCE_SCORE: Record<Importance, number> = { essential: 3, high: 2, normal: 1 };
