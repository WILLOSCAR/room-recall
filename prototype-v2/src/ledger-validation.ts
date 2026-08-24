import type {
  AnyRecord, Belonging, Catalog, CommitOp, CommitRecord, Container, EvidenceRecord, OperationData, PhotoMedia, PlaceRef, Room
} from "./types.ts";
import {
  BOX_STATUSES, CONTAINER_KINDS, LIFECYCLE_STATES as LIFECYCLE_STATE_VALUES,
  OPERATION_STATUSES as OPERATION_STATUS_VALUES, ROW_STATUSES as ROW_STATUS_VALUES
} from "./types.ts";

type ObjectValue = Record<string, unknown>;

const RECORD_TYPES = new Set(["evidence", "observation", "proposal", "commit"]);
const EVIDENCE_KINDS = new Set(["user_confirmation", "seed_import", "negative_report", "correction", "snapshot_text", "photo_note"]);
// RecallOutcomeKind — the North-Star tag. Only reaffirmPlacement may mint it; the
// validator still enforces its shape + reference so a crafted import cannot forge
// outcomes from nothing (or from garbage) on the way back in.
const RECALL_KINDS = new Set(["location", "ownership"]);
const CAPTURE_MODALITIES = new Set(["typed", "voice"]);
const OBSERVATION_TYPES = new Set(["container_snapshot", "not_there_report", "duplicate_suspected", "stale_container_flag", "manual_note", "release_intent", "declutter_deferred"]);
const PROPOSAL_TYPES = new Set(["placement_correction", "contents_update", "duplicate_merge", "container_refresh", "release_decision"]);
const PLACE_TYPES = new Set(["room", "furniture", "container", "state"]);
const RELATIONS = new Set(["inside", "on_surface", "under", "attached_to", "near"]);
// Canonical domain vocabulary lives in types.ts; build lookup Sets from it so
// adding a lifecycle state / box status / container kind is a one-file edit.
const LIFECYCLE_STATES = new Set<string>(LIFECYCLE_STATE_VALUES);
const BOX_STATUSES_SET = new Set<string>(BOX_STATUSES);
const ROW_STATUSES = new Set<string>(ROW_STATUS_VALUES);
const OPERATION_STATUSES = new Set<string>(OPERATION_STATUS_VALUES);
const CONTAINER_KINDS_SET = new Set<string>(CONTAINER_KINDS);
const IMPORTANCE = new Set(["essential", "high", "normal"]);
const COMMIT_OPS = new Set([
  "create_placement", "contradict_placement", "set_state", "create_belonging", "create_room",
  "create_container", "set_box_status", "confirm_container", "create_operation", "set_op_row_status",
  "set_op_status", "merge_belongings", "accept_proposal", "reject_proposal", "reset_to_seed"
]);

function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as ObjectValue;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function boundedString(value: unknown, path: string, maxLength: number): string {
  const found = string(value, path);
  if (found.length > maxLength) throw new Error(`${path} must be at most ${maxLength} characters`);
  return found;
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && value !== null) string(value, path);
}

function optionalBoundedString(value: unknown, path: string, maxLength: number): void {
  if (value !== undefined && value !== null) boundedString(value, path, maxLength);
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

function boundedStrings(value: unknown, path: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > maxItems) throw new Error(`${path} must contain at most ${maxItems} values`);
  return value.map((entry, index) => boundedString(entry, `${path}[${index}]`, maxLength));
}

function timestamp(value: unknown, path: string): void {
  const iso = string(value, path);
  if (!Number.isFinite(Date.parse(iso))) throw new Error(`${path} must be a valid timestamp`);
}

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
  oneOf(size["source"], new Set(["manual", "product", "scan"]), `${path}.source`);
  if (typeof size["verified"] !== "boolean") throw new Error(`${path}.verified must be a boolean`);
}

function media(value: unknown, path: string): PhotoMedia {
  const photo = object(value, path);
  const dataUrl = string(photo["dataUrl"], `${path}.dataUrl`);
  if (!dataUrl.startsWith("data:image/")) throw new Error(`${path}.dataUrl must contain image media`);
  if (photo["width"] !== undefined && finiteNumber(photo["width"], `${path}.width`) <= 0) throw new Error(`${path}.width must be positive`);
  if (photo["height"] !== undefined && finiteNumber(photo["height"], `${path}.height`) <= 0) throw new Error(`${path}.height must be positive`);
  return photo as unknown as PhotoMedia;
}

function room(value: unknown, path: string): Room {
  const candidate = object(value, path);
  string(candidate["id"], `${path}.id`);
  boundedString(candidate["name"], `${path}.name`, 100);
  plan(candidate["plan"], `${path}.plan`);
  return candidate as unknown as Room;
}

function container(value: unknown, path: string): Container {
  const candidate = object(value, path);
  string(candidate["id"], `${path}.id`);
  boundedString(candidate["name"], `${path}.name`, 120);
  oneOf(candidate["kind"], CONTAINER_KINDS_SET, `${path}.kind`);
  placeRef(candidate["parent"], `${path}.parent`);
  optionalBoundedString(candidate["note"], `${path}.note`, 500);
  if (candidate["box"] !== undefined) {
    const box = object(candidate["box"], `${path}.box`);
    boundedString(box["label"], `${path}.box.label`, 100);
    boundedString(box["destination"], `${path}.box.destination`, 200);
    optionalString(box["operationId"], `${path}.box.operationId`);
  }
  return candidate as unknown as Container;
}

function belonging(value: unknown, path: string): Belonging {
  const candidate = object(value, path);
  string(candidate["id"], `${path}.id`);
  boundedString(candidate["name"], `${path}.name`, 200);
  boundedStrings(candidate["kinds"], `${path}.kinds`, 32, 64);
  oneOf(candidate["importance"], IMPORTANCE, `${path}.importance`);
  placeRef(candidate["defaultHome"], `${path}.defaultHome`);
  if (candidate["group"] !== undefined && typeof candidate["group"] !== "boolean") throw new Error(`${path}.group must be a boolean`);
  optionalString(candidate["note"], `${path}.note`);
  if (candidate["dimensions"] !== undefined) dimensions(candidate["dimensions"], `${path}.dimensions`);
  if (candidate["source"] !== undefined) oneOf(candidate["source"], new Set(["manual", "product", "scan"]), `${path}.source`);
  return candidate as unknown as Belonging;
}

function operation(value: unknown, path: string): OperationData {
  const candidate = object(value, path);
  string(candidate["id"], `${path}.id`);
  const type = oneOf(candidate["type"], new Set(["move", "kit"]), `${path}.type`);
  optionalString(candidate["kitId"], `${path}.kitId`);
  if (type === "move" && candidate["kitId"] !== undefined && candidate["kitId"] !== null) throw new Error(`${path}.kitId is only valid for kit operations`);
  string(candidate["name"], `${path}.name`);
  timestamp(candidate["startedAt"], `${path}.startedAt`);
  oneOf(candidate["status"], OPERATION_STATUSES, `${path}.status`);
  if (candidate["rows"] !== undefined) {
    if (!Array.isArray(candidate["rows"])) throw new Error(`${path}.rows must be an array`);
    if (type !== "kit") throw new Error(`${path}.rows are only valid for kit operations`);
    candidate["rows"].forEach((entry, index) => {
      const rowPath = `${path}.rows[${index}]`;
      const row = object(entry, rowPath);
      string(row["id"], `${rowPath}.id`);
      string(row["reqId"], `${rowPath}.reqId`);
      strings(row["reqLabels"], `${rowPath}.reqLabels`);
      oneOf(row["level"], new Set(["required", "optional"]), `${rowPath}.level`);
      optionalString(row["itemId"], `${rowPath}.itemId`);
      oneOf(row["status"], ROW_STATUSES, `${rowPath}.status`);
      optionalString(row["note"], `${rowPath}.note`);
      if (typeof row["mergedRequirement"] !== "boolean") throw new Error(`${rowPath}.mergedRequirement must be a boolean`);
      if (row["sharedWith"] !== undefined) strings(row["sharedWith"], `${rowPath}.sharedWith`);
      if (row["updatedAt"] !== undefined) timestamp(row["updatedAt"], `${rowPath}.updatedAt`);
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

export function validatedLedgerRecords(data: unknown, source: string): AnyRecord[] {
  const dump = object(data, source);
  if (dump["version"] !== 2) throw new Error(`${source} has unsupported schema version; expected version 2`);
  if (!Array.isArray(dump["records"])) throw new Error(`${source} must contain a records array`);

  const ids = new Set<string>();
  const records = dump["records"].map((entry, index) => {
    const path = `Record ${index + 1}`;
    const record = object(entry, path);
    const type = oneOf(record["recordType"], RECORD_TYPES, `${path}.recordType`);
    const id = string(record["id"], `${path}.id`);
    if (ids.has(id)) throw new Error(`${path}.id duplicates ${JSON.stringify(id)}`);
    ids.add(id);
    timestamp(record["at"], `${path}.at`);

    if (type === "evidence") {
      oneOf(record["kind"], EVIDENCE_KINDS, `${path}.kind`);
      string(record["summary"], `${path}.summary`);
      if (record["media"] !== undefined) media(record["media"], `${path}.media`);
      if (record["recall"] !== undefined && record["recall"] !== null) {
        const recall = object(record["recall"], `${path}.recall`);
        oneOf(recall["kind"], RECALL_KINDS, `${path}.recall.kind`);
        string(recall["itemId"], `${path}.recall.itemId`);
      }
    } else if (type === "observation") {
      oneOf(record["type"], OBSERVATION_TYPES, `${path}.type`);
      optionalString(record["itemId"], `${path}.itemId`);
      optionalString(record["containerId"], `${path}.containerId`);
      if (record["photo"] !== undefined) media(record["photo"], `${path}.photo`);
      if (record["payload"] !== undefined) {
        const payload = object(record["payload"], `${path}.payload`);
        // `modality` is local-only capture provenance (field-test typed-vs-voice
        // arm). It is not a truth source, but a forged value would corrupt the
        // field-test data — validate it the same way the recall tag is validated,
        // so a tampered dump fails closed instead of silently mislabeling captures.
        if (record["type"] === "container_snapshot" && payload["modality"] !== undefined && payload["modality"] !== null) {
          oneOf(payload["modality"], CAPTURE_MODALITIES, `${path}.payload.modality`);
        }
      }
    } else if (type === "proposal") {
      oneOf(record["type"], PROPOSAL_TYPES, `${path}.type`);
      strings(record["sourceObservationIds"], `${path}.sourceObservationIds`);
      string(record["summary"], `${path}.summary`);
      if (record["needsPlace"] !== undefined && typeof record["needsPlace"] !== "boolean") throw new Error(`${path}.needsPlace must be a boolean`);
      const suggestedOps = commitOps(record["suggestedOps"], `${path}.suggestedOps`, true);
      if (suggestedOps.some((op) => op.type === "reset_to_seed" || op.type === "accept_proposal" || op.type === "reject_proposal")) {
        throw new Error(`${path}.suggestedOps cannot contain reset or proposal-decision operations`);
      }
    } else {
      string(record["summary"], `${path}.summary`);
      commitOps(record["ops"], `${path}.ops`, false);
      optionalString(record["sourceProposalId"], `${path}.sourceProposalId`);
      if (record["sourceObservationIds"] !== undefined) strings(record["sourceObservationIds"], `${path}.sourceObservationIds`);
    }
    return record as unknown as AnyRecord;
  });

  return records;
}

interface LedgerSemantics {
  rooms: Set<string>;
  furniture: Set<string>;
  containers: Map<string, string>;
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
    containers: new Map(catalog.containers.map((container) => [container.id, container.kind])),
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
    containers: new Map(source.containers),
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
  proposal: boolean,
  record: CommitRecord | null
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
        if (semantics.belongings.has(op.belonging.id)) throw new Error(`${opPath} duplicates Belonging ${op.belonging.id}`);
        semanticPlace(op.belonging.defaultHome, semantics, `${opPath}.belonging.defaultHome`);
        semantics.belongings.add(op.belonging.id);
        break;
      case "create_room":
        if (semantics.rooms.has(op.room.id)) throw new Error(`${opPath} duplicates Room ${op.room.id}`);
        semantics.rooms.add(op.room.id);
        break;
      case "create_container":
        if (semantics.containers.has(op.container.id)) throw new Error(`${opPath} duplicates Container ${op.container.id}`);
        semanticPlace(op.container.parent, semantics, `${opPath}.container.parent`);
        semantics.containers.set(op.container.id, op.container.kind);
        break;
      case "set_box_status":
        if (semantics.containers.get(op.boxId) !== "box") throw new Error(`${opPath}.boxId references unknown Box ${op.boxId}`);
        break;
      case "confirm_container":
        if (!semantics.containers.has(op.containerId)) throw new Error(`${opPath}.containerId references unknown Container ${op.containerId}`);
        break;
      case "create_operation": {
        if (semantics.operations.has(op.operation.id)) throw new Error(`${opPath} duplicates Operation ${op.operation.id}`);
        const rows = new Set<string>();
        for (const row of op.operation.rows ?? []) {
          if (rows.has(row.id)) throw new Error(`${opPath}.operation.rows duplicates row ${row.id}`);
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
        const status = semantics.proposals.get(op.proposalId);
        if (status !== "pending") throw new Error(`${opPath}.proposalId references no pending Proposal ${op.proposalId}`);
        if (!proposal && record?.sourceProposalId !== op.proposalId) throw new Error(`${path} must link sourceProposalId ${op.proposalId}`);
        semantics.proposals.set(op.proposalId, op.type === "accept_proposal" ? "accepted" : "rejected");
        break;
      }
      case "reset_to_seed": break;
    }
  });
}

function foldSemantics(
  records: readonly AnyRecord[],
  initial: LedgerSemantics,
  resetBaseline: LedgerSemantics | null
): LedgerSemantics {
  let semantics = cloneSemantics(initial);
  records.forEach((record, index) => {
    const path = `Record ${index + 1}`;
    if (record.recordType === "evidence") {
      semantics.evidence.add(record.id);
      // A recall tag must reference a belonging that exists at this point in the
      // ledger — closes the import-forgery hole where a crafted dump mints North-
      // Star outcomes for items that never existed. (Shape was checked structurally
      // upstream; genuine round-trips pass because the item is created first.)
      const recall = (record as EvidenceRecord).recall;
      if (recall) semanticItem(recall.itemId, semantics, `${path}.recall.itemId`);
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
      applySemanticOps(record.suggestedOps, cloneSemantics(semantics), `${path}.suggestedOps`, true, null);
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
      semantics = cloneSemantics(resetBaseline ?? initial);
      return;
    }
    applySemanticOps(record.ops, semantics, `${path}.ops`, false, record);
  });
  return semantics;
}

export function validateLedgerSemantics(records: readonly AnyRecord[], catalog: Catalog, baselineRecords: readonly AnyRecord[]): void {
  const initial = catalogSemantics(catalog);
  const baseline = foldSemantics(baselineRecords, initial, null);
  foldSemantics(records, initial, baseline);
}
