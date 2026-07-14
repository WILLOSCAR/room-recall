# RoomRecall Multi-Agent Requirements Synthesis

Status: synthesis

Date: 2026-07-01

This note records the five parallel requirement reviews used to refine `docs/product-requirements.md`, `docs/vision-scan-and-layout-layer.md`, and `CONTEXT.md`.

## Agents

### Vision Scan and Reconstruction

Focus:

- Scan contract.
- Observation and proposal separation.
- Commit boundary.
- Entity matching.
- Scan quality metrics.

Key synthesis:

- Add `ScanSession`.
- Keep `Observation` append-only.
- Make `ScanProposal` a typed diff.
- Add commit ledger.
- Add entity reconciliation: match existing, create new, merge.
- Track unknown, occluded, hidden, and conflicting states.

### Place Graph and Data Model

Focus:

- Domain language.
- Stable data contracts.
- Placement history.
- Default home versus current place.

Key synthesis:

- `Current Place` is a projection from placement records.
- `Default Home` is stable and not overwritten by normal moves.
- `Evidence` and `confidence` are separate.
- Breadcrumbs should be derived from typed hierarchy.
- Split enum categories: source type, record status, confidence label, lifecycle state, sensitivity level.

### Agent Interaction

Focus:

- Natural-language locate.
- Kit expansion.
- Correction.
- Low-friction updates.

Key synthesis:

- Add conversation state machine.
- Clarify only when the answer changes action.
- Parse update commands into drafts before commit.
- Treat `Not there` as negative evidence.
- Kit sessions need required, optional, substitute, shared, consumable, and blocked items.

### Layout and Storage Optimization

Focus:

- 2D/3D planning.
- Furniture constraints.
- Collision and clearance.
- Storage metrics.

Key synthesis:

- Add keep-out zones, door openings, window areas, and opening envelopes.
- Define main paths before using clearance scores.
- Split storage into gross, usable, and frequently accessible volume.
- Layout changes must review affected placements.
- Layout suggestions need baseline deltas and explicit tradeoffs.

### Privacy and Local-First Safety

Focus:

- Home scans.
- Container snapshots.
- Private documents.
- Agent-readable data.
- Deletion and export.

Key synthesis:

- Separate raw media, derived data, Place Graph facts, and Agent transcripts.
- Raw scans, OCR, embeddings, and transcripts are local-only by default.
- Sensitive evidence is hidden from Agent context unless authorized.
- Deletion must clear raw file, thumbnails, OCR, embeddings, proposal cache, sync queue, and Agent citations.
- Export should support graph-only, redacted evidence, and full encrypted archive.

## Integrated Product Changes

The synthesis was folded into:

- `CONTEXT.md`: added missing domain terms.
- `docs/product-requirements.md`: expanded P0/P1/P2 requirements, Agent behavior, privacy, validation, and build order.
- `docs/vision-scan-and-layout-layer.md`: clarified scan session flow, coordinates, collision, and storage metrics.

## Highest-Priority Requirement Changes

1. Build `Observation -> Proposal/Draft -> CommitLedgerEntry -> PlacementRecord` before stronger automation.
2. Make scan output reviewable typed diffs, not silent model updates.
3. Treat Agent updates as parsed drafts with explicit commit boundaries.
4. Derive current place from placement history.
5. Keep default home separate from current place and last-seen place.
6. Add entity reconciliation before creating new objects from scan or product intake.
7. Add layout keep-out zones, main paths, usable storage, and affected-placement review.
8. Keep raw evidence, OCR, embeddings, and Agent transcripts local-only unless explicitly authorized.
