# Five-Minute Activation Prototype (ticket 02)

Throwaway design prototype for `room-recall-v1x` ticket 02 — **not production code**,
does not touch `prototype-v2/`. Kept as the ticket's primary source.

## Question it answers

What is the shortest first-session path that lets a moving renter reach a
**trusted recall outcome** within five minutes, and where do Container Snapshot /
Room Scan / Product Intake / operation-first entry belong?

## Run it

```bash
cd /Users/bytedance/Documents/room-recall
python3 -m http.server 8793
# open http://localhost:8793/.scratch/room-recall-v1x/activation-prototype/
```

Pick an entry path, run it to a retrieval answer, confirm or correct, and read
the scorecard. Run more than one path to compare. It is a **feel-and-time
harness**: a live clock plus tap/correction/privacy/retrieval instrumentation on
the five axes ticket 02 names.

## What it models (faithful to the non-negotiables)

- **Proposal-first**: the Container Snapshot lane produces a *reviewable proposal*
  (evidence = photo + note, confidence 0.72) that only becomes trusted memory on
  Commit. Unknown parts of the box stay unknown — no invented contents.
- **Evidence + confidence** on every answer; a low-confidence answer is flagged as
  a candidate, not stated as fact.
- **Progressive precision**: "the box, → Bedroom" now; exact slot later.
- **Correction, not overwrite**: "not there" becomes negative evidence + a
  correction; a confirmation is itself fresh evidence (one Monthly Trusted Recall
  Outcome, vision §14).
- **Privacy surprise** is surfaced on the Room Scan path (raw room video) and
  absent on the lighter lanes — that asymmetry is the point.

## Finding (carried into ticket 02's Answer)

Container Snapshot is the five-minute activation on-ramp: one photo + one sentence
→ proposal → commit → a trusted answer, with the fewest taps and no privacy
surprise. Operation-first is more trustworthy but front-loads setup before the
first answer; Product Intake is precise but all-manual with no discovery or
evidence; Room Scan pays a privacy + geometry tax the recall question does not
need yet. This is a prototype signal to test in the field (ticket 03), not proof.
