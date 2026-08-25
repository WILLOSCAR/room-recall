# Field-Test Analysis & Decision Plan (pre-registered)

Status: `waiting-external` (pre-registered BEFORE any real-user data exists)
Owner: this Goal session
Binds: [`field-test-protocol.md`](field-test-protocol.md) — this is the protocol's
missing decision half. The protocol says each session returns `proceed | revise |
stop`; this file pre-commits, in advance of any data, HOW the five sessions
aggregate into that verdict, and which patterns are disconfirming. Pre-registering
the rule is the guard against reading a null result as a pass after the fact.

This is NOT field evidence and does not run the test. It is the scoring instrument.
Written before data so the thresholds cannot be moved to fit the outcome.

---

## 0. Why this exists (issue 03's trap, made falsifiable)

Issue 03's proxy verdict was REVISE with two disconfirming findings that a
qualitative per-session `proceed|revise|stop` cannot capture:
1. **Activation success ≠ retention.** A skeptic finished the fast lane in <70s
   and still stated no return trigger. A 5-minute metric is structurally blind
   to this — a session can "pass" activation and still predict churn.
2. **Circular retrieval made wrong answers impossible** in the prototype, so a
   high success rate could be an artifact of the instrument, not real recall.

An un-pre-registered analysis would let a null retention signal be smoothed into
"activation worked, ship it." This plan pre-commits the opposite reading.

## 1. Primary endpoint (activation on-ramp ONLY)

Per participant, a session is an **activation success** iff ALL hold:
- reached a *confirmed* recall (tapped "Found it here — confirm" / "Still own it"),
  not merely saw an answer;
- for the FORGOTTEN item (§4), not a top-of-mind item;
- in ≤5 min wall-clock (open → confirm tap);
- with **0 hard privacy surprises** on the fast lane (§6; a single "I had no idea
  where the photo goes" is NOT a success for that session — it is a revise signal).

**Aggregate rule (N ≥ 5), pre-committed:**
- **proceed** — ≥4/5 activation successes AND the validity guard (§3) holds AND
  0 hard activation failures (§8, >10 min) → advance the on-ramp toward a spec.
- **revise** — 2–3/5 successes, OR any single recurring blocker named by ≥2
  participants, OR the validity guard fails → fix the named cause, re-run; do NOT
  spec.
- **stop** — ≤1/5 successes, OR 3 consecutive hard activation failures for the
  SAME reason (§8) → the on-ramp itself is wrong; return to the activation
  question, not to a spec.

Ties/edge (exactly at a boundary) resolve DOWN (to the more conservative verdict).

## 2. The retention disconfirming rule (durable promise — pre-committed)

The one-session test **cannot** return `proceed` on the durable promise; only the
longitudinal arm (§7) can. This plan pre-commits that the following pattern, if
observed, is logged as **evidence AGAINST the durable promise** even when
activation succeeds:
- a participant completes activation (fast, clean) AND, asked "would you open this
  again, and why?", gives no concrete, self-generated return trigger (a vague
  "maybe when I move again" does not count; a specific "when I can't find my
  passport before a flight" does).

Count `return_trigger ∈ {concrete, vague, none}` per participant. **A majority of
{vague, none} is the expected benchmark outcome (issue 01 falsification #1) and
must be reported as the headline, not buried** — activation success does not
offset it. This is the anti-smoothing commitment.

## 2b. Capture-economics pre-commit (falsification #2 — numeric target)

From [`capture-economics-breakeven.md`](capture-economics-breakeven.md), the cost
side is grounded in the prototype's real step-counts: Container Snapshot capture ≈
`4/S` actions per item (S = items per box), correction ≈ 3 actions each. The
break-even shows the binding constraint is the **correction rate `r`, not capture
effort**. Pre-committed target for the longitudinal arm (and, as a leading
indicator, the in-session "Not there → correct" path):
- **`r > ~17%` (more than ~1 in 6 captured items re-corrected) at a realistic box
  size is a falsification-#2 signal** — correction cost overtakes the amortized
  capture cost, the category-killer issue 03 named. Record every correction; report
  `r` as the headline economic metric, not taps.
- Avoided-duplicate-purchase value (the `pre_purchase` outcome, ADR-0004) dominates
  the value side, so the economics clear easily on value magnitude PROVIDED `r`
  stays under threshold. The test measures `r` and the avoided-purchase count; it
  does NOT assume the value magnitudes (those stay parameterized).

## 3. Validity guard — non-circularity (pre-committed, can INVALIDATE the run)

Issue 03 found circular retrieval made wrong answers impossible. The protocol §4
plants a **different-box item** so a wrong answer is reachable. Pre-committed guard:
- if **0/5** participants ever reach a wrong/"Not there" answer across the whole
  session (nobody exercised the correction path), the instrument did not present a
  falsifiable retrieval → **the activation result is INVALID, not a pass**, and the
  verdict is forced to `revise` (fix the fault-planting, re-run) regardless of the
  success count.
- record per participant: `reached_wrong_answer ∈ {yes, no}` and, if yes, whether
  the "Not there → correct" path recovered.

This is the guard that stops a circular-retrieval artifact from masquerading as
recall.

## 4. Qualitative coding (so results aren't moderator memory)

Two columns are coded from verbatim quotes, by two independent coders, reconciled:
- **return trigger** → {concrete, vague, none} (§2 rule).
- **privacy reaction** (§6 "where does this photo go?") → {trusts on-device,
  neutral/unsure, assumes cloud / distrust / deletion request}. Any
  cloud/distrust/deletion instance is a hard privacy surprise for the primary
  endpoint (§1).
Disagreements are resolved by re-reading the quote, not by majority; unresolved
disagreements are reported as such. `recallOutcomes()` `firstAt` + the `modality`
tag (export JSON) are the deterministic backbone; coding covers only what the
instrument cannot timestamp.

## 5. Sample-validity floor (before ANY verdict)

The verdict is only computed if the realized sample meets issue 03 revision #5:
≥1 low-tech, ≥1 small-screen, ≥1 secondary-language, ≥1 privacy-sensitive, and no
excluded participant (has seen the prototype / worked on home-inventory software).
If the floor is not met, the run is **descriptive only** — no proceed/revise/stop
is issued. This prevents a fluent-middle sample from producing a false `proceed`.

## 6. What this plan explicitly does NOT decide

- It does not unblock reconstruction (issue 04/05) — that stays gated on real
  evidence that reconstruction is *necessary*, and no activation result can supply
  it.
- It does not touch the durable promise verdict — only the longitudinal arm (§7)
  can, at ~3 months.
- It is not evidence. A pre-registered rule with no data returns no verdict.
