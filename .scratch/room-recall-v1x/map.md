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
- **Field-test protocol ready (2026-08-24), `waiting-external`.** [`field-test-protocol.md`](field-test-protocol.md) operationalizes issue 03's five required protocol revisions (packing-stage metric variant, un-staged forgotten item + different-box fault, storage/retention privacy probe, voice-capture option, deliberately non-high-tech sample) + issue 02's metric + issue 01's three falsification conditions, with a 3-month longitudinal arm for the retention promise. Real users are the only thing that converts it to field evidence.
- **North Star is now measurable in the product (2026-08-24).** `store.recallOutcomes(now?)` is a pure read-model over the ledger: `reaffirmPlacement` (the positive commit verb) tags its `user_confirmation` evidence with `recall: {kind: "location"|"ownership", itemId}`, and the read-model distills `firstAt` (time-to-first-confirmed-recall anchor) + `countLast30Days` (Monthly Trusted Recall Outcomes). Capture/setup confirmations are NOT tagged, so they can't inflate the metric. Round-trips through export/import. Locked by 9 assertions in `verify.ts`. No user-facing counter was added — the trust contract forbids streaks/nagging and mandates minimum-collection, so the metric is moderator/team-readable, not gamified.

## Decisions so far

<!-- Append one gist and relative link per resolved child ticket. The full decision belongs in the child ticket. -->

- **01 — durable product promise** ([resolved 2026-08-18](issues/01-choose-durable-product-promise.md)): moving/unpacking is the **acquisition & activation event, not the durable promise**; the durable promise is **Ownership Recall + pre-purchase recall** on the Remember+Retrieve foundation. North Star = **Monthly Trusted Recall Outcomes** per home. Beneficiary/first payer = the individual renter/owner (payment model deferred to fog). Falsification: no 3-month return, capture cost > duplicate-purchase cost, or no useful trusted answer in ≤5 min. V1 wedge + evidence-gated 2D/3D unchanged. → unblocks 02.
- **02 — five-minute activation path** ([resolved 2026-08-18](issues/02-define-five-minute-activation.md), prototype in [`activation-prototype/`](activation-prototype/)): activation event = the **Container Snapshot fast lane** (photo + sentence + room → proposal → commit → trusted answer), fewest taps, no privacy surprise, progressive precision. Operation-first = structured alternative (more setup); Product Intake = supporting, not activation; **Room Scan is NOT in the activation path** (privacy + geometry tax, ADR-0002 / 07-21 correction). Field-test metric = time-to-first-*confirmed*-recall ≤5 min + taps/corrections/privacy/retrieved. → unblocks 03. Prototype signal, not proof.
- **03 — activation evidence** ([resolved-by-simulation 2026-08-18](issues/03-collect-target-user-activation-evidence.md)): real users unavailable → an **evidence proxy** (desk research + synthetic 5-persona walkthrough), NOT the field evidence the ticket asked for. **Verdict: REVISE** — advance the on-ramp to a *real* field test, but fix the protocol first; do NOT proceed to a V1.x spec on this proxy. Supports: pain is real/recurring, moving is the right window, Snapshot fits the two churn levers. Challenges (disconfirming): **activation success ≠ retention** (skeptic finishes in <70s, no return trigger); Ownership recall is episodic = the exact mechanism that caps utility-app D30 at ~4–10%; the correction-cost trap is the category killer and Nestory's side-effect-correction bet is unproven. **04 is NOT unblocked** — a simulation cannot supply the real evidence its precondition requires. True next step: a ≥5 real-user test with the revised protocol (packing-stage metric variant, un-staged forgotten item, storage/retention privacy probe, voice capture, non-high-tech sample).
- **06 — sensitive-evidence boundary** ([resolved 2026-08-24](issues/06-set-sensitive-evidence-boundary.md)): **no raw image bytes ever leave the device** — only the evidence SUMMARY `{kind, summary, at}` + non-image metadata crosses into an Agent / reconstruction / LLM / export context. One rule covers faces, documents, screens, addresses, receipts, labels (no bytes leave ⇒ no per-class redaction). Enforced centrally at the `dispatch` toolkit edge (`stripSensitiveMedia`, deep, fails closed) with `boundedProjection` as a second LLM-path layer; the on-device UI reads the store directly and keeps the photos. Retention = on-device only, no server copy, user-initiated local deletion; after deletion the `{kind, summary, at}` provenance survives but the pixels are stubbed (never re-derivable). Consent = on-device disclosure before the shutter; failure = fail closed (omit, never leak). Locked by 55 assertions in `verify.ts` (13 tools × 4 leak signatures + fixture-non-vacuity / UI-keeps-media / agent-keeps-summary). The production byte-deletion write path is a documented requirement, NOT implemented in-prototype (append-only ledger; no leak vector locally). Closes the field-test protocol's privacy dependency; real-user *understanding* of the boundary stays with the protocol's privacy probe (waiting-external).

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
