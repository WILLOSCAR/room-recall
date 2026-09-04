// Import validation for the record ledger.
//
// `importJson` is a trust boundary: the dump can come from a file a person edited,
// a stale export, or a hostile source. Without validation a bad dump silently
// replaces the whole home memory, and the failure only surfaces later — after the
// replacement has already been persisted.
//
// Validation happens in two passes, deliberately separate because they answer
// different questions and need different inputs:
//
//   `validatedLedgerRecords` — SHAPE. Required fields, types, value domains, numeric
//   ranges, timestamps, duplicate ids. Needs only the dump. A record that passes is
//   well-formed.
//
//   `validateLedgerSemantics` — MEANING. Whether each reference actually resolves:
//   does this `placeRef` name a room that exists, does this `itemId` resolve to a
//   belonging, was this proposal still pending. Needs the catalog and the ledger
//   replayed in order, because a dump may legitimately create a room and then place
//   something in it. Well-formed is not the same as meaningful, and shape is never
//   treated as authority for meaning.
import type {
  AnyRecord, Belonging, Catalog, CommitOp, Container, OperationData, PhotoMedia, PlaceRef, Room
} from "./types.ts";
import {
  BOX_STATUSES, CONTAINER_KINDS, LIFECYCLE_STATES as LIFECYCLE_STATE_VALUES,
  OPERATION_STATUSES as OPERATION_STATUS_VALUES, ROW_STATUSES as ROW_STATUS_VALUES
} from "./types.ts";

type ObjectValue = Record<string, unknown>;

// NO length caps here, deliberately. Export is a backup, so whatever the write path
// accepts the import path must accept back; a cap the writer does not enforce turns a
// legitimate export into a file the product refuses to restore. `createRoom`,
// `createContainer`, `createBelonging` and `createBox` impose no length limit, no form
// carries `maxlength`, and `createBox` even prefixes "Box · " to the label — so any
// import-side ceiling is an asymmetry, not a safeguard. Three review rounds each found a
// different field where such a cap broke the round trip; the invariant is locked by
// `import-accepts-everything-the-write-path-writes`, which drives every write method at
// and beyond its boundaries. Real size limits belong at the writer (or the JSON parse and
// storage quota), not at the reader.

const RECORD_TYPES = new Set(["evidence", "observation", "proposal", "commit"]);
const EVIDENCE_KINDS = new Set(["user_confirmation", "seed_import", "negative_report", "correction", "snapshot_text", "photo_note"]);
const OBSERVATION_TYPES = new Set(["container_snapshot", "not_there_report", "duplicate_suspected", "stale_container_flag", "manual_note"]);
const PROPOSAL_TYPES = new Set(["placement_correction", "contents_update", "duplicate_merge", "container_refresh"]);
const PLACE_TYPES = new Set(["room", "furniture", "container", "state"]);
const RELATIONS = new Set(["inside", "on_surface", "under", "attached_to", "near"]);
const IMPORTANCE = new Set(["essential", "high", "normal"]);
const SOURCES = new Set(["manual", "product", "scan"]);
const OPERATION_TYPES = new Set(["move", "kit"]);
const ROW_LEVELS = new Set(["required", "optional"]);

const LIFECYCLE_STATES = new Set<string>(LIFECYCLE_STATE_VALUES);
const BOX_STATUSES_SET = new Set<string>(BOX_STATUSES);
const ROW_STATUSES = new Set<string>(ROW_STATUS_VALUES);
const OPERATION_STATUSES = new Set<string>(OPERATION_STATUS_VALUES);
const CONTAINER_KINDS_SET = new Set<string>(CONTAINER_KINDS);

const COMMIT_OPS = new Set([
  "create_placement", "contradict_placement", "set_state", "create_belonging",
  "create_room", "create_container", "set_box_status", "confirm_container",
  "create_operation", "set_op_row_status", "set_op_status", "merge_belongings",
  "accept_proposal", "reject_proposal", "reset_to_seed",
]);

function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as ObjectValue;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}

/** Any free-text field the store may write as an empty string. `correctPlacement` passes
 *  a caller's `note` straight into an evidence `summary` with only `??` guarding it, so
 *  `""` and whitespace both reach the ledger; the agent toolkit likewise permits a blank
 *  `reject_proposal.reason`. Requiring non-empty text here would make the product's own
 *  export unreadable, so free text is validated for TYPE, not for emptiness. */
function freeText(value: unknown, path: string): void {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
}

/** An optional free-text field. Accepts absent, null, and the EMPTY string, for the same
 *  reason as `freeText`. */
function optionalString(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
}

/** For a field the type declares as `string | null` — present but nullable. Absence is
 *  NOT the same as null: an absent key produces an object that violates its own
 *  declared type, and downstream reads like `box?.operationId === opId` then compare
 *  against `undefined` and silently mismatch. */
function nullableString(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`${path} must be present (use null when empty)`);
  if (value === null) return;
  if (typeof value !== "string") throw new Error(`${path} must be a string or null`);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return value;
}

function oneOf(value: unknown, values: ReadonlySet<string>, path: string): string {
  const found = string(value, path);
  if (!values.has(found)) throw new Error(`${path} has unsupported value ${JSON.stringify(found)}`);
  return found;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((entry, index) => string(entry, `${path}[${index}]`));
}

function timestamp(value: unknown, path: string): void {
  const iso = string(value, path);
  // `Date.parse` alone is far too permissive — it reads "5" as a date. Records are always
  // written by `toISOString()`, so require that shape before parsing.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) || !Number.isFinite(Date.parse(iso))) {
    throw new Error(`${path} must be a valid ISO timestamp`);
  }
}

/** Shape only: a well-formed reference. Whether the referenced place EXISTS is a
 *  semantic question this module does not answer. */
function placeRef(value: unknown, path: string): PlaceRef {
  const ref = object(value, path);
  oneOf(ref["type"], PLACE_TYPES, `${path}.type`);
  string(ref["id"], `${path}.id`);
  return ref as unknown as PlaceRef;
}

function plan(value: unknown, path: string): void {
  const rect = object(value, path);
  finiteNumber(rect["x"], `${path}.x`);
  finiteNumber(rect["y"], `${path}.y`);
  if (finiteNumber(rect["w"], `${path}.w`) <= 0 || finiteNumber(rect["h"], `${path}.h`) <= 0) {
    throw new Error(`${path} dimensions must be positive`);
  }
}

function dimensions(value: unknown, path: string): void {
  const size = object(value, path);
  if (finiteNumber(size["width"], `${path}.width`) <= 0
    || finiteNumber(size["depth"], `${path}.depth`) <= 0
    || finiteNumber(size["height"], `${path}.height`) <= 0) {
    throw new Error(`${path} dimensions must be positive`);
  }
  if (size["unit"] !== "m") throw new Error(`${path}.unit must be "m"`);
  oneOf(size["source"], SOURCES, `${path}.source`);
  if (typeof size["verified"] !== "boolean") throw new Error(`${path}.verified must be a boolean`);
}

function media(value: unknown, path: string): PhotoMedia {
  const photo = object(value, path);
  const dataUrl = string(photo["dataUrl"], `${path}.dataUrl`);
  if (!dataUrl.startsWith("data:image/")) throw new Error(`${path}.dataUrl must contain image media`);
  // Optional fields accept both absent and null throughout this module; width/height
  // follow the same rule rather than rejecting null where siblings allow it.
  if (photo["width"] !== undefined && photo["width"] !== null && finiteNumber(photo["width"], `${path}.width`) <= 0) throw new Error(`${path}.width must be positive`);
  if (photo["height"] !== undefined && photo["height"] !== null && finiteNumber(photo["height"], `${path}.height`) <= 0) throw new Error(`${path}.height must be positive`);
  return photo as unknown as PhotoMedia;
}

function room(value: unknown, path: string): Room {
  const candidate = object(value, path);
  string(candidate["id"], `${path}.id`);
  string(candidate["name"], `${path}.name`);
  plan(candidate["plan"], `${path}.plan`);
  return candidate as unknown as Room;
}

function container(value: unknown, path: string): Container {
  const candidate = object(value, path);
  string(candidate["id"], `${path}.id`);
  string(candidate["name"], `${path}.name`);
  oneOf(candidate["kind"], CONTAINER_KINDS_SET, `${path}.kind`);
  placeRef(candidate["parent"], `${path}.parent`);
  optionalString(candidate["note"], `${path}.note`);
  if (candidate["box"] !== undefined && candidate["box"] !== null) {
    const box = object(candidate["box"], `${path}.box`);
    string(box["label"], `${path}.box.label`);
    string(box["destination"], `${path}.box.destination`);
    nullableString(box["operationId"], `${path}.box.operationId`);
  }
  return candidate as unknown as Container;
}

function belonging(value: unknown, path: string): Belonging {
  const candidate = object(value, path);
  string(candidate["id"], `${path}.id`);
  string(candidate["name"], `${path}.name`);
  strings(candidate["kinds"], `${path}.kinds`);
  oneOf(candidate["importance"], IMPORTANCE, `${path}.importance`);
  placeRef(candidate["defaultHome"], `${path}.defaultHome`);
  if (candidate["group"] !== undefined && typeof candidate["group"] !== "boolean") throw new Error(`${path}.group must be a boolean`);
  optionalString(candidate["note"], `${path}.note`);
  if (candidate["dimensions"] !== undefined && candidate["dimensions"] !== null) dimensions(candidate["dimensions"], `${path}.dimensions`);
  if (candidate["source"] !== undefined && candidate["source"] !== null) oneOf(candidate["source"], SOURCES, `${path}.source`);
  return candidate as unknown as Belonging;
}

function operation(value: unknown, path: string): OperationData {
  const candidate = object(value, path);
  string(candidate["id"], `${path}.id`);
  const type = oneOf(candidate["type"], OPERATION_TYPES, `${path}.type`);
  optionalString(candidate["kitId"], `${path}.kitId`);
  if (type === "move" && candidate["kitId"] !== undefined && candidate["kitId"] !== null) throw new Error(`${path}.kitId is only valid for kit operations`);
  freeText(candidate["name"], `${path}.name`);
  timestamp(candidate["startedAt"], `${path}.startedAt`);
  oneOf(candidate["status"], OPERATION_STATUSES, `${path}.status`);
  if (candidate["rows"] !== undefined && candidate["rows"] !== null) {
    if (!Array.isArray(candidate["rows"])) throw new Error(`${path}.rows must be an array`);
    if (type !== "kit") throw new Error(`${path}.rows are only valid for kit operations`);
    candidate["rows"].forEach((entry, index) => {
      const rowPath = `${path}.rows[${index}]`;
      const row = object(entry, rowPath);
      string(row["id"], `${rowPath}.id`);
      string(row["reqId"], `${rowPath}.reqId`);
      strings(row["reqLabels"], `${rowPath}.reqLabels`);
      oneOf(row["level"], ROW_LEVELS, `${rowPath}.level`);
      nullableString(row["itemId"], `${rowPath}.itemId`);
      oneOf(row["status"], ROW_STATUSES, `${rowPath}.status`);
      nullableString(row["note"], `${rowPath}.note`);
      if (typeof row["mergedRequirement"] !== "boolean") throw new Error(`${rowPath}.mergedRequirement must be a boolean`);
      if (row["sharedWith"] !== undefined && row["sharedWith"] !== null) strings(row["sharedWith"], `${rowPath}.sharedWith`);
      if (row["updatedAt"] !== undefined && row["updatedAt"] !== null) timestamp(row["updatedAt"], `${rowPath}.updatedAt`);
    });
  }
  return candidate as unknown as OperationData;
}

function commitOps(value: unknown, path: string, allowUnknownPlace: boolean): CommitOp[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((entry, index) => {
    const opPath = `${path}[${index}]`;
    const op = object(entry, opPath);
    const type = oneOf(op["type"], COMMIT_OPS, `${opPath}.type`);
    switch (type) {
      case "create_placement":
        string(op["itemId"], `${opPath}.itemId`);
        if (op["placeRef"] === null) {
          if (!allowUnknownPlace) throw new Error(`${opPath}.placeRef must be concrete in a Commit`);
        } else {
          placeRef(op["placeRef"], `${opPath}.placeRef`);
        }
        oneOf(op["relation"], RELATIONS, `${opPath}.relation`);
        if (finiteNumber(op["confidence"], `${opPath}.confidence`) < 0 || finiteNumber(op["confidence"], `${opPath}.confidence`) > 1) {
          throw new Error(`${opPath}.confidence must be between 0 and 1`);
        }
        if (op["evidenceIds"] !== undefined) strings(op["evidenceIds"], `${opPath}.evidenceIds`);
        break;
      case "contradict_placement":
        string(op["itemId"], `${opPath}.itemId`);
        optionalString(op["reason"], `${opPath}.reason`);
        if (op["evidenceIds"] !== undefined) strings(op["evidenceIds"], `${opPath}.evidenceIds`);
        break;
      case "set_state":
        string(op["itemId"], `${opPath}.itemId`);
        oneOf(op["state"], LIFECYCLE_STATES, `${opPath}.state`);
        break;
      case "create_belonging": belonging(op["belonging"], `${opPath}.belonging`); break;
      case "create_room": room(op["room"], `${opPath}.room`); break;
      case "create_container": container(op["container"], `${opPath}.container`); break;
      case "set_box_status":
        string(op["boxId"], `${opPath}.boxId`);
        oneOf(op["status"], BOX_STATUSES_SET, `${opPath}.status`);
        break;
      case "confirm_container": string(op["containerId"], `${opPath}.containerId`); break;
      case "create_operation": operation(op["operation"], `${opPath}.operation`); break;
      case "set_op_row_status":
        string(op["opId"], `${opPath}.opId`);
        string(op["rowId"], `${opPath}.rowId`);
        oneOf(op["status"], ROW_STATUSES, `${opPath}.status`);
        optionalString(op["note"], `${opPath}.note`);
        break;
      case "set_op_status":
        string(op["opId"], `${opPath}.opId`);
        oneOf(op["status"], OPERATION_STATUSES, `${opPath}.status`);
        break;
      case "merge_belongings":
        string(op["keepId"], `${opPath}.keepId`);
        string(op["mergeId"], `${opPath}.mergeId`);
        break;
      case "accept_proposal":
      case "reject_proposal":
        string(op["proposalId"], `${opPath}.proposalId`);
        if (type === "reject_proposal") optionalString(op["reason"], `${opPath}.reason`);
        break;
      case "reset_to_seed": break;
    }
    return op as unknown as CommitOp;
  });
}

/** Validate the shape of a ledger dump and return its records.
 *
 *  Throws on the first problem, with a path naming where it was found, BEFORE the
 *  caller has any validated records to install — so a caller that only assigns on
 *  success cannot half-apply a bad dump.
 *
 *  Scope: field shapes, value domains, ranges, timestamps, duplicate ids. NOT
 *  referential integrity (see the module comment). */
export function validatedLedgerRecords(data: unknown, source: string): AnyRecord[] {
  const dump = object(data, source);
  if (dump["version"] !== 2) throw new Error(`${source} has unsupported schema version; expected version 2`);
  if (!Array.isArray(dump["records"])) throw new Error(`${source} must contain a records array`);
  // An empty dump is refused rather than treated as "replace everything with nothing".
  // Accepting it wiped the home memory, and because `loadRecords` falls back to the
  // seed when the stored array is empty, the next reload silently resurrected the demo
  // seed instead of showing the empty ledger that was imported.
  if (dump["records"].length === 0) throw new Error(`${source} contains no records; nothing would remain of your home memory`);

  const ids = new Set<string>();
  return dump["records"].map((entry, index) => {
    const path = `Record ${index + 1}`;
    const record = object(entry, path);
    const type = oneOf(record["recordType"], RECORD_TYPES, `${path}.recordType`);
    const id = string(record["id"], `${path}.id`);
    if (ids.has(id)) throw new Error(`${path}.id duplicates ${JSON.stringify(id)}`);
    ids.add(id);
    timestamp(record["at"], `${path}.at`);

    if (type === "evidence") {
      oneOf(record["kind"], EVIDENCE_KINDS, `${path}.kind`);
      freeText(record["summary"], `${path}.summary`);
      if (record["media"] !== undefined && record["media"] !== null) media(record["media"], `${path}.media`);
    } else if (type === "observation") {
      oneOf(record["type"], OBSERVATION_TYPES, `${path}.type`);
      optionalString(record["itemId"], `${path}.itemId`);
      optionalString(record["containerId"], `${path}.containerId`);
      if (record["photo"] !== undefined && record["photo"] !== null) media(record["photo"], `${path}.photo`);
      if (record["payload"] !== undefined && record["payload"] !== null) object(record["payload"], `${path}.payload`);
    } else if (type === "proposal") {
      oneOf(record["type"], PROPOSAL_TYPES, `${path}.type`);
      strings(record["sourceObservationIds"], `${path}.sourceObservationIds`);
      freeText(record["summary"], `${path}.summary`);
      if (record["needsPlace"] !== undefined && typeof record["needsPlace"] !== "boolean") throw new Error(`${path}.needsPlace must be a boolean`);
      // A proposal SUGGESTS; it may leave the place for the person to choose, so a
      // null placeRef is allowed here and rejected in a commit.
      const suggestedOps = commitOps(record["suggestedOps"], `${path}.suggestedOps`, true);
      if (suggestedOps.some((op) => op.type === "reset_to_seed" || op.type === "accept_proposal" || op.type === "reject_proposal")) {
        throw new Error(`${path}.suggestedOps cannot contain reset or proposal-decision operations`);
      }
    } else {
      freeText(record["summary"], `${path}.summary`);
      commitOps(record["ops"], `${path}.ops`, false);
      optionalString(record["sourceProposalId"], `${path}.sourceProposalId`);
      if (record["sourceObservationIds"] !== undefined) strings(record["sourceObservationIds"], `${path}.sourceObservationIds`);
    }
    return record as unknown as AnyRecord;
  });
}

// ===================================================================== semantics
// Pass two: do the references actually resolve? The ledger is replayed in order
// against a set of known ids that starts from the catalog and grows as records
// create rooms, containers and belongings — so a dump that creates a room and then
// places something in it is accepted, while a dump that points at something never
// created is refused. This is what shape validation structurally cannot decide.

interface LedgerSemantics {
  rooms: Set<string>;
  furniture: Set<string>;
  containers: Set<string>;
  belongings: Set<string>;
  evidence: Set<string>;
  observations: Set<string>;
  proposals: Map<string, "pending" | "accepted" | "rejected">;
  operations: Map<string, Set<string>>;
}

function catalogSemantics(catalog: Catalog): LedgerSemantics {
  return {
    rooms: new Set(catalog.rooms.map((room) => room.id)),
    furniture: new Set(catalog.furniture.map((furniture) => furniture.id)),
    containers: new Set(catalog.containers.map((container) => container.id)),
    belongings: new Set(catalog.belongings.map((belonging) => belonging.id)),
    evidence: new Set(),
    observations: new Set(),
    proposals: new Map(),
    operations: new Map()
  };
}

function cloneSemantics(source: LedgerSemantics): LedgerSemantics {
  return {
    rooms: new Set(source.rooms),
    furniture: new Set(source.furniture),
    containers: new Set(source.containers),
    belongings: new Set(source.belongings),
    evidence: new Set(source.evidence),
    observations: new Set(source.observations),
    proposals: new Map(source.proposals),
    operations: new Map([...source.operations].map(([id, rows]) => [id, new Set(rows)]))
  };
}

function semanticPlace(ref: PlaceRef, semantics: LedgerSemantics, path: string): void {
  const exists = ref.type === "room" ? semantics.rooms.has(ref.id)
    : ref.type === "furniture" ? semantics.furniture.has(ref.id)
    : ref.type === "container" ? semantics.containers.has(ref.id)
    : LIFECYCLE_STATES.has(ref.id);
  if (!exists) throw new Error(`${path} has unknown Place Reference ${ref.type}:${ref.id}`);
}

function semanticItem(itemId: string, semantics: LedgerSemantics, path: string): void {
  if (!semantics.belongings.has(itemId)) throw new Error(`${path} references unknown Belonging ${itemId}`);
}

function applySemanticOps(
  ops: readonly CommitOp[],
  semantics: LedgerSemantics,
  path: string,
  proposal: boolean
): void {
  ops.forEach((op, index) => {
    const opPath = `${path}[${index}]`;
    switch (op.type) {
      case "create_placement":
        semanticItem(op.itemId, semantics, `${opPath}.itemId`);
        if (op.placeRef) semanticPlace(op.placeRef, semantics, `${opPath}.placeRef`);
        else if (!proposal) throw new Error(`${opPath}.placeRef must be concrete in a Commit`);
        for (const evidenceId of op.evidenceIds ?? []) {
          if (!semantics.evidence.has(evidenceId)) throw new Error(`${opPath}.evidenceIds references unknown Evidence ${evidenceId}`);
        }
        break;
      case "contradict_placement":
        semanticItem(op.itemId, semantics, `${opPath}.itemId`);
        for (const evidenceId of op.evidenceIds ?? []) {
          if (!semantics.evidence.has(evidenceId)) throw new Error(`${opPath}.evidenceIds references unknown Evidence ${evidenceId}`);
        }
        break;
      case "set_state": semanticItem(op.itemId, semantics, `${opPath}.itemId`); break;
      case "create_belonging":
        // Creating over an existing id silently REPLACES it in `derive()` — an import
        // could rename a real belonging. Resolution includes "this id is free".
        if (semantics.belongings.has(op.belonging.id)) throw new Error(`${opPath} would replace the existing Belonging ${op.belonging.id}`);
        semanticPlace(op.belonging.defaultHome, semantics, `${opPath}.belonging.defaultHome`);
        semantics.belongings.add(op.belonging.id);
        break;
      case "create_room":
        // Creating over an existing id silently REPLACES it in `derive()`. On the base a
        // dump from another home whose ids collide overwrote a real room in place. Refuse
        // instead, and say what to do: such a dump belongs in a fresh home, not merged
        // into one that already has those ids.
        if (semantics.rooms.has(op.room.id)) throw new Error(`${opPath} would replace the existing Room ${op.room.id}; import this dump into a fresh home instead of merging it into one that already uses that id`);
        semantics.rooms.add(op.room.id);
        break;
      case "create_container":
        if (semantics.containers.has(op.container.id)) throw new Error(`${opPath} would replace the existing Container ${op.container.id}`);
        semanticPlace(op.container.parent, semantics, `${opPath}.container.parent`);
        semantics.containers.add(op.container.id);
        break;
      case "set_box_status":
        // Existence only. `setBoxStatus` accepts any container, so requiring kind "box"
        // here would refuse an export the store itself produced.
        if (!semantics.containers.has(op.boxId)) throw new Error(`${opPath}.boxId references unknown Container ${op.boxId}`);
        break;
      case "confirm_container":
        if (!semantics.containers.has(op.containerId)) throw new Error(`${opPath}.containerId references unknown Container ${op.containerId}`);
        break;
      case "create_operation": {
        if (semantics.operations.has(op.operation.id)) throw new Error(`${opPath} would replace the existing Operation ${op.operation.id}`);
        const rows = new Set<string>();
        for (const row of op.operation.rows ?? []) {
          if (row.itemId) semanticItem(row.itemId, semantics, `${opPath}.operation.rows.${row.id}.itemId`);
          rows.add(row.id);
        }
        semantics.operations.set(op.operation.id, rows);
        break;
      }
      case "set_op_row_status":
        if (!semantics.operations.get(op.opId)?.has(op.rowId)) throw new Error(`${opPath} references unknown Operation row ${op.opId}:${op.rowId}`);
        break;
      case "set_op_status":
        if (!semantics.operations.has(op.opId)) throw new Error(`${opPath}.opId references unknown Operation ${op.opId}`);
        break;
      case "merge_belongings":
        semanticItem(op.keepId, semantics, `${opPath}.keepId`);
        semanticItem(op.mergeId, semantics, `${opPath}.mergeId`);
        if (op.keepId === op.mergeId) throw new Error(`${opPath} cannot merge a Belonging into itself`);
        break;
      case "accept_proposal":
      case "reject_proposal": {
        // Resolution only: the proposal must exist and still be undecided. Whether a
        // commit must LINK the proposal it decides is a separate Review-integrity rule,
        // and enforcing it here refused a legitimate commit deciding two proposals.
        const status = semantics.proposals.get(op.proposalId);
        if (status === undefined) throw new Error(`${opPath}.proposalId references unknown Proposal ${op.proposalId}`);
        if (status !== "pending") throw new Error(`${opPath}.proposalId references an already-decided Proposal ${op.proposalId}`);
        semantics.proposals.set(op.proposalId, op.type === "accept_proposal" ? "accepted" : "rejected");
        break;
      }
      case "reset_to_seed": break;
    }
  });
}

function foldSemantics(records: readonly AnyRecord[], semantics: LedgerSemantics): void {
  records.forEach((record, index) => {
    const path = `Record ${index + 1}`;
    if (record.recordType === "evidence") {
      semantics.evidence.add(record.id);
      return;
    }
    if (record.recordType === "observation") {
      if (record.itemId) semanticItem(record.itemId, semantics, `${path}.itemId`);
      if (record.containerId && !semantics.containers.has(record.containerId)) throw new Error(`${path}.containerId references unknown Container ${record.containerId}`);
      semantics.observations.add(record.id);
      return;
    }
    if (record.recordType === "proposal") {
      for (const observationId of record.sourceObservationIds) {
        if (!semantics.observations.has(observationId)) throw new Error(`${path}.sourceObservationIds references unknown Observation ${observationId}`);
      }
      // A proposal only SUGGESTS, so its ops are checked against a copy: they must be
      // coherent, but they must not add anything to the accepted set until a commit
      // accepts them. This keeps Observation -> Proposal -> Review -> Commit intact.
      applySemanticOps(record.suggestedOps, cloneSemantics(semantics), `${path}.suggestedOps`, true);
      semantics.proposals.set(record.id, "pending");
      return;
    }

    if (record.sourceProposalId && !semantics.proposals.has(record.sourceProposalId)) {
      throw new Error(`${path}.sourceProposalId references unknown Proposal ${record.sourceProposalId}`);
    }
    for (const observationId of record.sourceObservationIds ?? []) {
      if (!semantics.observations.has(observationId)) throw new Error(`${path}.sourceObservationIds references unknown Observation ${observationId}`);
    }
    const reset = record.ops.some((op) => op.type === "reset_to_seed");
    if (reset) {
      if (record.ops.length !== 1) throw new Error(`${path} reset_to_seed must be the only operation in its Commit`);
      // A reset record grants NOTHING to later records in the same dump. `derive()`
      // treats `reset_to_seed` as a no-op when replaying an imported ledger — it does
      // not re-run the seed commits — so crediting the seed's ids here would let a
      // dump reference containers the store will never know, producing exactly the
      // confident answer naming an empty place that this validation exists to stop.
      // The reset is still recorded (append-only history is preserved); it simply
      // confers no authority.
      return;
    }
    applySemanticOps(record.ops, semantics, `${path}.ops`, false);
  });
}

/** Check that every reference in `records` resolves, replaying the ledger in order.
 *
 *  The known-id set starts from the catalog and grows only as the records themselves
 *  create rooms, containers and belongings — matching what `derive()` will actually
 *  know after the import. A `reset_to_seed` record confers nothing, because `derive()`
 *  treats it as a no-op on an imported ledger rather than re-running the seed commits.
 *
 *  Throws on the first unresolved reference, naming the record and path. Like the
 *  shape pass it is pure: it reads, it never writes, so a caller that only installs
 *  records after both passes return cannot half-apply a bad dump. */
export function validateLedgerSemantics(records: readonly AnyRecord[], catalog: Catalog): void {
  foldSemantics(records, catalogSemantics(catalog));
}
