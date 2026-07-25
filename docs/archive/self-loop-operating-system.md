# RoomRecall Self-Loop Operating System

This note defines the repeatable loop for turning RoomRecall from a fuzzy idea into a tighter product prototype.

## Loop Goal

RoomRecall should improve by cycling through learning, critique, modification, and verification. The loop is intentionally small: each pass should produce one clearer product decision, one prototype improvement, or one stronger test.

## Core Chain

```text
1. Teach / Research
   Read the current PRD, prototype behavior, verification report, and user intent.

2. Critique
   Identify where the product promise is ahead of the prototype or where the prototype is ahead of the contract.

3. Decide
   Choose one small iteration target that improves the highest-risk chain.

4. Modify
   Patch the PRD, prototype, or verification harness.

5. Verify
   Run the browser verification and self-loop report.

6. Carry Forward
   Record what passed, what remains weak, and the next iteration queue.
```

## Product Loop Under Test

The first killer loop is:

```text
find item -> answer with evidence -> user says Not there -> negative evidence -> corrected placement -> commit -> future answer improves
```

This loop is the baseline because it is high frequency, naturally creates fresh data, and feeds kit readiness, scanning, and layout impact review.

## Engineering Loop

Each iteration should classify work into one of four lanes:

- `semantic`: Place Graph, placement states, coverage, non-room states, kit satisfaction.
- `spatial`: coordinate frames, anchors, containers, envelopes, layout constraints.
- `interface`: 2D/3D visibility, right-panel clarity, scan diff readability, correction flow.
- `verification`: DOM checks, backend contract invariants, placement invalidation, collision coherence.

The loop should prefer the lane that currently blocks trust. If two lanes tie, choose `verification` before adding new UI.

## Definition of Done Per Loop

A loop is complete only when:

- the changed behavior is visible in the prototype or explicitly captured in the PRD;
- `node prototype/verify.mjs` passes;
- `node prototype/self-loop.mjs` writes a fresh self-loop report;
- the next iteration queue contains at least one concrete item.

## Self-Loop Command

Run:

```bash
node prototype/verify.mjs
node prototype/self-loop.mjs
```

Outputs:

- `prototype/renders/verification-report.json`
- `prototype/renders/self-loop-state.json`
- `prototype/renders/self-loop-report.md`

## Iteration Policy

- Do not expand toward photorealistic 3D until the `find -> Not there -> correction` loop is reliable.
- Do not let scan proposals become truth without proposal review and commit.
- Do not let furniture/layout edits silently preserve child placements as confirmed.
- Do not make coordinates look more precise than their evidence supports.
- Do not add a new concept unless it closes a loop or makes verification stronger.

