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

## Revision round (2026-08-19) — from 5 simulated user sessions

Five independent persona-agents (fluent, privacy-cautious, low-tech/ESL, skeptic,
busy parent) role-played real first sessions. Verdict stayed REVISE, but they
surfaced concrete prototype defects, now fixed and verified in-browser:

1. **Parser** keeps multi-word items ("phone cable" no longer split), strips
   room/filler words, and never silently drops — verified: `charger, phone cable,
   lamp, meds and socks` → all five kept.
2. **Real chip editor** (add/remove inline) replaces the dead `alert()` stub;
   corrections only count when something actually changes.
3. **Non-circular retrieval**: ~1 in 3 committed runs the charger is NOT in the
   photographed box, so the answer hedges ("if it's not there, tell me") and the
   "Not there → correct" negative-evidence path is genuinely reachable — the
   circular "receipt for what I just typed" flaw all five flagged is gone.
4. **Box photo shown in the answer** (the one differentiator over a Sharpie).
5. **Pre-shutter privacy disclosure** ("stays on this device… you can delete it")
   before the camera fires; dropped the `photo_note`/"evidence" jargon that raised
   guard.
6. **Plain-language confidence** ("a good guess (0.72)") instead of a bare 0.72.
7. Mobile scorecard scrolls instead of clipping; the steering "hypothesized
   winner" badge is now a neutral "fewest steps".

**Still not answerable by simulation** (needs real users / real time): 3-month
unprompted return, capture-cost vs duplicate-purchase-cost over weeks, and the
durable Ownership/pre-purchase promise itself. The fixes make the *next* round
able to observe correction accuracy and a non-circular answer — they do not prove
retention.
