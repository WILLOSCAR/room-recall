# Field-Test Protocol — Container Snapshot Activation & Trusted Recall

Status: `waiting-external` (protocol ready; real users not yet available)
Owner: this Goal session
Derived from: wayfinder issues 01 (durable promise + falsification), 02 (activation
event + metric), 03 (activation evidence — verdict REVISE, five required protocol
fixes), 06 (sensitive-evidence boundary). Implements the five revisions issue 03
made a precondition of any real field test.

This is a **primary-research protocol**, not evidence. Running it with real users is
the only thing that converts the prototype/simulation signal into field evidence.
Do not cite this document as proof of anything — it is the instrument.

---

## 1. What we are testing (and not)

**In scope:** can a representative user reach a *first confirmed trusted recall* of
a *genuinely forgotten* item in ≤5 minutes via the Container Snapshot fast lane, and
do the two churn levers (time-to-value, manual-entry tax) behave as the proxy
predicts? Secondary: does the user show a stated return trigger?

**Explicitly NOT in scope (cannot be answered in one session):**
- 3-month unprompted return (falsification #1) — needs a longitudinal arm (§7).
- capture-cost-vs-duplicate-purchase over real weeks (falsification #2) — longitudinal.
- Whether room reconstruction is necessary (ticket 04) — stays blocked; this test
  must not be used to justify 2D/3D work.

**Decision rule:** each session returns `proceed | revise | stop` for the activation
on-ramp ONLY. The durable promise (Ownership/pre-purchase recall) stays unproven
until the longitudinal arm returns.

## 2. Sample (revision #5 — deliberately non-high-tech)

N ≥ 5, recruited to OVER-represent the hard tail, not the fluent middle:
- ≥1 low-tech comfort (self-describes as "not good with apps"),
- ≥1 small-screen device (≤5" or a borrowed older phone),
- ≥1 secondary-language user (runs the session in their non-primary language),
- ≥1 privacy-sensitive (refuses or hesitates on camera/cloud by default),
- remaining slots: movers within ±6 weeks of a move (the activation window).

Exclude: anyone who has seen the prototype or worked on home-inventory software.

Record per participant: age band, tech-comfort (1–5), move recency, renter/owner.

## 3. Apparatus

- **prototype-v2** served locally (`npm run serve`), on the participant's own phone
  where possible (small-screen requirement). Seeded with a neutral 2-room, ~15-item
  home the participant has NOT seen — no item may be pre-revealed.
- The **Container Snapshot fast lane only** for the primary task (one photo + one
  sentence + room → proposal → review → commit → answer).
- A **voice-capture option** must be present (revision #4): the sentence may be
  spoken, not typed. Log which modality each participant chooses.
- Instrumentation: the store's `recallOutcomes()` read-model gives the moderator a
  deterministic `firstAt` (first confirmed recall) and the 30-day outcome count;
  the moderator also records wall-clock, taps, and corrections on the scoresheet
  (§5). The prototype's own clock is the backup.

## 4. The task — un-staged, with a real miss (revisions #1, #2)

The participant is moving. Give them a real box (or a photo of one) they packed,
containing 6–10 genuine items. Two deliberate faults are planted WITHOUT the
participant's knowledge:
1. **One genuinely forgotten item** is in the box — something they will not
   remember packing (the moderator confirms beforehand it is not top-of-mind).
2. **One item is in a DIFFERENT box than the one photographed**, so a wrong answer
   is reachable and the "Not there → correct" path is genuinely exercised (issue 03
   found circular retrieval made wrong answers impossible in the prototype).

**Primary task (≤5 min, timed):** "Using only the app, find [the forgotten item]."
The participant must reach a *confirmed* recall — they tap "Found it here — confirm"
(or "Still own it") — not merely see an answer. Stop the clock at that tap.

**Packing-stage variant (revision #1):** for participants still packing (not yet
moved), the metric is "capture now → answer 'which box is X in?' against the
just-packed box" in the same session, PLUS a scheduled post-arrival verification
(§7). For post-move participants, the forgotten-item task above is the metric.

## 5. Scoresheet (per participant)

| Measure | How | Target |
|---|---|---|
| Time-to-first-confirmed-recall | wall-clock open → confirm tap | ≤5 min (aim ~3) |
| Taps | moderator count + prototype | floor, not a goal |
| Pre-commit corrections | edits in the Review step before commit | low; record each |
| Post-commit "Not there" events | reached the different-box item? | reachable, not forced |
| Privacy surprises | any hesitation/question about the photo (§6) | 0 on the fast lane |
| Retrieved what they cared about | did they find the FORGOTTEN item? | yes |
| Capture modality | typed vs voice | log only |
| Stated return trigger | "would you open this again, and why?" | verbatim |

The first six map directly to issue 02's metric and issue 03's five axes. Record
verbatim quotes for the return-trigger and privacy columns — they are the signal.

## 6. Privacy probe (revision #3 + issue 06)

The fast lane must show, BEFORE the shutter, a plain-language on-device disclosure:
the photo is evidence stored on-device, it is recognition-only (the app does not
invent contents), and how to delete it. Then, mid-session, the moderator asks the
storage/retention question issue 03 flagged as never-addressed:
**"Where do you think this photo goes, and what would you want to happen to it?"**
Record the reaction verbatim. Any surprise, distrust, or deletion request is a
logged privacy surprise — the target is 0, and a single "I had no idea" is a
`revise` signal, not a pass.

Sensitive-evidence boundary (issue 06, still open — this test informs it but does
not resolve it): faces, documents, screens, addresses, receipts, and labels in a
box photo must be excludable before anything leaves the device. Note any participant
who raises one of these unprompted.

## 7. Longitudinal arm (falsification #1 & #2 — the part that actually matters)

The one-session test cannot touch retention. For participants who complete the
primary task, invite a **3-month diary arm**:
- **Week 0:** capture ≥3 real boxes/containers from their actual move.
- **Weeks 1–12:** the app (or a weekly one-question check-in) logs every unprompted
  recall — "did you open Nestory to find something this week? what happened?"
- **Month 3:** the decisive probe — unprompted, do they return for a real recall?
  Plus: estimate the duplicate purchases they believe they avoided vs. the total
  capture+correction time invested (falsification #2's cost/benefit).

Falsification #1 is met (promise supported) only if a majority return unprompted at
~3 months for a genuine recall. Benchmarks predict they will NOT — treat a null
result as the expected, informative outcome, not a failure of the test.

## 8. Stop rules

- Stop the session if the participant cannot complete the primary task in >10 min
  (record as a hard activation failure — the most important data point).
- Stop the test early if 3 consecutive participants hit a hard activation failure
  for the SAME reason → that is a `revise`/`stop` signal on the on-ramp itself.
- Never coach the participant through the flow. A hint given is a data point
  ("needed hint: ___"), not a success.

## 9. Evidence class & honesty

- One-session results = **behavioral, in-session** evidence (activation only).
- Longitudinal arm = **behavioral, longitudinal** evidence (the durable promise).
- Moderator observation + prototype instrumentation are the record; the
  `recallOutcomes()` read-model makes the recall confirmation timestamps
  deterministic and exportable, not subject to moderator memory.
- Preserve DISconfirming evidence verbatim. A skeptic who finishes in <70s and
  states no return trigger (issue 03's persona finding) is the result to protect,
  not an outlier to smooth over.
- This protocol unblocks nothing by itself. Ticket 04 (reconstruction) stays
  blocked until REAL evidence says reconstruction is necessary.
