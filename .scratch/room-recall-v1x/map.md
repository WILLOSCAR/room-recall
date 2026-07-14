# RoomRecall V1.x Value And Real Capture Wayfinder Map

Status: wayfinder:map

## Destination

A decision-complete foundation for `to-spec` to publish one ready-for-agent V1.x build contract that proves repeatable Home Memory value through a five-minute activation path and one honest mobile capture -> proposal -> review -> commit -> retrieval loop, with accepted spatial memory visible through the shared-coordinate 2D/3D surfaces.

## Notes

- Product thesis: **A memory system for your home.**
- ADR-0001 keeps moving/unpacking + Intent Kits as the V1 wedge. This effort decides whether moving is the durable paid promise, an acquisition event, or one Operation inside a broader recurring Home Memory product; it does not reopen the existing V1 UI scope.
- Real capture is subordinate to the product promise and activation path. If it remains in the V1.x contract, the first CV scope is bounded to one room envelope, one scale anchor, and 5-10 large Furniture proposals. Item-level automatic truth is excluded.
- Use the domain terms in `CONTEXT.md`; consult `docs/vision-scan-and-layout-layer.md`, `docs/scan-algorithm-options.md`, `docs/nestory-v1-prd.md`, and `docs/adr/0001-v1-wedge-moving-and-kits.md`.
- Visual output always follows Observation -> Vision Scan Proposal -> Review Inbox -> Commit Ledger -> Place Graph.
- The current deterministic demo routes accepted scan labels through a selected Container Snapshot. That is a known prototype artifact, not a contract: unknown placement must remain unknown, and scan candidates must never inherit an unrelated Container merely to complete the UI flow.
- Use `research` for current external capabilities, `prototype` for flows that must be felt, and `grilling` + `domain-modeling` for product and contract decisions.

## Decisions so far

<!-- Append one gist and relative link per resolved child ticket. The full decision belongs in the child ticket. -->

## Not yet specified

- Pricing and packaging details beyond identifying the first credible payer and paid outcome.
- The implementation tracer bullets and their public test seams; these become precise after the durable promise, activation path, reconstruction job, correction flow, and acceptance boundary are settled.
- The smallest offline/retry behavior needed when a capture upload or reconstruction job is interrupted.
- Whether field evidence justifies a second capture mode for Container Snapshots in the same build contract.

## Out of scope

- Perfect or photorealistic 1:1 room reconstruction.
- Silent item recognition or any scan result that bypasses review and commit.
- Continuous real-time object tracking.
- Native LiDAR as a requirement; it may become an optional scale/depth enhancement later.
- Multi-user household permissions, insurance workflows, shopping recommendations, and general-purpose interior CAD.
- Full furniture optimization, automatic room redesign, or physics-grade collision simulation in the first real-capture slice.
