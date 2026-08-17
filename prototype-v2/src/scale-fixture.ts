import { buildSeedRecords } from "./data.ts";
import type { AnyRecord, Belonging, CommitRecord, EvidenceRecord, ObservationRecord, ProposalRecord } from "./types.ts";

export const SCALE_NOW = Date.parse("2026-07-09T12:00:00Z");
export const HOUSEHOLD_ITEM_COUNT = 2_000;

/**
 * Deterministic household-sized record stream shared by performance probes and
 * browser verification. It deliberately uses only public ledger records, so
 * scale tests exercise the same import/validation/replay path as real backups.
 */
export function buildHouseholdRecords(
  now = SCALE_NOW,
  itemCount = HOUSEHOLD_ITEM_COUNT,
  pendingProposalCount = 0
): AnyRecord[] {
  const records = [...buildSeedRecords(now)];
  let sequence = 0;
  const at = (): string => new Date(now + 1_000 + sequence++).toISOString();

  for (let index = 0; index < itemCount; index += 1) {
    const suffix = String(index).padStart(4, "0");
    const itemId = `scale-item-${suffix}`;
    const evidence: EvidenceRecord = {
      recordType: "evidence",
      id: `scale-evidence-${suffix}`,
      kind: "user_confirmation",
      summary: `Created scale item ${suffix}`,
      at: at()
    };
    const belonging: Belonging = {
      id: itemId,
      name: `Scale item ${suffix} shared term`,
      kinds: ["scale-fixture"],
      importance: "normal",
      defaultHome: { type: "container", id: "entry-tray" }
    };
    const created: CommitRecord = {
      recordType: "commit",
      id: `scale-create-${suffix}`,
      at: at(),
      summary: `Add ${belonging.name}`,
      ops: [
        { type: "create_belonging", belonging },
        {
          type: "create_placement",
          itemId,
          placeRef: belonging.defaultHome,
          relation: "inside",
          confidence: 0.9,
          evidenceIds: [evidence.id]
        }
      ]
    };
    records.push(evidence, created);
    for (const [stateIndex, state] of (["with_me", "packed", "at_home"] as const).entries()) {
      records.push({
        recordType: "commit",
        id: `scale-state-${suffix}-${stateIndex}`,
        at: at(),
        summary: `${belonging.name}: ${state}`,
        ops: [{ type: "set_state", itemId, state }]
      });
    }
  }

  for (let index = 0; index < pendingProposalCount; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const observation: ObservationRecord = {
      recordType: "observation",
      id: `scale-review-observation-${suffix}`,
      type: "manual_note",
      at: at(),
      itemId: "water-bottle",
      payload: { note: `Review stress note ${suffix} · 门口托盘需要人工确认` }
    };
    const proposal: ProposalRecord = {
      recordType: "proposal",
      id: `scale-review-proposal-${suffix}`,
      type: "placement_correction",
      at: at(),
      sourceObservationIds: [observation.id],
      summary: `Review fixture ${suffix}: confirm Water bottle at Entry tray`,
      suggestedOps: [{
        type: "create_placement",
        itemId: "water-bottle",
        placeRef: { type: "container", id: "entry-tray" },
        relation: "inside",
        confidence: 0.64,
        evidenceIds: []
      }]
    };
    records.push(observation, proposal);
  }

  return records;
}
