# RoomRecall V1.x Product Validation Wayfinder Map

Status: wayfinder:map

## Destination

A decision-complete foundation for `to-spec` to publish one ready-for-agent V1.x build contract only after a narrow target user, durable Home Memory job, five-minute activation path, and field evidence are clear. The contract should include the smallest truthful capture mode that evidence justifies; real room reconstruction and shared-coordinate 2D/3D correction enter only if they are necessary to the validated job.

## Notes

- Product thesis: **A memory system for your home.**
- ADR-0001 keeps moving/unpacking + Intent Kits as the V1 wedge. This effort decides whether moving is the durable paid promise, an acquisition event, or one Operation inside a broader recurring Home Memory product; it does not reopen the existing V1 UI scope.
- Capture modality is subordinate to the product promise, activation path, and field evidence. Container Snapshot, Product Intake, and manual/voice capture are valid primary paths. If real room capture survives validation, its first CV scope is bounded to one room envelope, one scale anchor, and 5-10 large Furniture proposals. Item-level automatic truth is excluded.
- Use the domain terms in `CONTEXT.md`; consult `docs/vision-scan-and-layout-layer.md`, `docs/scan-algorithm-options.md`, `docs/nestory-v1-prd.md`, and `docs/adr/0001-v1-wedge-moving-and-kits.md`.
- Visual output always follows Observation -> Vision Scan Proposal -> Review Inbox -> Commit Ledger -> Place Graph.
- The current deterministic demo routes accepted scan labels through a selected Container Snapshot. That is a known prototype artifact, not a contract: unknown placement must remain unknown, and scan candidates must never inherit an unrelated Container merely to complete the UI flow.
- `191/191` prototype assertions prove the implemented contract is internally coherent; they do not prove desirability, willingness to maintain Home Memory, or willingness to pay. Downstream technical tickets must wait for target-user evidence.
- If field evidence favors a container-first or operation-first path, rule room reconstruction and spatial correction tickets out of this effort instead of forcing them into the spec.
- Use `research` for current external capabilities, `prototype` for flows that must be felt, and `grilling` + `domain-modeling` for product and contract decisions.

## Decisions so far

<!-- Append one gist and relative link per resolved child ticket. The full decision belongs in the child ticket. -->

- **01 — durable product promise** ([resolved 2026-08-18](issues/01-choose-durable-product-promise.md)): moving/unpacking is the **acquisition & activation event, not the durable promise**; the durable promise is **Ownership Recall + pre-purchase recall** on the Remember+Retrieve foundation. North Star = **Monthly Trusted Recall Outcomes** per home. Beneficiary/first payer = the individual renter/owner (payment model deferred to fog). Falsification: no 3-month return, capture cost > duplicate-purchase cost, or no useful trusted answer in ≤5 min. V1 wedge + evidence-gated 2D/3D unchanged. → unblocks 02.
- **02 — five-minute activation path** ([resolved 2026-08-18](issues/02-define-five-minute-activation.md), prototype in [`activation-prototype/`](activation-prototype/)): activation event = the **Container Snapshot fast lane** (photo + sentence + room → proposal → commit → trusted answer), fewest taps, no privacy surprise, progressive precision. Operation-first = structured alternative (more setup); Product Intake = supporting, not activation; **Room Scan is NOT in the activation path** (privacy + geometry tax, ADR-0002 / 07-21 correction). Field-test metric = time-to-first-*confirmed*-recall ≤5 min + taps/corrections/privacy/retrieved. → unblocks 03. Prototype signal, not proof.

## Fog

Decisions we can tell are coming but cannot yet state as a precise question. An item graduates from fog into an issue ticket when the question can be stated exactly — not when it can be answered.

- Pricing and packaging details beyond identifying the first credible payer or high-stakes beneficiary and the outcome they value.
- The implementation tracer bullets and their public test seams; these become precise after the durable promise, activation path, reconstruction job, correction flow, and acceptance boundary are settled.
- The smallest offline/retry behavior needed when a capture upload or reconstruction job is interrupted.
- Whether field evidence justifies a second capture mode for Container Snapshots in the same build contract.

## Out of scope

- Perfect or photorealistic 1:1 room reconstruction.
- Silent item recognition or any scan result that bypasses review and commit.
- Continuous real-time object tracking.
- Native LiDAR as a requirement; it may become an optional scale/depth enhancement later.
- Multi-user household permissions, insurance workflows, shopping recommendations, and general-purpose interior CAD.
- Full furniture optimization, automatic room redesign, or physics-grade collision simulation in the first validated capture slice.
- Treating room scanning, 3D, or an LLM as mandatory product ingredients before target-user evidence requires them.
